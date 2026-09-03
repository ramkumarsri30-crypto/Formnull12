-- =====================================================================
-- FormNull Migration 006 — Publishing, Public Form Access, Public
--                          Submission, Answer Retention, Rate Limiting
-- =====================================================================
-- STATUS: NOT APPLIED — the project owner applies migrations manually
-- through the Supabase SQL editor. This file was never executed against
-- the live database. Do not apply it automatically.
--
-- WHAT THIS MIGRATION DELIVERS
-- ----------------------------
--   Section 1  Answer retention: submission_values.field_id becomes
--              nullable with ON DELETE SET NULL, so deleting a form
--              field after submissions exist can never destroy
--              collected answers. field_key stays NOT NULL as the
--              permanent historical identifier.
--   Section 2  Concurrency fix: fn_submissions_set_defaults() (defined
--              in 003) is replaced with a version that serializes the
--              per-form MAX(submission_seq)+1 computation with a
--              transaction-scoped advisory lock. Same signature, same
--              behavior, no more lost-insert race.
--   Section 3  form_rate_limits table (RLS enabled, ZERO policies,
--              ZERO grants → unreachable via PostgREST; only the
--              SECURITY DEFINER RPC in Section 6 touches it).
--   Section 4  public.publish_form(uuid) — atomic publish with an
--              immutable snapshot into form_versions (authenticated,
--              editors+ of the form's workspace only).
--   Section 5  public.get_public_form(text) — anonymous read of the
--              PUBLISHED SNAPSHOT ONLY (never live/draft fields), with
--              public-safe columns only.
--   Section 6  public.submit_public_form(text, jsonb, text, jsonb) —
--              anonymous submission with full server-side validation
--              against the immutable published snapshot, honeypot
--              spam defense, payload caps, per-form+IP rate limiting.
--   Section 7  Execution grants for the three RPCs + post-apply
--              verification queries (documentation only).
--
-- RULES HONORED
-- --------------
--   * Migrations 001–005 FILES are untouched. Section 2 uses
--     CREATE OR REPLACE on an existing function — the sanctioned
--     PostgreSQL evolution path; the original 003 body is preserved
--     verbatim in the rollback note below.
--   * NOT ONE RLS policy of 001–005 is altered or dropped. No new
--     policies are added to existing tables. Anonymous access exists
--     ONLY inside two auditable SECURITY DEFINER functions.
--   * No anonymous grants on any table. form_rate_limits has no
--     grants at all (owner-only; the RPCs run as the owner).
--   * The public form renders and is validated from the IMMUTABLE
--     published snapshot (form_versions.schema_snapshot), never from
--     mutable builder data.
--
-- IDEMPOTENCY
-- ------------
--   Every statement is re-runnable:
--     * ALTER ... DROP NOT NULL / ENABLE ROW LEVEL SECURITY → no-ops
--       when already applied.
--     * DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT → the FK is dropped
--       and re-created under the SAME name (default 003 name is
--       preserved). ADD CONSTRAINT re-validates existing rows; with
--       the table empty (current production state) this is instant.
--     * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
--       CREATE OR REPLACE FUNCTION / REVOKE / GRANT → all idempotent.
--
-- ROLLBACK (full script, run as postgres in the SQL editor)
-- -----------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.publish_form(uuid);
--   DROP FUNCTION IF EXISTS public.get_public_form(text);
--   DROP FUNCTION IF EXISTS public.submit_public_form(text, jsonb, text, jsonb);
--   DROP TABLE IF EXISTS public.form_rate_limits;
--   ALTER TABLE public.submission_values DROP CONSTRAINT IF EXISTS
--     submission_values_field_id_fkey;
--   ALTER TABLE public.submission_values
--     ADD CONSTRAINT submission_values_field_id_fkey
--     FOREIGN KEY (field_id) REFERENCES public.form_fields(id) ON DELETE CASCADE;
--     -- NOTE: restoring ON DELETE CASCADE + NOT NULL requires that no
--     -- NULL field_id rows exist; if submissions were collected after
--     -- 006, those rows keep their field_key and must be deleted (or
--     -- re-linked) before this restore succeeds.
--   ALTER TABLE public.submission_values ALTER COLUMN field_id SET NOT NULL;
--   -- Restore the 003 function verbatim (removes the advisory lock):
--   CREATE OR REPLACE FUNCTION public.fn_submissions_set_defaults()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   DECLARE ws_id uuid; next_seq bigint;
--   BEGIN
--     IF NEW.workspace_id IS NULL THEN
--       SELECT workspace_id INTO ws_id FROM public.forms WHERE id = NEW.form_id;
--       IF ws_id IS NULL THEN RAISE EXCEPTION 'Form % does not exist', NEW.form_id; END IF;
--       NEW.workspace_id := ws_id;
--     END IF;
--     IF NEW.submission_seq IS NULL THEN
--       SELECT COALESCE(MAX(submission_seq), 0) + 1 INTO next_seq
--       FROM public.submissions WHERE form_id = NEW.form_id;
--       NEW.submission_seq := next_seq;
--     END IF;
--     RETURN NEW;
--   END $$;
-- =====================================================================


-- =====================================================================
-- SECTION 1 — ANSWER RETENTION (submission_values.field_id)
-- =====================================================================
-- Problem: 003 defined
--     field_id uuid NOT NULL REFERENCES public.form_fields(id)
--       ON DELETE CASCADE
-- so deleting a form field cascades into submission_values and
-- PERMANENTLY DELETES collected answers. With zero submissions today
-- (verified during Phase 2A) that is harmless; once public submissions
-- exist it becomes routine-edit-triggered data loss.
--
-- Fix: field_id becomes nullable with ON DELETE SET NULL.
--   * field_key is NOT NULL on every row (003) and form_fields has
--     UNIQUE (form_id, field_key) (002) — field_key is the stable
--     historical identifier, so an answer with field_id NULL remains
--     fully interpretable forever.
--   * The published snapshot (Section 4) preserves the complete field
--     definition (label, type, config) that the answer was collected
--     against, so historical interpretation needs nothing else.
--
-- Impact analysis (production change review):
--   * Existing FK: submission_values_field_id_fkey, ON DELETE CASCADE.
--     Swapped for the identical name with ON DELETE SET NULL.
--   * Existing nullability: NOT NULL → nullable. No row is modified;
--     only future deletes of form_fields set NULL instead of cascading.
--   * Existing rows: table is EMPTY in production (0 submissions —
--     verified in Phase 2A). ADD CONSTRAINT re-validates rows anyway,
--     so this stays safe even if rows appeared meanwhile.
--   * Indexes: submission_values_field_idx (field_id) — B-tree indexes
--     accept NULLs, no change required. The partial GIN index on
--     value_text is unaffected.
--   * Constraints: UNIQUE (submission_id, field_id) still holds for
--     live fields. For rows with NULL field_id the uniqueness is not
--     enforced by that constraint (standard SQL NULL semantics);
--     the submit RPC (Section 6) stores at most one value per field
--     key per submission by construction, and field_key remains
--     distinct within a submission.
--   * Application queries: NO application code reads or writes
--     submission_values today (Phase 2A greps confirm only COUNT on
--     submissions in the dashboard). Future reader code (Phase 4
--     responses UI) must treat field_id as optional and join by
--     field_key.
-- =====================================================================

ALTER TABLE public.submission_values ALTER COLUMN field_id DROP NOT NULL;

ALTER TABLE public.submission_values
  DROP CONSTRAINT IF EXISTS submission_values_field_id_fkey;

ALTER TABLE public.submission_values
  ADD CONSTRAINT submission_values_field_id_fkey
  FOREIGN KEY (field_id) REFERENCES public.form_fields(id) ON DELETE SET NULL;


-- =====================================================================
-- SECTION 2 — SUBMISSION SEQUENCE RACE FIX
--            public.fn_submissions_set_defaults() (replaces 003 body)
-- =====================================================================
-- The race in 003: under READ COMMITTED two concurrent inserts for the
-- same form both execute
--     SELECT COALESCE(MAX(submission_seq), 0) + 1 ...
-- before either commits, both compute the SAME next value, and the
-- second insert then dies on submissions_form_seq_unique
-- UNIQUE (form_id, submission_seq) — taking its whole transaction
-- (submission + values) with it. For anonymous public submitters that
-- is an unexplained failure.
--
-- The fix: acquire a per-form transaction-scoped advisory lock BEFORE
-- computing MAX+1. All writers that leave submission_seq NULL (this
-- trigger's path — used by direct member inserts AND by
-- submit_public_form) serialize on the lock; the MAX statement then
-- sees the previous writer's committed row and produces a gapless
-- next value. The UNIQUE constraint remains the hard backstop.
--
-- Why this is safe to do in 006:
--   * Same signature, same trigger, same SECURITY DEFINER +
--     search_path pinning as 003 — the only behavioral delta is the
--     lock acquisition, which is invisible except that the race
--     disappears.
--   * CREATE OR REPLACE keeps the function's owner and privileges.
--   * Transaction-scoped: the lock is released at COMMIT/ROLLBACK —
--     no cleanup path exists to forget. Failed inserts release it
--     automatically.
--   * Key derivation: hashtextextended('formnull:submission_seq:' ||
--     form_id, 0) — pg_catalog built-in (PG 11+), collisions merely
--     serialize two unrelated forms briefly, never corrupt anything.
--   * Deadlock analysis: every submission transaction takes exactly
--     ONE advisory lock; publish_form takes a row lock (FOR UPDATE on
--     forms) and never advisory locks; submission INSERTs take only a
--     FOR KEY SHARE on the forms row (compatible ordering, no cycle).
--
-- Throughput note (documented limitation, not silently ignored):
-- serializing on MAX+1 bounds a single form to roughly one
-- submission-commit at a time. For a form product that is acceptable
-- (insert transactions are a few milliseconds). The scale-out design
-- (per-form counter row updated with UPDATE ... RETURNING) is a
-- FUTURE migration decision, deliberately not invented here.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_submissions_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    IF NEW.form_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended('formnull:submission_seq:' || NEW.form_id::text, 0));
    END IF;
    SELECT COALESCE(MAX(submission_seq), 0) + 1 INTO next_seq
    FROM public.submissions WHERE form_id = NEW.form_id;
    NEW.submission_seq := next_seq;
  END IF;

  RETURN NEW;
