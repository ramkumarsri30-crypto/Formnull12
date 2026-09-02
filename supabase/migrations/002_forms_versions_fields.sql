-- =====================================================================
-- FormNull Migration 002 — Forms, Form Versions, Form Fields
-- =====================================================================
-- Establishes the form schema with proper versioning and normalized fields.
--
-- Design principles:
--   * Forms are workspace-scoped (multi-tenant foundation).
--   * Each form has an immutable version history (form_versions).
--   * Form fields live in their own table — NOT in a JSON blob — so they
--     can be queried, indexed, and joined efficiently. The draftable
--     "working" version lives in form_fields; publishing snapshots a
--     version into form_versions + a frozen copy in form_field_snapshots
--     (added in a later migration if needed).
--   * Each form has a public_key for unauthenticated submission access
--     (Phase 2+), but RLS for now restricts everything to authenticated
--     workspace members.
--   * Submissions are stored in their own tables (see migration 003),
--     NEVER as a JSON array inside the form row.
-- =====================================================================

-- ------------------------------------------------------------------
-- Enumerations
-- ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE form_status AS ENUM ('draft', 'published', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE field_type AS ENUM (
    'short_text', 'long_text', 'email', 'url', 'phone',
    'number', 'decimal', 'boolean', 'single_select', 'multi_select',
    'date', 'datetime', 'time', 'rating', 'scale', 'file_upload',
    'section', 'page_break', 'signature', 'address', 'matrix'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- forms
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  status          form_status NOT NULL DEFAULT 'draft',
  public_key      text NOT NULL UNIQUE,
  published_version int,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- settings stores presentation-level config only:
  --   theme, submit_button_label, redirect_url, show_progress, etc.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cursor-keyset pagination indexes (created_at + id form a stable cursor)
CREATE INDEX IF NOT EXISTS forms_workspace_created_at_idx
  ON public.forms(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forms_workspace_status_idx
  ON public.forms(workspace_id, status);
CREATE INDEX IF NOT EXISTS forms_public_key_idx
  ON public.forms(public_key);
CREATE INDEX IF NOT EXISTS forms_created_by_idx
  ON public.forms(created_by);

CREATE OR REPLACE FUNCTION public.fn_forms_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_forms_touch_updated_at ON public.forms;
CREATE TRIGGER trg_forms_touch_updated_at
  BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.fn_forms_touch_updated_at();

-- Auto-generate public_key on insert if not provided.
CREATE OR REPLACE FUNCTION public.fn_forms_default_public_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_key IS NULL OR NEW.public_key = '' THEN
    NEW.public_key := encode(gen_random_bytes(18), 'hex');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_forms_default_public_key ON public.forms;
CREATE TRIGGER trg_forms_default_public_key
  BEFORE INSERT ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.fn_forms_default_public_key();

-- ------------------------------------------------------------------
-- form_versions — immutable published snapshots
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  version_number  int NOT NULL,
  schema_snapshot jsonb NOT NULL,
  -- schema_snapshot stores a complete frozen copy of form_fields at publish time.
  -- This is intentional denormalization for immutable version history.
  -- Live data still lives in form_fields.
  notes           text,
  published_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_versions_unique UNIQUE (form_id, version_number)
);

CREATE INDEX IF NOT EXISTS form_versions_form_id_idx
  ON public.form_versions(form_id, version_number DESC);

-- form_versions is append-only; no UPDATE or DELETE should ever happen.
-- RLS will deny both operations entirely.

-- ------------------------------------------------------------------
-- form_fields — normalized, ordered, per-form
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.form_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  field_key       text NOT NULL,
  -- field_key is the machine-readable slug used in submission_values.
  field_type      field_type NOT NULL,
  label           text NOT NULL,
  description     text,
  placeholder     text,
  help_text       text,
  is_required     boolean NOT NULL DEFAULT false,
  is_unique       boolean NOT NULL DEFAULT false,
  is_searchable   boolean NOT NULL DEFAULT false,
  -- Configuration is intentionally JSONB: validation rules, options,
  -- min/max, regex, file types, etc. This is presentation/validation
  -- metadata that does NOT need to be queried relationally.
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Conditional display logic (Phase 2+): a JSON expression describing
  -- when this field should be visible. Empty for now.
  visibility      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order      int NOT NULL DEFAULT 0,
  width           smallint NOT NULL DEFAULT 12 CHECK (width BETWEEN 1 AND 12),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_fields_form_key_unique UNIQUE (form_id, field_key)
);

-- Composite index supporting form_fields-by-form-order queries.
CREATE INDEX IF NOT EXISTS form_fields_form_sort_idx
  ON public.form_fields(form_id, sort_order);
CREATE INDEX IF NOT EXISTS form_fields_form_key_idx
  ON public.form_fields(form_id, field_key);

CREATE OR REPLACE FUNCTION public.fn_form_fields_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_form_fields_touch_updated_at ON public.form_fields;
CREATE TRIGGER trg_form_fields_touch_updated_at
  BEFORE UPDATE ON public.form_fields
  FOR EACH ROW EXECUTE FUNCTION public.fn_form_fields_touch_updated_at();

-- ------------------------------------------------------------------
-- Helper: is current user allowed to manage a form's parent workspace?
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_user_can_edit_form(p_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_user_can_edit_workspace(f.workspace_id)
  FROM public.forms f
  WHERE f.id = p_form_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_can_admin_form(p_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_user_can_admin_workspace(f.workspace_id)
  FROM public.forms f
  WHERE f.id = p_form_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_is_form_member(p_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_user_is_workspace_member(f.workspace_id)
  FROM public.forms f
  WHERE f.id = p_form_id;
$$;

REVOKE EXECUTE ON FUNCTION
  public.fn_user_can_edit_form(uuid),
  public.fn_user_can_admin_form(uuid),
  public.fn_user_is_form_member(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.fn_user_can_edit_form(uuid),
  public.fn_user_can_admin_form(uuid),
  public.fn_user_is_form_member(uuid)
TO authenticated;

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_fields ENABLE ROW LEVEL SECURITY;

-- forms: visible to workspace members, editable by editors+
DROP POLICY IF EXISTS forms_select_member ON public.forms;
CREATE POLICY forms_select_member ON public.forms
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS forms_insert_editor ON public.forms;
CREATE POLICY forms_insert_editor ON public.forms
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_user_can_edit_workspace(workspace_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS forms_update_editor ON public.forms;
CREATE POLICY forms_update_editor ON public.forms
  FOR UPDATE TO authenticated
  USING (public.fn_user_can_edit_workspace(workspace_id))
  WITH CHECK (public.fn_user_can_edit_workspace(workspace_id));

DROP POLICY IF EXISTS forms_delete_admin ON public.forms;
CREATE POLICY forms_delete_admin ON public.forms
  FOR DELETE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id));

-- form_versions: append-only. SELECT for members, INSERT for editors,
-- NO UPDATE OR DELETE even for admins (immutability guarantee).
DROP POLICY IF EXISTS form_versions_select_member ON public.form_versions;
CREATE POLICY form_versions_select_member ON public.form_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_versions.form_id
        AND public.fn_user_is_workspace_member(f.workspace_id)
    )
  );

DROP POLICY IF EXISTS form_versions_insert_editor ON public.form_versions;
CREATE POLICY form_versions_insert_editor ON public.form_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_versions.form_id
        AND public.fn_user_can_edit_workspace(f.workspace_id)
    )
    AND published_by = auth.uid()
  );

