-- =====================================================================
-- FormNull Migration 007 — Field System 2.0 Phase 2: staged field types
-- (date & time, address, matrix) join the public-submission contract.
-- =====================================================================
--
-- WHY THIS MIGRATION IS REQUIRED
-- -------------------------------
-- The Phase 2 field rebuild added three field types whose enum values
-- already exist in 002's field_type ('datetime', 'address', 'matrix')
-- but which migration 006's submit_public_form deliberately listed in
-- its c_submittable whitelist... it did not — 006 predates them. The
-- app layer (Field System 2.0 registry) has shipped full support
-- (builder, property editors, renderer, client validation), and these
-- three types are held OUT of the field library ("staged") until this
-- migration is applied. Without it their answers are rejected with
-- "Unknown field key" — with it they validate end-to-end.
--
-- WHAT CHANGES
-- ------------
-- 1. submit_public_form:
--    - c_submittable gains 'datetime', 'address', 'matrix'.
--    - datetime: string 'YYYY-MM-DD HH:MM' (or with 'T' separator),
--      strict ::timestamp cast (impossible dates rejected), optional
--      config minDate/maxDate bounds (server-enforced).
--    - address: JSON object of whitelisted parts (line1, line2, city,
--      state, postal_code, country), per-part length caps, country as
--      2-letter ISO code, required => line1 + city + country filled.
--    - matrix: JSON object {rowValue: columnValue}; keys must be
--      offered rows, values offered columns, required => every row
--      answered.
--    - Three loop variables + three DECLARE additions. Nothing else
--      in the 1,200-line body is touched: it was extracted verbatim
--      from 006 and extended by exact string insertion.
-- 2. publish_form:
--    - Config validation branches for datetime (minDate/maxDate
--      format) and matrix (rows/columns arrays: unique non-empty
--      strings, same caps as select options). Address carries
--      presentation-only config (part visibility switches) that the
--      snapshot passes through unchanged.
--
-- WHAT DOES *NOT* CHANGE
-- ----------------------
-- - No table, column, index, policy, grant, or enum changes.
-- - No change to how the 14 previously-submittable types validate:
--   their branches are byte-identical to 006.
-- - Existing published snapshots and submissions are unaffected
--   (old versions never contained these types).
-- - Backward compatible both directions: rolling back = re-run 006's
--   function definitions (the old bodies), which this file's header
--   keeps available in git history.
--
-- IDempotency: CREATE OR REPLACE — safe to re-run.
-- Access model: unchanged (publish: authenticated; submit: anon+auth).
--
-- POST-APPLY VERIFICATION PROBES (read-only)
-- ------------------------------------------
--  1. SELECT public.submit_public_form('definitely-not-a-key', '{}');
--     → NOT_FOUND (function signature + honeypot path intact)
--  2. Re-run scripts/fs2p2-invalid-submissions.ts <key> after
--     publishing a form that contains the staged types — the datetime/
--     address/matrix probes must return their specific messages.
--  3. app probe: bun run scripts/fs2p2-probe-007.ts  (submittable
--     census via a throwaway published form is NOT needed — the
--     signature probe above plus the E2E suffice).
--  4. Registry activation: after applying, flip status "staged" →
--     "active" (+submittable/publishable true) for datetime, address,
--     matrix in src/features/forms/field-registry.ts (3 small edits).
--
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

    ELSIF r.ftype = 'datetime' THEN
      -- minDate/maxDate (client-validated in the builder; here they are
      -- structurally guarded so a poisoned config can never reach the
      -- snapshot with malformed bounds).
      v_cfg := v_config->>'minDate';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" datetime minDate must be YYYY-MM-DD HH:MM', r.field_key;
      END IF;
      v_cfg := v_config->>'maxDate';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" datetime maxDate must be YYYY-MM-DD HH:MM', r.field_key;
      END IF;

    ELSIF r.ftype = 'matrix' THEN
      -- rows and columns mirror the select-options contract: arrays of
      -- unique non-empty strings, bounded by the same caps.
      v_opt := v_config->'rows';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: matrix field "%" needs a rows array', r.field_key;
      END IF;
      SELECT count(*),
             count(DISTINCT x.e #>> '{}'),
             count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'string'),
             count(*) FILTER (WHERE length(x.e #>> '{}') NOT BETWEEN 1 AND c_max_option_len)
        INTO v_n, v_distinct, v_nonstr, v_badlen
        FROM jsonb_array_elements(v_opt) AS x(e);
      IF v_n < 1 OR v_n > c_max_options OR v_nonstr > 0 OR v_badlen > 0 OR v_distinct <> v_n THEN
        RAISE EXCEPTION 'CONFIG_INVALID: matrix field "%" rows must be % unique non-empty strings of 1-% characters', r.field_key, c_max_options, c_max_option_len;
      END IF;
      v_opt := v_config->'columns';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: matrix field "%" needs a columns array', r.field_key;
      END IF;
      SELECT count(*),
             count(DISTINCT x.e #>> '{}'),
             count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'string'),
             count(*) FILTER (WHERE length(x.e #>> '{}') NOT BETWEEN 1 AND c_max_option_len)
        INTO v_n, v_distinct, v_nonstr, v_badlen
        FROM jsonb_array_elements(v_opt) AS x(e);
      IF v_n < 1 OR v_n > c_max_options OR v_nonstr > 0 OR v_badlen > 0 OR v_distinct <> v_n THEN
        RAISE EXCEPTION 'CONFIG_INVALID: matrix field "%" columns must be % unique non-empty strings of 1-% characters', r.field_key, c_max_options, c_max_option_len;
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
    'single_select','multi_select','rating','scale',
    'datetime','address','matrix'];

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
  v_ts         timestamp;
  v_ts_min     timestamp;
  v_ts_max     timestamp;
  v_rec        jsonb;
  v_rec_key    text;
  v_rec_val    text;
  v_rows       text[];
  v_cols       text[];
  v_row        text;
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

    /* ---------------- datetime (007) ---------------- */
    ELSIF v_type = 'datetime' THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be a date and time.');
      ELSE
        v_txt := replace(v_val #>> '{}', 'T', ' ');
        IF btrim(v_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSIF v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$' THEN
          v_errors := v_errors || jsonb_build_object(v_key, 'Use the YYYY-MM-DD HH:MM format.');
        ELSE
          v_ts := NULL;
          BEGIN
            v_ts := v_txt::timestamp;   -- strict cast rejects impossible dates
          EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_ts := NULL;
          END;
          IF v_ts IS NULL THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Enter a real date and time.');
          ELSE
            v_ts_min := NULL;
            v_ts_max := NULL;
            IF v_config->>'minDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}$' THEN
              v_ts_min := replace(v_config->>'minDate', 'T', ' ')::timestamp;
            END IF;
            IF v_config->>'maxDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}$' THEN
              v_ts_max := replace(v_config->>'maxDate', 'T', ' ')::timestamp;
            END IF;
            IF v_ts_min IS NOT NULL AND v_ts < v_ts_min THEN
              v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be at or after %s.', to_char(v_ts_min, 'YYYY-MM-DD HH24:MI')));
            END IF;
            IF v_ts_max IS NOT NULL AND v_ts > v_ts_max THEN
              v_errors := v_errors || jsonb_build_object(v_key, format('Answer must be at or before %s.', to_char(v_ts_max, 'YYYY-MM-DD HH24:MI')));
            END IF;
          END IF;
        END IF;
      END IF;

    /* ---------------- address (007) ---------------- */
    ELSIF v_type = 'address' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Answer must be an address.');
      ELSE
        v_rec := v_val;
        -- Whitelist the known parts; anything else is rejected outright
        -- (the client never sends other keys, but the server decides).
        v_txt := '';
        FOR v_rec_key IN SELECT t.k FROM jsonb_object_keys(v_rec) AS t(k) LOOP
          IF v_rec_key NOT IN ('line1','line2','city','state','postal_code','country') THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Unknown address part.');
            EXIT;
          END IF;
          v_rec_val := v_rec->>v_rec_key;
          IF v_rec_val IS NULL OR jsonb_typeof(v_rec->v_rec_key) <> 'string' THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Address parts must be text.');
            EXIT;
          END IF;
          v_txt := v_txt || btrim(v_rec_val);
        END LOOP;
        IF v_txt = '' AND NOT jsonb_exists(v_errors, v_key) THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSIF NOT jsonb_exists(v_errors, v_key) THEN
          -- Per-part length caps (mirror the client validator).
          IF length(COALESCE(v_rec->>'line1','')) > 200
             OR length(COALESCE(v_rec->>'line2','')) > 200
             OR length(COALESCE(v_rec->>'city','')) > 200
             OR length(COALESCE(v_rec->>'state','')) > 200
             OR length(COALESCE(v_rec->>'postal_code','')) > 20
             OR length(COALESCE(v_rec->>'country','')) > 60 THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'One of the address parts is too long.');
          END IF;
          IF v_rec->>'country' IS NOT NULL AND v_rec->>'country' !~ '^[A-Z]{2}$' THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Country must be a 2-letter code.');
          END IF;
          IF v_required
             AND (btrim(COALESCE(v_rec->>'line1','')) = ''
               OR btrim(COALESCE(v_rec->>'city','')) = ''
               OR btrim(COALESCE(v_rec->>'country','')) = '') THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'A required address needs the street, city and country.');
          END IF;
        END IF;
      END IF;

    /* ---------------- matrix (007) ---------------- */
    ELSIF v_type = 'matrix' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Pick one column for each row.');
      ELSE
        v_rec := v_val;
        v_rows := ARRAY(SELECT x.e FROM jsonb_array_elements_text(COALESCE(v_config->'rows', '[]'::jsonb)) AS x(e));
        v_cols := ARRAY(SELECT x.e FROM jsonb_array_elements_text(COALESCE(v_config->'columns', '[]'::jsonb)) AS x(e));
        IF (SELECT count(*) FROM jsonb_object_keys(v_rec) AS t(k)) = 0 THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSE
          -- Every submitted key must be an offered row; every value an
          -- offered column.
          FOR v_rec_key IN SELECT t.k FROM jsonb_object_keys(v_rec) AS t(k) LOOP
            IF NOT (v_rec_key = ANY (v_rows)) THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'One of the rows is no longer offered.');
              EXIT;
            END IF;
            v_rec_val := v_rec->>v_rec_key;
            IF v_rec_val IS NULL OR jsonb_typeof(v_rec->v_rec_key) <> 'string'
               OR NOT (v_rec_val = ANY (v_cols)) THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'Pick one of the offered columns.');
              EXIT;
            END IF;
          END LOOP;
          IF NOT jsonb_exists(v_errors, v_key) AND v_required THEN
            FOREACH v_row IN ARRAY v_rows LOOP
              IF v_rec->>v_row IS NULL THEN
                v_errors := v_errors || jsonb_build_object(v_key, 'Answer every row to continue.');
                EXIT;
              END IF;
            END LOOP;
          END IF;
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