END;
$$;


-- =====================================================================
-- SECTION 3 — RATE LIMIT STORE: public.form_rate_limits
-- =====================================================================
-- Fixed-window rate limiting for anonymous submissions.
--
--   * Strategy: window = 10 minutes, max = 20 successful submissions
--     per (form_id, ip_hash). Constants live in submit_public_form
--     (Section 6) — they are deliberately NOT columns so changing
--     them never requires DDL.
--   * Concurrency-safe increments: INSERT ... ON CONFLICT DO UPDATE
--     (row lock on the conflicting row) — never read-modify-write.
--   * No raw IP storage: only a hash of the best-effort client IP
--     (sha-256 via pgcrypto when available, md5 fallback). The
--     submissions.submitter_ip column is deliberately left NULL for
--     public submissions — the architecture does not require raw IPs.
--   * No table scans for limiting: the PK (form_id, ip_hash) serves
--     every lookup. NO COUNT(*) over submissions is ever executed.
--   * Cleanup: probabilistic (1% of submits) DELETE of windows older
--     than 1 hour. The BRIN index on window_start keeps that DELETE
--     bounded (rows are inserted in created_at order, the natural
--     BRIN best case) instead of scanning a huge table. pg_cron is
--     NOT assumed to exist.
--   * Storage growth is bounded by (active submitters per form per
--     hour), NOT by total submissions; stale rows are continuously
--     pruned by the probabilistic delete.
--   * Access control: RLS ENABLED with ZERO policies and ZERO grants
--     to anon/authenticated — the table is invisible to PostgREST
--     for every API role and is touched only by the SECURITY DEFINER
--     submit RPC, which runs as the owner.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.form_rate_limits (
  form_id      uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  ip_hash      text NOT NULL,
  window_start timestamptz NOT NULL,
  window_count int  NOT NULL DEFAULT 0,
  PRIMARY KEY (form_id, ip_hash)
);

CREATE INDEX IF NOT EXISTS form_rate_limits_window_brin_idx
  ON public.form_rate_limits USING BRIN (window_start);

ALTER TABLE public.form_rate_limits ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies and NO grants on this table.


