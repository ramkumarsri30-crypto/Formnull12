-- =====================================================================
-- FormNull Migration 003 — Submissions and Submission Values
-- =====================================================================
-- Submissions are expected to become the largest dataset in FormNull.
-- Design principles:
--
--   * NEVER store all submissions inside one form row.
--   * Each submission is independently addressable (own UUID + seq).
--   * Each submission_value is its own row, indexed by submission_id +
--     field_id, so individual answers can be queried efficiently.
--   * Submissions are indexed by (form_id, created_at DESC) for
--     keyset/cursor pagination on the most common access pattern
--     ("list recent submissions for form X").
--   * A BIGINT submission_seq column per form supports ordering and
--     pagination that doesn't drift when timestamps collide.
--   * A BRIN index on submissions.created_at supports efficient
--     time-range scans over hundreds of millions of rows.
--   * The submitted_at column is TIMESTAMPTZ (UTC) for global correctness.
--
-- In Phase 1, RLS restricts submission access to workspace members.
-- Phase 2+ will introduce a separate "public submission" path using
-- form.public_key + an anonymous role, without weakening RLS here.
-- =====================================================================

-- ------------------------------------------------------------------
-- Enumerations
-- ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE submission_status AS ENUM ('pending', 'completed', 'flagged', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- submissions — one row per submitted form response
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- workspace_id is denormalized from forms for faster workspace-level
  -- filtering without a join. Kept in sync by trigger.
  submission_seq  bigint NOT NULL,
  status          submission_status NOT NULL DEFAULT 'completed',
  -- Submitter identity. NULL when Phase 2 anonymous submissions land.
  submitted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitter_email text,
  submitter_ip    inet,
  submitter_user_agent text,
  -- Metadata: UTM, referrer, locale, duration_seconds, etc.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Aggregate / computed columns (updated by trigger or edge function)
  duration_ms     int,
  is_complete     boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_form_seq_unique UNIQUE (form_id, submission_seq)
);

-- Primary access pattern: list submissions for a form, newest first.
-- This composite index supports keyset/cursor pagination efficiently.
CREATE INDEX IF NOT EXISTS submissions_form_created_at_idx
  ON public.submissions(form_id, created_at DESC);
-- Status filter pattern
CREATE INDEX IF NOT EXISTS submissions_form_status_idx
  ON public.submissions(form_id, status, created_at DESC);
-- Workspace-level listing
CREATE INDEX IF NOT EXISTS submissions_workspace_created_at_idx
  ON public.submissions(workspace_id, created_at DESC);
-- BRIN index on created_at — extremely small on disk, perfect for
-- time-range scans over very large append-only tables.
CREATE INDEX IF NOT EXISTS submissions_created_at_brin_idx
  ON public.submissions USING BRIN (created_at);
-- Submitted_by lookup (per-user submission history)
CREATE INDEX IF NOT EXISTS submissions_submitted_by_idx
  ON public.submissions(submitted_by);

CREATE OR REPLACE FUNCTION public.fn_submissions_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_submissions_touch_updated_at ON public.submissions;
CREATE TRIGGER trg_submissions_touch_updated_at
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_submissions_touch_updated_at();

-- Denormalize workspace_id + auto-increment submission_seq per form.
CREATE OR REPLACE FUNCTION public.fn_submissions_set_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws_id uuid;
  next_seq bigint;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO ws_id FROM public.forms WHERE id = NEW.form_id;
    IF ws_id IS NULL THEN
      RAISE EXCEPTION 'Form % does not exist', NEW.form_id;
    END IF;
    NEW.workspace_id := ws_id;
  END IF;

  IF NEW.submission_seq IS NULL THEN
    SELECT COALESCE(MAX(submission_seq), 0) + 1 INTO next_seq
    FROM public.submissions WHERE form_id = NEW.form_id;
    NEW.submission_seq := next_seq;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_submissions_set_defaults ON public.submissions;
CREATE TRIGGER trg_submissions_set_defaults
  BEFORE INSERT ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_submissions_set_defaults();

REVOKE EXECUTE ON FUNCTION public.fn_submissions_set_defaults() FROM PUBLIC;