-- form_fields: same as forms — member-readable, editor-mutable
DROP POLICY IF EXISTS form_fields_select_member ON public.form_fields;
CREATE POLICY form_fields_select_member ON public.form_fields
  FOR SELECT TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_fields.form_id
        AND public.fn_user_is_workspace_member(f.workspace_id)
    )
  );

DROP POLICY IF EXISTS form_fields_insert_editor ON public.form_fields;
CREATE POLICY form_fields_insert_editor ON public.form_fields
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_fields.form_id
        AND public.fn_user_can_edit_workspace(f.workspace_id)
    )
  );

DROP POLICY IF EXISTS form_fields_update_editor ON public.form_fields;
CREATE POLICY form_fields_update_editor ON public.form_fields
  FOR UPDATE TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_fields.form_id
        AND public.fn_user_can_edit_workspace(f.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_fields.form_id
        AND public.fn_user_can_edit_workspace(f.workspace_id)
    )
  );

DROP POLICY IF EXISTS form_fields_delete_editor ON public.form_fields;
CREATE POLICY form_fields_delete_editor ON public.form_fields
  FOR DELETE TO authenticated
  USING (
    EXISTS(
      SELECT 1 FROM public.forms f
      WHERE f.id = form_fields.form_id
        AND public.fn_user_can_edit_workspace(f.workspace_id)
    )
  );

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.forms, public.form_fields TO authenticated;
-- form_versions: INSERT/SELECT only (no UPDATE/DELETE)
GRANT SELECT, INSERT ON public.form_versions TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