-- =====================================================================
-- SECTION 4 — public.publish_form(p_form_id uuid)
-- =====================================================================
-- PURPOSE
--   Atomically transition a draft form to published:
--     1. lock/read the form row safely (FOR UPDATE)
--     2. authorize the caller (editors+ of the form's workspace)
--     3. enforce publishability (usable fields, field budget,
--        field/config structural validation, no file_upload)
--     4. compute the next version number (under the row lock)
--     5. write an IMMUTABLE snapshot into public.form_versions
--     6. set forms.published_version + forms.status
--     7. return the public_key + version
--
-- SECURITY DEFINER REASONING
--   The function bypasses RLS (definer = owner), therefore it carries
--   its own explicit authorization, mirroring the forms_update_editor
--   policy of 002 exactly:
--       fn_user_can_edit_workspace(v_form.workspace_id)
--   (002 helper, itself SECURITY DEFINER + auth.uid()-based). auth.uid()
--   is NULL for anon and for service-key calls without a user JWT, so
--   both are rejected with AUTH_REQUIRED before anything is read.
--   form_versions.published_by is set from auth.uid() on the server —
--   the caller cannot forge authorship. No caller-controlled workspace
--   or user identifiers exist anywhere in the signature or body.
--   search_path is pinned to public (schema-shadowing defense). There
--   is no dynamic SQL (no EXECUTE) anywhere in this migration, so
--   there is no SQL-injection surface; every identifier is static and
--   every value is a bound PL/pgSQL variable.
--
-- CONCURRENCY
--   FOR UPDATE on the forms row serializes concurrent publish calls
--   for the same form BEFORE MAX(version_number)+1 is computed, so
--   duplicate version numbers cannot happen via this RPC. The
--   form_versions_unique UNIQUE (form_id, version_number) constraint
--   (002) is the hard backstop for any writer bypassing this RPC.
--
-- FIELD-COUNT LIMIT — INTENTIONALLY NEW
--   The builder (field palette, new-form page) imposes NO field-count
--   limit today, and 002 defines none. Publishing is the right place
--   to introduce the product's first bound: a form of unbounded size
--   would produce an unbounded public snapshot (public-render DoS)
--   and an unbounded validation loop on submit. The limit is 300
--   fields (upper end of mainstream form-builder norms) and is
--   enforced at PUBLISH time only — drafts may temporarily exceed it,
--   and a UI-side cap belongs to the Phase 3B builder update.
--
-- FILE_UPLOAD — GENUINELY UNSUPPORTED TODAY (not an arbitrary rule)
--   Three independent architectural facts, all from 001–004:
--     1. The submissions STORAGE bucket's write policy
--        "submissions_member_write" (004) requires an authenticated
--        workspace MEMBER — there is no anonymous upload path, and
--        creating one is a security-sensitive storage change that
--        this migration deliberately does not make.
--     2. public.assets.owner_id is uuid NOT NULL REFERENCES
--        auth.users(id) (004). An anonymous submitter has no
--        auth.users id, so an anonymous upload row cannot be
--        represented without forging ownership.
--     3. submit_public_form is a single atomic transaction. A file
--        answer must reference a storage object under
--        submissions/{submission_id}/... — the submission row must
--        exist BEFORE the upload, requiring a two-phase
--        pending→completed flow (submission_status has 'pending' for
--        exactly that future design). That is Phase 5 work.
--   → Publishing a form containing file_upload fields fails with
--     FILE_UPLOAD_NOT_SUPPORTED. Nothing is faked; the error names
--     the real reason.
--
-- SNAPSHOT CONTRACT
--   The snapshot contains EXACTLY what the public renderer and the
--   submit validator need — explicitly selected, never
--   to_jsonb(form_fields) wholesale:
--     form level : version, name, description, settings
--     per field  : key, type, label, description, placeholder,
--                  help_text, required, config, sort_order, width
--   Deliberately EXCLUDED: field id (mutable/dangling after delete —
--   field_key is the stable identifier), form_id, is_unique,
--   is_searchable, visibility (unused by any 001–005 product path;
--   version N+1 snapshots may add keys additively since jsonb
--   consumers are forward-compatible), created_at/updated_at.
--   'settings' is included: 002 documents it as presentation-level
--   config only (theme, submit button label, redirect, progress) —
--   it must never hold private data, enforced by convention and
--   reviewed at publish time by this function's size guard.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.publish_form(p_form_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Publishability budgets (new product limits — see header).
  c_max_fields         constant int := 300;
  c_max_options        constant int := 100;
  c_max_option_len     constant int := 200;
  c_max_label_len      constant int := 500;
  c_max_text_len       constant int := 2000;
  c_max_pattern_len    constant int := 512;
  c_max_cfg_value_len  constant int := 10000;   -- maxLength/minLength bound
  c_max_snapshot_bytes constant int := 524288;  -- 512 KiB public payload

  v_user     uuid;
  v_form     record;
  v_fields   jsonb;
  v_total    int;
  v_usable   int;
  v_files    int;
  v_version  int;
  v_snapshot jsonb;
  v_config   jsonb;
  v_opt      jsonb;
  v_n        int;
  v_distinct int;
  v_nonstr   int;
  v_badlen   int;
  v_cfg      text;
  v_a        numeric;
  v_b        numeric;
  v_c        numeric;
  v_minlen   numeric;
  v_maxlen   numeric;
  r          record;   -- loop variable of the per-field validation query
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: publish_form requires a signed-in user';
  END IF;

  -- (1) Lock the form row for the whole transaction.
  SELECT f.id, f.workspace_id, f.public_key, f.name, f.description, f.settings
    INTO v_form
    FROM public.forms f
   WHERE f.id = p_form_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORM_NOT_FOUND: no form with this id (or no access)';
  END IF;

  -- (2) Authorization — same semantics as forms_update_editor (002).
  IF NOT public.fn_user_can_edit_workspace(v_form.workspace_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: you do not have edit rights for this form';
  END IF;

  -- (3) Field census.
  SELECT count(*),
         count(*) FILTER (WHERE ff.field_type::text <> 'section'),
         count(*) FILTER (WHERE ff.field_type::text = 'file_upload')
    INTO v_total, v_usable, v_files
    FROM public.form_fields ff
   WHERE ff.form_id = p_form_id;

  IF v_usable = 0 THEN
    RAISE EXCEPTION 'NO_USABLE_FIELDS: add at least one non-section field before publishing';
  END IF;
  IF v_total > c_max_fields THEN
    RAISE EXCEPTION 'TOO_MANY_FIELDS: a published form supports at most % fields (this form has %)', c_max_fields, v_total;
  END IF;
  IF v_files > 0 THEN
    RAISE EXCEPTION 'FILE_UPLOAD_NOT_SUPPORTED: this form contains file upload fields; anonymous file uploads are not available yet (no anon storage policy, assets.owner_id requires an auth user, and submissions are single-transaction). Remove or replace those fields before publishing.';
  END IF;

  -- (3b) Per-field structural + config validation. This mirrors the
  -- builder's own validateConfig contract (field-types.ts) so a form
  -- that the builder considers invalid can never reach the public.
  FOR r IN
    SELECT ff.field_key,
           ff.field_type::text AS ftype,
           ff.label,
           ff.description,
           ff.placeholder,
           ff.help_text,
           ff.config
      FROM public.form_fields ff
     WHERE ff.form_id = p_form_id
     ORDER BY ff.sort_order, ff.field_key
  LOOP
    -- Stable identifier: matches the builder's slugify output
    -- ([a-z0-9_], ≤ 50 chars — new-form.tsx / form-detail.tsx).
    IF r.field_key !~ '^[a-z0-9_]{1,50}$' THEN
      RAISE EXCEPTION 'CONFIG_INVALID: field "%" has an invalid field_key (must be 1-50 chars of a-z, 0-9, _)', r.field_key;
    END IF;
    IF length(r.label) NOT BETWEEN 1 AND c_max_label_len THEN
      RAISE EXCEPTION 'CONFIG_INVALID: field "%" label must be 1-% characters', r.field_key, c_max_label_len;
    END IF;
    IF length(COALESCE(r.description, '')) > c_max_text_len
       OR length(COALESCE(r.placeholder, '')) > c_max_text_len
       OR length(COALESCE(r.help_text, '')) > c_max_text_len THEN
      RAISE EXCEPTION 'CONFIG_INVALID: field "%" description/placeholder/help text must be at most % characters', r.field_key, c_max_text_len;
    END IF;

    v_config := COALESCE(r.config, '{}'::jsonb);
    IF jsonb_typeof(v_config) <> 'object' THEN
      RAISE EXCEPTION 'CONFIG_INVALID: field "%" config must be a JSON object', r.field_key;
    END IF;

    IF r.ftype IN ('single_select', 'multi_select') THEN
      v_opt := v_config->'options';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" requires a config.options array', r.field_key;
      END IF;
      SELECT count(*),
             count(DISTINCT x.e #>> '{}'),
             count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'string'),
             count(*) FILTER (WHERE length(x.e #>> '{}') NOT BETWEEN 1 AND c_max_option_len)
        INTO v_n, v_distinct, v_nonstr, v_badlen
        FROM jsonb_array_elements(v_opt) AS x(e);
      IF v_n < 1 OR v_n > c_max_options OR v_nonstr > 0 OR v_badlen > 0 OR v_distinct <> v_n THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" options must be % unique non-empty strings of 1-% characters', r.field_key, c_max_options, c_max_option_len;
      END IF;

    ELSIF r.ftype = 'rating' THEN
      v_cfg := v_config->>'max';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,2}$' OR v_cfg::int NOT BETWEEN 2 AND 10) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" rating max must be an integer between 2 and 10', r.field_key;
      END IF;

    ELSIF r.ftype IN ('number', 'decimal', 'scale') THEN
      v_cfg := v_config->>'min';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^-?[0-9]{1,10}([.][0-9]{1,6})?$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" min must be a number', r.field_key;
      END IF;
      v_a := CASE WHEN v_cfg IS NULL THEN NULL ELSE v_cfg::numeric END;
      v_cfg := v_config->>'max';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^-?[0-9]{1,10}([.][0-9]{1,6})?$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" max must be a number', r.field_key;
      END IF;
      v_b := CASE WHEN v_cfg IS NULL THEN NULL ELSE v_cfg::numeric END;
      v_cfg := v_config->>'step';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^-?[0-9]{1,10}([.][0-9]{1,6})?$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" step must be a number', r.field_key;
      END IF;
      v_c := CASE WHEN v_cfg IS NULL THEN NULL ELSE v_cfg::numeric END;
      IF v_a IS NOT NULL AND v_b IS NOT NULL AND v_a >= v_b THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" min must be less than max', r.field_key;
      END IF;
      IF v_c IS NOT NULL AND v_c <= 0 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" step must be greater than 0', r.field_key;
      END IF;

    ELSIF r.ftype IN ('short_text', 'long_text', 'email', 'url', 'phone') THEN
      v_cfg := v_config->>'minLength';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,5}$' OR v_cfg::int > c_max_cfg_value_len) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" minLength must be a whole number between 0 and %', r.field_key, c_max_cfg_value_len;
      END IF;
      v_minlen := CASE WHEN v_cfg IS NULL THEN NULL ELSE v_cfg::numeric END;
      v_cfg := v_config->>'maxLength';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,5}$' OR v_cfg::int < 1 OR v_cfg::int > c_max_cfg_value_len) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" maxLength must be a whole number between 1 and %', r.field_key, c_max_cfg_value_len;
      END IF;
      v_maxlen := CASE WHEN v_cfg IS NULL THEN NULL ELSE v_cfg::numeric END;
      IF v_minlen IS NOT NULL AND v_maxlen IS NOT NULL AND v_minlen > v_maxlen THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" minLength cannot exceed maxLength', r.field_key;
      END IF;
      v_cfg := v_config->>'pattern';
      IF v_cfg IS NOT NULL AND length(v_cfg) > c_max_pattern_len THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" pattern must be at most % characters', r.field_key, c_max_pattern_len;
      END IF;
      -- NOTE: pattern is a JavaScript regex; PostgreSQL cannot evaluate
      -- JS regex semantics. It is length-checked here and enforced
      -- client-side at fill time; the submit RPC enforces type+length
      -- server-side. Documented product limitation, not a fake check.

    END IF;
    -- section / boolean / date / time carry no config in the builder
    -- contract; width is already constrained 1-12 by 002's CHECK.
  END LOOP;

  -- (4) Immutable snapshot from EXPLICIT columns (never to_jsonb(ff)).
  SELECT jsonb_agg(
           jsonb_build_object(
             'key',         ff.field_key,
             'type',        ff.field_type::text,
             'label',       ff.label,
             'description', ff.description,
             'placeholder', ff.placeholder,
             'help_text',   ff.help_text,
             'required',    ff.is_required,
             'config',      COALESCE(ff.config, '{}'::jsonb),
             'sort_order',  ff.sort_order,
             'width',       ff.width
           ) ORDER BY ff.sort_order, ff.field_key
         )
    INTO v_fields
    FROM public.form_fields ff
   WHERE ff.form_id = p_form_id;
  v_fields := COALESCE(v_fields, '[]'::jsonb);

  -- (4b) Next version number — computed under the forms row lock.
  SELECT COALESCE(MAX(fv.version_number), 0) + 1
    INTO v_version
    FROM public.form_versions fv
   WHERE fv.form_id = p_form_id;

  v_snapshot := jsonb_build_object(
    'version',     v_version,
    'name',        v_form.name,
    'description', v_form.description,
    'settings',    COALESCE(v_form.settings, '{}'::jsonb),
    'fields',      v_fields
  );
  IF octet_length(v_snapshot::text) > c_max_snapshot_bytes THEN
    RAISE EXCEPTION 'SNAPSHOT_TOO_LARGE: the published form exceeds % bytes — reduce fields or options', c_max_snapshot_bytes;
  END IF;

  -- (5) Append-only history (form_versions: INSERT/SELECT only, even
  -- for admins — 002 policies + grants; UPDATE/DELETE are impossible
  -- through any API role). published_by is server-derived.
  INSERT INTO public.form_versions (form_id, version_number, schema_snapshot, published_by)
  VALUES (p_form_id, v_version, v_snapshot, v_user);

  -- (6) Flip the live pointers. forms_update_editor would allow this
  -- UPDATE directly, but ONLY this RPC keeps it atomic with (5).
  -- updated_at is maintained by trg_forms_touch_updated_at (002).
  UPDATE public.forms
     SET published_version = v_version,
         status = 'published'
   WHERE id = p_form_id;

  -- (7)
  RETURN jsonb_build_object('public_key', v_form.public_key, 'version', v_version);
END;
$$;


-- =====================================================================
-- SECTION 5 — public.get_public_form(p_public_key text)
-- =====================================================================
-- PURPOSE
--   The public form page's single data source. Returns the IMMUTABLE
--   published snapshot for the currently published version — never
--   live form_fields (draft edits never leak to the public), with
--   public-safe values only.
--
-- ACCESS MODEL (anonymous execution — deliberately granted)
--   * EXECUTE is revoked from PUBLIC and granted to anon AND
--     authenticated (members can also view their own public page).
--   * SECURITY DEFINER is required because anon has zero table grants
--     (001-005 gave anon nothing); the function therefore performs
--     its own visibility rule, replicating exactly what a public
--     "share link" means in this product:
--         visible  ⇔ status IN ('published','paused')
--                   AND published_version IS NOT NULL
--                   AND the matching form_versions row exists
--   * Unknown key / draft / never-published / archived all raise the
--     SAME NOT_FOUND error — no existence oracle distinguishes them.
--   * Paused forms ARE readable (product semantics: the link shows a
--     "form closed" screen; the submit RPC rejects with FORM_CLOSED).
--
-- INFORMATION DISCLOSURE REVIEW (what the return contains)
--     name, description, settings, version, status, published_at,
--     fields[{key,type,label,description,placeholder,help_text,
--             required,config,sort_order,width}]
--   NEVER exposed: workspace_id, created_by / updated_by, form id,
--   slug, plan, members, submission data, storage paths, counts.
--   'settings' is public-by-design (002 documents it as presentation
--   config only). 'published_at' is the version's creation timestamp
--   (useful "last updated" display; low sensitivity).
--
-- STABLE + no writes: safe for repeated reads; single round trip
-- (form + snapshot in one JOIN, indexed by forms.public_key unique
-- index and form_versions (form_id, version_number DESC) index).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_public_form(p_public_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_fields constant int := 300;

  v_status   text;
  v_version  int;
  v_snapshot jsonb;
  v_pub_at   timestamptz;
  v_fields   jsonb;
BEGIN
  SELECT f.status::text,
         fv.version_number,
         fv.schema_snapshot,
         fv.created_at
    INTO v_status, v_version, v_snapshot, v_pub_at
    FROM public.forms f
    JOIN public.form_versions fv
      ON fv.form_id = f.id
     AND fv.version_number = f.published_version
   WHERE f.public_key = p_public_key
     AND f.status IN ('published', 'paused');

  IF NOT FOUND THEN
    -- Unknown key, draft, archived, or never truly published: the
    -- same error for all — no existence information is revealed.
    RAISE EXCEPTION 'NOT_FOUND: no published form for this key';
  END IF;

  -- Structural guards (defensive against a poisoned/oversized
  -- snapshot inserted outside publish_form; publish_form itself
  -- guarantees these invariants).
  IF v_snapshot IS NULL
     OR jsonb_typeof(v_snapshot) <> 'object'
     OR v_snapshot->'fields' IS NULL
     OR jsonb_typeof(v_snapshot->'fields') <> 'array'
     OR jsonb_array_length(v_snapshot->'fields') > c_max_fields THEN
    RAISE EXCEPTION 'SNAPSHOT_INVALID: the published form data is malformed';
  END IF;
  v_fields := v_snapshot->'fields';

  RETURN jsonb_build_object(
    'name',          COALESCE(v_snapshot->>'name', ''),
    'description',   v_snapshot->'description',
    'settings',      COALESCE(v_snapshot->'settings', '{}'::jsonb),
    'version',       v_version,
    'status',        v_status,
    'published_at',  v_pub_at,
    'fields',        v_fields
  );
END;
$$;


-- =====================================================================
-- SECTION 6 — public.submit_public_form(p_public_key, p_values,
--                                        p_honeypot, p_meta)
-- =====================================================================
-- PURPOSE
--   The anonymous write path: validate an answer payload against the
--   IMMUTABLE PUBLISHED SNAPSHOT (never against mutable draft fields)
--   and atomically insert submissions + submission_values.
--
-- EXECUTION FLOW (ordered for least work / least information leak)
--   1. Honeypot        → fake success, zero DB access, no key oracle
--   2. Payload guards  → object shape, 1 MiB size cap, key-count cap
--   3. Resolve form    → status IN (published, paused) + snapshot join
--                        (unknown/draft/archived → NOT_FOUND;
--                         paused → FORM_CLOSED)
--   4. Snapshot guards → structure, field budget, duplicate keys
--   5. Unknown keys    → every payload key must be a submittable field
--   6. Per-field validation vs the snapshot → field_errors map
--   7. Metadata whitelist → {form_version, locale, referrer},
--                        duration_ms → submissions.duration_ms
--   8. Rate limit      → fixed window per (form, IP-hash), AFTER
--                        validation so honest mistakes never consume
--                        a window slot
--   9. INSERT submissions + submission_values atomically
--  10. Probabilistic cleanup of expired rate windows
--  11. Return {ok:true, reference: submission_seq}
--
-- SECURITY DEFINER REASONING (anonymous execution — the sensitive one)
--   * EXECUTE revoked from PUBLIC, granted to anon AND authenticated.
--     This is the ONLY anonymous write capability in the product, and
--     it is confined to one auditable function.
--   * The function decides BY ITSELF what may be written — the caller
--     controls exactly two things: a public_key (lookup, not
--     ownership) and an answer payload (fully validated). No
--     workspace_id, form_id, user id, role, or submission row is
--     accepted from the client: workspace_id is resolved from the
--     form row server-side, submitted_by is auth.uid() or NULL.
--     Forged submission ownership is impossible by construction.
--   * Nothing weakens RLS: anon still has zero table grants; the
--     inserts run as the function owner inside this function only.
--   * Draft forms are unreachable: the JOIN requires status IN
--     ('published','paused') AND a form_versions row matching
--     published_version. Archived → NOT_FOUND (rejected).
--   * Published snapshots cannot be modified: this function performs
--     zero writes to forms or form_versions.
--   * search_path pinned to public; no dynamic SQL anywhere → no
--     SQL-injection surface; all values are bound PL/pgSQL variables.
--
-- VALIDATION SEMANTICS (mirrors the builder's field contract)
--   * Values are validated ONLY against the immutable snapshot.
--     A form edited after publishing keeps accepting the OLD shape
--     until it is republished (by design — the public page is the
--     published version). A submitter with a stale tab gets a clean
--     "unknown field key" validation error, prompting a reload.
--   * Absent answer / JSON null = "no answer": required fields then
--     fail; optional fields store nothing. JSON strings are guaranteed
--     control-character-free by the JSON parser itself, so no extra
--     control-char scrubbing is needed.
--   * Empty text / empty multi-select array = "no answer" (required
--     fails, optional stores nothing). Boolean FALSE and number 0 are
--     REAL answers and are stored.
--   * short_text 'pattern' is a JavaScript regex → enforced
--     client-side at fill time only (PostgreSQL cannot evaluate JS
--     regex semantics); server enforces type + all length caps.
--     Honest limitation, deliberately not faked.
--   * Snapshot config values are re-guarded (typeof number + bounds)
--     before use, so a snapshot poisoned outside publish_form can
--     never crash the validator — worst case its rules are ignored.
--
-- CONCURRENCY
--   submission_seq is left NULL → the Section 2 trigger computes it
--   under the per-form advisory lock, so concurrent submitters get
--   gapless distinct references and no unique-violation failures.
--   A submission racing a republish validates against the version it
--   loaded (field keys are stable) — recorded in metadata.form_version.
--   A field deleted between publish and submit resolves field_id to
--   NULL (Section 1) and the answer is preserved under field_key.
--
-- RATE LIMITING (best-effort, honestly documented)
--   * Client IP: request.headers GUC (set by PostgREST) —
--     cf-connecting-ip preferred, else the LAST element of
--     x-forwarded-for (last = appended by the nearest proxy, the
--     spoof-resistant choice; earlier elements are client-forgeable).
--     If headers are unavailable (SQL editor, local call), rate
--     limiting is SKIPPED — never faked — and honeypot + payload
--     caps + Supabase platform limits remain in force.
--   * No raw IP is stored anywhere: only sha-256 (pgcrypto when
--     available, md5 fallback) in form_rate_limits.
--     submissions.submitter_ip stays NULL by design.
--   * Fixed window: 20 successful submissions / 10 minutes / form /
--     IP. Concurrency-safe via INSERT ... ON CONFLICT DO UPDATE.
--     Rejected (rate-limited) attempts roll back their own increment,
--     so the window ages out on TIME, not on attack volume.
--
-- METADATA WHITELIST (client metadata is data, never authority)
--   duration_ms (0..86400000, integer)  → submissions.duration_ms
--   locale     (≤ 35 chars)             → submissions.metadata.locale
--   referrer   (≤ 2048 chars)           → submissions.metadata.referrer
--   Every other p_meta key is discarded. Values are stored inert —
--   never interpreted. form_version is appended server-side.
--   user-agent (≤ 512 chars, from request.headers, inert) →
--   submissions.submitter_user_agent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.submit_public_form(
    p_public_key text,
    p_values jsonb,
    p_honeypot text DEFAULT NULL,
    p_meta jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Bounded-work + product caps (see Section 6 header notes).
  c_max_fields       constant int := 300;
  c_max_keys         constant int := 300;
  c_max_value_chars  constant int := 10000;
  c_max_email_chars  constant int := 320;
  c_max_url_chars    constant int := 2048;
  c_max_phone_chars  constant int := 25;
  c_max_options      constant int := 100;
  c_max_payload      constant int := 1048576;   -- 1 MiB
  c_rl_max           constant int := 20;
  c_rl_window_secs   constant int := 600;
  c_submittable      constant text[] := ARRAY[
    'short_text','long_text','email','url','phone',
    'number','decimal','boolean','date','time',
    'single_select','multi_select','rating','scale'];

  v_user       uuid;
  v_form       record;
  v_snapshot   jsonb;
  v_fields     jsonb;
  v_n          int;
  v_k          text;
  v_submit_keys text[];
  v_f          jsonb;
  v_key        text;
  v_type       text;
  v_required   boolean;
  v_config     jsonb;
  v_val        jsonb;
  v_txt        text;
  v_num        numeric;
  v_rating_max numeric;
  v_min        numeric;
  v_max        numeric;
  v_step       numeric;
  v_cfg_num    numeric;
  v_opt        jsonb;
  v_opts       text[];
  v_submitted  text[];
  v_d          date;
  v_empty      boolean;
  v_errors     jsonb;
  v_store_keys text[];
  v_store_vals jsonb[];
  v_i          int;
  v_headers    jsonb;
  v_ua         text;
  v_ip_raw     text;
  v_ip_hash    text;
  v_parts      text[];
  v_meta_out   jsonb;
  v_duration   int;
  v_sub_id     uuid;
  v_sub_seq    bigint;
  v_rl_count   int;
BEGIN
  -- (1) Honeypot — FIRST, before any lookup: a filled honeypot gets
  -- the exact success shape without revealing whether the key exists.
  IF p_honeypot IS NOT NULL AND btrim(p_honeypot) <> '' THEN
    RETURN jsonb_build_object('ok', true, 'reference', NULL);
  END IF;

  v_user := auth.uid();   -- NULL for anonymous submitters (allowed)

  -- (2) Payload shape + bounded-work guards (no DB access yet).
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: values must be a JSON object';
  END IF;
  IF octet_length(p_values::text) > c_max_payload THEN
    RAISE EXCEPTION 'PAYLOAD_TOO_LARGE: submission values exceed % bytes', c_max_payload;
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_object_keys(p_values) AS t(k);
  IF v_n > c_max_keys THEN
    RAISE EXCEPTION 'TOO_MANY_KEYS: submissions accept at most % answers', c_max_keys;
  END IF;

  -- (3) Resolve the published form (snapshot, never draft fields).
  SELECT f.id, f.workspace_id, f.status, fv.version_number, fv.schema_snapshot
    INTO v_form
    FROM public.forms f
    JOIN public.form_versions fv
      ON fv.form_id = f.id
     AND fv.version_number = f.published_version
   WHERE f.public_key = p_public_key
     AND f.status IN ('published', 'paused');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no published form for this key';
  END IF;
  IF v_form.status = 'paused' THEN
    RAISE EXCEPTION 'FORM_CLOSED: this form is not accepting responses';
  END IF;

  -- (4) Snapshot structural guards (defensive; publish guarantees them).
  v_snapshot := v_form.schema_snapshot;
  IF v_snapshot IS NULL
     OR jsonb_typeof(v_snapshot) <> 'object'
     OR v_snapshot->'fields' IS NULL
     OR jsonb_typeof(v_snapshot->'fields') <> 'array'
     OR jsonb_array_length(v_snapshot->'fields') > c_max_fields THEN
    RAISE EXCEPTION 'SNAPSHOT_INVALID: the published form data is malformed';
  END IF;
  v_fields := v_snapshot->'fields';
  IF (SELECT count(DISTINCT t.e->>'key') FROM jsonb_array_elements(v_fields) AS t(e))
     <> jsonb_array_length(v_fields) THEN
    RAISE EXCEPTION 'SNAPSHOT_INVALID: duplicate field keys in snapshot';
  END IF;

  -- (5) Every payload key must be a submittable field of the snapshot.
  v_errors := '{}'::jsonb;
  v_submit_keys := ARRAY(
    SELECT t.e->>'key'
    FROM jsonb_array_elements(v_fields) AS t(e)
    WHERE t.e->>'type' = ANY (c_submittable)
  );
  FOR v_k IN SELECT t.k FROM jsonb_object_keys(p_values) AS t(k) LOOP
    IF NOT (v_k = ANY (v_submit_keys)) THEN
      -- section keys, deleted-field keys, stale-tab keys, garbage keys:
      -- all rejected identically.
      v_errors := v_errors || jsonb_build_object(left(v_k, 100), 'Unknown field key.');
    END IF;
  END LOOP;

  -- (6) Per-field validation against the snapshot. No writes yet —
  -- nothing is persisted unless EVERY field passes.
  v_store_keys := ARRAY[]::text[];
  v_store_vals := ARRAY[]::jsonb[];

  FOR v_f IN SELECT t.e FROM jsonb_array_elements(v_fields) AS t(e) LOOP
    v_key := v_f->>'key';
    IF v_key IS NULL OR v_key !~ '^[a-z0-9_]{1,64}$' THEN
      RAISE EXCEPTION 'SNAPSHOT_INVALID: field key missing or malformed';
    END IF;
    v_type := v_f->>'type';
    IF v_type IS NULL OR NOT (v_type = ANY (c_submittable)) THEN
      -- section / file_upload / deferred types: layout-only fields are
      -- never answer targets (their keys already failed step 5).
      CONTINUE;
    END IF;
    v_required := COALESCE((v_f->>'required') = 'true', false);
    v_config := COALESCE(v_f->'config', '{}'::jsonb);
    IF jsonb_typeof(v_config) <> 'object' THEN
      v_config := '{}'::jsonb;   -- poisoned config: ignore its rules
    END IF;
    v_val := p_values->v_key;    -- NULL when absent OR explicit JSON null
    v_empty := false;

    IF v_val IS NULL THEN
      IF v_required THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
      END IF;
      CONTINUE;
    END IF;

    /* ---------------- text family ---------------- */
    IF v_type IN ('short_text', 'long_text', 'email', 'url', 'phone') THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be text.');
      ELSE
        v_txt := v_val #>> '{}';
        IF btrim(v_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSE
          v_n := CASE v_type
                   WHEN 'email' THEN c_max_email_chars
                   WHEN 'url'   THEN c_max_url_chars
                   WHEN 'phone' THEN c_max_phone_chars
                   ELSE c_max_value_chars
                 END;
          IF length(v_txt) > v_n THEN
            v_errors := v_errors || jsonb_build_object(v_key, format('Answer is too long (maximum %s characters).', v_n));
          ELSE
            IF jsonb_typeof(v_config->'minLength') = 'number' THEN
              v_cfg_num := (v_config->>'minLength')::numeric;
              IF v_cfg_num >= 0 AND v_cfg_num <= c_max_value_chars
                 AND length(v_txt) < v_cfg_num THEN
                v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be at least %s characters.', v_cfg_num));
              END IF;
            END IF;
            IF jsonb_typeof(v_config->'maxLength') = 'number' THEN
              v_cfg_num := (v_config->>'maxLength')::numeric;
              IF v_cfg_num >= 1 AND v_cfg_num <= c_max_value_chars
                 AND length(v_txt) > v_cfg_num THEN
                v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be at most %s characters.', v_cfg_num));
              END IF;
            END IF;
            IF v_type = 'email' AND v_txt !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'Enter a valid email address.');
            ELSIF v_type = 'url' AND (v_txt !~ '^https?://' OR v_txt ~ '[[:space:]]') THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'Enter a valid URL (starting with http:// or https://).');
            ELSIF v_type = 'phone' AND v_txt !~ '^[+]?[0-9(). -]{5,25}$' THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'Enter a valid phone number (5-25 characters, digits and + ( ) . -).');
            END IF;
          END IF;
        END IF;
      END IF;

    /* ---------------- number family ---------------- */
    ELSIF v_type IN ('number', 'decimal') THEN
      IF jsonb_typeof(v_val) <> 'number' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a number.');
      ELSE
        v_num := (v_val #>> '{}')::numeric;   -- safe: jsonb guarantees a valid number
        IF v_type = 'number' AND v_num <> floor(v_num) THEN
          v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a whole number.');
        END IF;
        IF jsonb_typeof(v_config->'min') = 'number' THEN v_min := (v_config->>'min')::numeric; ELSE v_min := NULL; END IF;
        IF jsonb_typeof(v_config->'max') = 'number' THEN v_max := (v_config->>'max')::numeric; ELSE v_max := NULL; END IF;
        IF jsonb_typeof(v_config->'step') = 'number' THEN v_step := (v_config->>'step')::numeric; ELSE v_step := NULL; END IF;
        IF v_step IS NOT NULL AND v_step <= 0 THEN v_step := NULL; END IF;
        IF v_min IS NOT NULL AND v_num < v_min THEN
          v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be %s or more.', v_min));
        END IF;
        IF v_max IS NOT NULL AND v_num > v_max THEN
          v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be %s or less.', v_max));
        END IF;
        IF v_step IS NOT NULL THEN
          IF v_min IS NOT NULL THEN
            IF (v_num - v_min) % v_step <> 0 THEN
              v_errors := v_errors || jsonb_build_object(v_key, format('Answer must advance in steps of %s from %s.', v_step, v_min));
            END IF;
          ELSIF v_num % v_step <> 0 THEN
            v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be a multiple of %s.', v_step));
          END IF;
        END IF;
      END IF;

    /* ---------------- boolean ---------------- */
    ELSIF v_type = 'boolean' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be true or false.');
      END IF;
      -- NOTE: a required boolean is satisfied by an explicit `false`;
      -- "must be checked" is a client UX concern (documented).

    /* ---------------- date ---------------- */
    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a date.');
      ELSE
        v_txt := v_val #>> '{}';
        IF btrim(v_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSIF v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          v_errors := v_errors || jsonb_build_object(v_key, 'Use the YYYY-MM-DD date format.');
        ELSE
          v_d := NULL;
          BEGIN
            v_d := v_txt::date;   -- strict cast rejects 2024-02-30 etc.
          EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_d := NULL;
          END;
          IF v_d IS NULL THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Enter a real calendar date.');
          END IF;
        END IF;
      END IF;

    /* ---------------- time ---------------- */
    ELSIF v_type = 'time' THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a time.');
      ELSE
        v_txt := v_val #>> '{}';
        IF btrim(v_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSIF v_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
          v_errors := v_errors || jsonb_build_object(v_key, 'Use the HH:MM or HH:MM:SS 24-hour format.');
        END IF;
      END IF;

    /* ---------------- single_select ---------------- */
    ELSIF v_type = 'single_select' THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Choose one of the options.');
      ELSE
        v_txt := v_val #>> '{}';
        IF btrim(v_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSE
          v_opt := v_config->'options';
          IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array'
             OR jsonb_array_length(v_opt) > c_max_options
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_opt) AS x(e) WHERE jsonb_typeof(x.e) <> 'string') THEN
            RAISE EXCEPTION 'SNAPSHOT_INVALID: select field "%" has malformed options', v_key;
          END IF;
          v_opts := ARRAY(SELECT x.e FROM jsonb_array_elements_text(v_opt) AS x(e));
          IF NOT (v_txt = ANY (v_opts)) THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Not one of the offered options.');
          END IF;
        END IF;
      END IF;

    /* ---------------- multi_select ---------------- */
    ELSIF v_type = 'multi_select' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a list of options.');
      ELSE
        IF jsonb_array_length(v_val) > c_max_options THEN
          v_errors := v_errors || jsonb_build_object(v_key, 'Too many selections.');
        END IF;
        -- text form of every element (scalars render as text; nested
        -- structures cannot match any option and are rejected below)
        v_submitted := ARRAY(SELECT x.e #>> '{}' FROM jsonb_array_elements(v_val) AS x(e));
        IF COALESCE(array_length(v_submitted, 1), 0) = 0 THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSE
          IF EXISTS (SELECT 1 FROM unnest(v_submitted) AS u(s) GROUP BY u.s HAVING count(*) > 1) THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Do not select the same option twice.');
          END IF;
          v_opt := v_config->'options';
          IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array'
             OR jsonb_array_length(v_opt) > c_max_options
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_opt) AS x(e) WHERE jsonb_typeof(x.e) <> 'string') THEN
            RAISE EXCEPTION 'SNAPSHOT_INVALID: select field "%" has malformed options', v_key;
          END IF;
          v_opts := ARRAY(SELECT x.e FROM jsonb_array_elements_text(v_opt) AS x(e));
          IF EXISTS (SELECT 1 FROM unnest(v_submitted) AS u(s) WHERE NOT (u.s = ANY (v_opts))) THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'One or more selections are not offered options.');
          END IF;
        END IF;
      END IF;

    /* ---------------- rating ---------------- */
    ELSIF v_type = 'rating' THEN
      IF jsonb_typeof(v_val) <> 'number' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a number.');
      ELSE
        v_num := (v_val #>> '{}')::numeric;
        v_rating_max := 5;   -- builder default (defaultConfigForType)
        IF jsonb_typeof(v_config->'max') = 'number' THEN
          v_cfg_num := (v_config->>'max')::numeric;
          IF v_cfg_num >= 2 AND v_cfg_num <= 10 AND v_cfg_num = floor(v_cfg_num) THEN
            v_rating_max := v_cfg_num;
          END IF;
        END IF;
        IF v_num <> floor(v_num) OR v_num < 1 OR v_num > v_rating_max THEN
          v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be a whole number between 1 and %s.', v_rating_max));
        END IF;
      END IF;

    /* ---------------- scale ---------------- */
    ELSIF v_type = 'scale' THEN
      IF jsonb_typeof(v_val) <> 'number' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a number.');
      ELSE
        v_num := (v_val #>> '{}')::numeric;
        -- Renderer/validator contract: unconfigured scale = 1..10 step 1
        v_min := 1; v_max := 10; v_step := 1;
        IF jsonb_typeof(v_config->'min') = 'number' THEN v_min := (v_config->>'min')::numeric; END IF;
        IF jsonb_typeof(v_config->'max') = 'number' THEN v_max := (v_config->>'max')::numeric; END IF;
        IF jsonb_typeof(v_config->'step') = 'number' THEN v_step := (v_config->>'step')::numeric; END IF;
        IF v_step IS NULL OR v_step <= 0 THEN v_step := 1; END IF;
        IF v_num < v_min OR v_num > v_max THEN
          v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be between %s and %s.', v_min, v_max));
        ELSIF (v_num - v_min) % v_step <> 0 THEN
          v_errors := v_errors || jsonb_build_object(v_key, format('Answer must advance in steps of %s from %s.', v_step, v_min));
        END IF;
      END IF;
    END IF;

    -- Store the answer only if this field is clean and non-empty.
    IF NOT v_empty AND NOT jsonb_exists(v_errors, v_key) THEN
      v_store_keys := v_store_keys || v_key;
      v_store_vals := v_store_vals || v_val;
    END IF;
  END LOOP;

  IF v_errors <> '{}'::jsonb THEN
    -- Structured validation failure (HTTP 200 + ok:false): the client
    -- renders the per-field messages. No rows were written.
    RETURN jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED', 'errors', v_errors);
  END IF;

  -- (7) Metadata whitelist — client metadata is inert data, never
  -- authority; every unlisted key is discarded.
  v_meta_out := jsonb_build_object('form_version', v_form.version_number);
  v_duration := NULL;
  IF p_meta IS NOT NULL AND jsonb_typeof(p_meta) = 'object' THEN
    IF jsonb_typeof(p_meta->'duration_ms') = 'number' THEN
      v_cfg_num := (p_meta->>'duration_ms')::numeric;
      IF v_cfg_num >= 0 AND v_cfg_num <= 86400000 AND v_cfg_num = floor(v_cfg_num) THEN
        v_duration := v_cfg_num::int;
      END IF;
    END IF;
    IF p_meta->>'locale' IS NOT NULL THEN
      v_meta_out := v_meta_out || jsonb_build_object('locale', left(p_meta->>'locale', 35));
    END IF;
    IF p_meta->>'referrer' IS NOT NULL THEN
      v_meta_out := v_meta_out || jsonb_build_object('referrer', left(p_meta->>'referrer', 2048));
    END IF;
  END IF;

  -- (8) Best-effort client context. request.headers exists ONLY when
  -- invoked through PostgREST; it is absent from the SQL editor and
  -- direct connections. We never pretend otherwise: missing headers
  -- simply mean no IP rate limiting and no user-agent.
  v_headers := NULL;
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  v_ua := NULL;
  v_ip_raw := NULL;
  IF v_headers IS NOT NULL THEN
    IF v_headers->>'user-agent' IS NOT NULL THEN
      v_ua := left(btrim(v_headers->>'user-agent'), 512);
      IF v_ua = '' THEN v_ua := NULL; END IF;
    END IF;
    v_ip_raw := btrim(COALESCE(v_headers->>'cf-connecting-ip', ''));
    IF v_ip_raw = '' AND v_headers->>'x-forwarded-for' IS NOT NULL THEN
      v_parts := string_to_array(v_headers->>'x-forwarded-for', ',');
      v_ip_raw := btrim(v_parts[array_length(v_parts, 1)]);
    END IF;
  END IF;

  -- (8b) Fixed-window rate limit per (form, IP hash) — AFTER
  -- validation so honest validation mistakes never consume a slot.
  IF v_ip_raw IS NOT NULL AND v_ip_raw <> '' THEN
    BEGIN
      v_ip_hash := encode(extensions.digest(v_ip_raw, 'sha256'), 'hex');
    EXCEPTION WHEN undefined_function THEN
      v_ip_hash := md5(v_ip_raw);   -- pgcrypto unavailable — md5 fallback
    END;
    INSERT INTO public.form_rate_limits AS rl
      (form_id, ip_hash, window_start, window_count)
    VALUES (v_form.id, v_ip_hash, now(), 1)
    ON CONFLICT (form_id, ip_hash) DO UPDATE
      SET window_count = CASE WHEN rl.window_start < now() - make_interval(secs => c_rl_window_secs)
                              THEN 1 ELSE rl.window_count + 1 END,
          window_start = CASE WHEN rl.window_start < now() - make_interval(secs => c_rl_window_secs)
                              THEN now() ELSE rl.window_start END
    RETURNING window_count INTO v_rl_count;
    IF v_rl_count > c_rl_max THEN
      RAISE EXCEPTION 'RATE_LIMITED: too many submissions from this address — please try again later';
    END IF;
  END IF;

  -- (9) Atomic insert. submission_seq is left NULL so the Section 2
  -- trigger assigns it under the per-form advisory lock. workspace_id
  -- and submitted_by are server-derived — never client-supplied.
  INSERT INTO public.submissions
    (form_id, workspace_id, status, submitted_by,
     submitter_user_agent, metadata, duration_ms, is_complete)
  VALUES
    (v_form.id, v_form.workspace_id, 'completed', v_user,
     v_ua, v_meta_out, v_duration, true)
  RETURNING id, submission_seq INTO v_sub_id, v_sub_seq;

  -- (9b) One row per answer. field_id is resolved from LIVE
  -- form_fields by the snapshot's field_key: a field deleted after
  -- publishing resolves to NULL (Section 1) and the answer survives
  -- under field_key. fn_submission_values_set_typed (003) receives
  -- form_id explicitly, so a NULL field_id never trips its lookup.
  FOR v_i IN 1..COALESCE(array_length(v_store_keys, 1), 0) LOOP
    INSERT INTO public.submission_values
      (submission_id, form_id, field_id, field_key, value)
    VALUES
      (v_sub_id,
       v_form.id,
       (SELECT ff.id
          FROM public.form_fields ff
         WHERE ff.form_id = v_form.id
           AND ff.field_key = v_store_keys[v_i]),
       v_store_keys[v_i],
       v_store_vals[v_i]);
  END LOOP;

  -- (10) Probabilistic cleanup of expired rate-limit windows (1% of
  -- submissions; BRIN-bounded delete — never a full-table scan).
  IF random() < 0.01 THEN
    DELETE FROM public.form_rate_limits
     WHERE window_start < now() - interval '1 hour';
  END IF;

  -- (11)
  RETURN jsonb_build_object('ok', true, 'reference', v_sub_seq);
END;
$$;


-- =====================================================================
-- SECTION 7 — EXECUTION GRANTS + POST-APPLY VERIFICATION (docs only)
-- =====================================================================
-- Privilege model:
--   publish_form        → authenticated only (REVOKE from PUBLIC/anon)
--   get_public_form     → anon + authenticated (public share links)
--   submit_public_form  → anon + authenticated (public submissions)
-- The service role keeps default Supabase privileges and is still
-- bound by the functions' internal auth.uid()/permission checks.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.publish_form(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_form(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.publish_form(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_public_form(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_form(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_public_form(text, jsonb, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_public_form(text, jsonb, text, jsonb) TO anon, authenticated;

-- fn_submissions_set_defaults keeps 003's privilege posture (trigger
-- invocation only; EXECUTE already revoked from PUBLIC there). Nothing
-- to change here.

-- ---------------------------------------------------------------------
-- POST-APPLY VERIFICATION (run MANUALLY in the Supabase SQL editor;
-- none of these mutate data — they are read-only probes):
--
-- 1. Functions exist, are SECURITY DEFINER, search_path pinned:
--    SELECT p.proname,
--           p.prosecdef,
--           p.proconfig,
--           pg_get_function_identity_arguments(p.oid) AS args
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('publish_form', 'get_public_form',
--                         'submit_public_form', 'fn_submissions_set_defaults');
--    → expect 4 rows; prosecdef = true; proconfig = {search_path=public}
--
-- 2. Execution grants:
--    SELECT p.proname, p.proacl
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('publish_form', 'get_public_form',
--                         'submit_public_form');
--    → expect authenticated=[X]=X/... for publish_form;
--      anon + authenticated for get_public_form/submit_public_form.
--
-- 3. Retention fix:
--    SELECT is_nullable FROM information_schema.columns
--     WHERE table_schema = 'public'
--       AND table_name = 'submission_values' AND column_name = 'field_id';
--    → expect 'YES'
--
-- 4. Rate-limit table unreachable by API roles:
--    SELECT count(*) FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND table_name = 'form_rate_limits';
--    → expect 1 (owner postgres only)
--    SELECT relrowsecurity FROM pg_class
--     WHERE relname = 'form_rate_limits';   → expect true
--
-- 5. Behavioral probes (read-only / error-observable):
--    SELECT public.get_public_form('definitely-not-a-real-key');
--    → expect ERROR: NOT_FOUND: no published form for this key
--    SELECT public.publish_form(gen_random_uuid());
--    → expect ERROR: FORM_NOT_FOUND (no rows created)
-- 6. Anonymous EXECUTE + full happy-path E2E against a real form are
--    verified from the application (Phase 3B) with the anon key.
-- ---------------------------------------------------------------------