-- ------------------------------------------------------------------
-- submission_values — one row per (submission, field)
-- Normalized so individual answers can be queried/joined efficiently.
-- =====================================================================
-- A jsonb `value` column is used because field types are heterogeneous
-- (text, number, boolean, array, file ref, etc.). This is NOT the same
-- as storing the entire submission in one JSON blob — each value is its
-- own row, indexed, and individually addressable.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.submission_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  form_id         uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  field_id        uuid NOT NULL REFERENCES public.form_fields(id) ON DELETE CASCADE,
  field_key       text NOT NULL,
  value           jsonb,
  -- Pre-extracted typed columns for the most common query patterns.
  -- These are populated by trigger and let us build indexed queries
  -- without paying the cost of jsonb extraction at query time.
  value_text      text,
  value_number    numeric,
  value_boolean   boolean,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_values_unique UNIQUE (submission_id, field_id)
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS submission_values_submission_idx
  ON public.submission_values(submission_id);
CREATE INDEX IF NOT EXISTS submission_values_field_idx
  ON public.submission_values(field_id);
CREATE INDEX IF NOT EXISTS submission_values_form_idx
  ON public.submission_values(form_id);
-- Text search on extracted value_text (per-form)
CREATE INDEX IF NOT EXISTS submission_values_value_text_gin_idx
  ON public.submission_values USING gin (to_tsvector('english', value_text))
  WHERE value_text IS NOT NULL;

-- Populate typed value_* columns + form_id on insert
CREATE OR REPLACE FUNCTION public.fn_submission_values_set_typed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f_form_id uuid;
BEGIN
  IF NEW.form_id IS NULL THEN
    SELECT form_id INTO f_form_id FROM public.form_fields WHERE id = NEW.field_id;
    IF f_form_id IS NULL THEN
      RAISE EXCEPTION 'Field % does not exist', NEW.field_id;
    END IF;
    NEW.form_id := f_form_id;
  END IF;

  -- Extract typed values based on JSON type
  IF NEW.value IS NOT NULL THEN
    -- text extraction: handles strings, numbers, booleans rendered as text
    NEW.value_text := CASE
      WHEN jsonb_typeof(NEW.value) = 'string' THEN NEW.value #>> '{}'
      WHEN jsonb_typeof(NEW.value) IN ('number','boolean') THEN NEW.value::text
      ELSE NULL
    END;
    IF jsonb_typeof(NEW.value) = 'number' THEN
      NEW.value_number := (NEW.value #>> '{}')::numeric;
    END IF;
    IF jsonb_typeof(NEW.value) = 'boolean' THEN
      NEW.value_boolean := (NEW.value #>> '{}')::boolean;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_submission_values_set_typed ON public.submission_values;
CREATE TRIGGER trg_submission_values_set_typed
  BEFORE INSERT ON public.submission_values
  FOR EACH ROW EXECUTE FUNCTION public.fn_submission_values_set_typed();

REVOKE EXECUTE ON FUNCTION public.fn_submission_values_set_typed() FROM PUBLIC;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_values ENABLE ROW LEVEL SECURITY;

-- submissions: visible to workspace members; create via Phase 2 anonymous
-- path will be added later. For Phase 1, only members can insert.
DROP POLICY IF EXISTS submissions_select_member ON public.submissions;
CREATE POLICY submissions_select_member ON public.submissions
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS submissions_insert_member ON public.submissions;
CREATE POLICY submissions_insert_member ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS submissions_update_admin ON public.submissions;
CREATE POLICY submissions_update_admin ON public.submissions
  FOR UPDATE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id))
  WITH CHECK (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS submissions_delete_admin ON public.submissions;
CREATE POLICY submissions_delete_admin ON public.submissions
  FOR DELETE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id));

-- submission_values: member-readable, insert-allowed for members
DROP POLICY IF EXISTS sv_select_member ON public.submission_values;
CREATE POLICY sv_select_member ON public.submission_values
  FOR SELECT TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = submission_values.submission_id
        AND public.fn_user_is_workspace_member(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS sv_insert_member ON public.submission_values;
CREATE POLICY sv_insert_member ON public.submission_values
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = submission_values.submission_id
        AND public.fn_user_is_workspace_member(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS sv_update_admin ON public.submission_values;
CREATE POLICY sv_update_admin ON public.submission_values
  FOR UPDATE TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = submission_values.submission_id
        AND public.fn_user_can_admin_workspace(s.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = submission_values.submission_id
        AND public.fn_user_can_admin_workspace(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS sv_delete_admin ON public.submission_values;
CREATE POLICY sv_delete_admin ON public.submission_values
  FOR DELETE TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = submission_values.submission_id
        AND public.fn_user_can_admin_workspace(s.workspace_id)
    )
  );

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.submissions, public.submission_values TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
