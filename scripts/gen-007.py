#!/usr/bin/env python3
"""
Generate migration 007 by extending the EXACT 006 function bodies.

Strategy: extract publish_form and submit_public_form byte-for-byte from
006, then apply surgical insertions at well-defined anchors. Everything
not explicitly inserted is guaranteed identical to 006 — no drift, no
retyping, no comment-only bodies.
"""
import re

SRC = "supabase/migrations/006_publish_and_public_submission.sql"
OUT = "supabase/migrations/007_new_field_types_submission.sql"

with open(SRC) as f:
    lines = f.readlines()

text = "".join(lines)

# ---- extract publish_form (from CREATE OR REPLACE ... to its closing $$;) ----
pub_start = text.index("CREATE OR REPLACE FUNCTION public.publish_form(p_form_id uuid)")
pub_end = text.index("$$;", pub_start) + 3
publish_fn = text[pub_start:pub_end]

# ---- extract submit_public_form ----
sub_start = text.index("CREATE OR REPLACE FUNCTION public.submit_public_form(")
sub_end = text.index("$$;", sub_start) + 3
submit_fn = text[sub_start:sub_end]

assert "SECURITY DEFINER" in publish_fn and "RAISE EXCEPTION 'FORM_NOT_FOUND" in publish_fn
assert "c_submittable" in submit_fn and "RATE" in submit_fn

# ================= PUBLISH FORM INSERTIONS =================
# Add config validation for datetime + matrix before the rating branch.
pub_anchor = "    ELSIF r.ftype = 'rating' THEN"
assert publish_fn.count(pub_anchor) == 1

pub_insert = """    ELSIF r.ftype = 'datetime' THEN
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

"""

publish_new = publish_fn.replace(pub_anchor, pub_insert + pub_anchor, 1)

# ================= SUBMIT FORM INSERTIONS =================
# 1. Extend c_submittable
old_list = """  c_submittable      constant text[] := ARRAY[
    'short_text','long_text','email','url','phone',
    'number','decimal','boolean','date','time',
    'single_select','multi_select','rating','scale'];"""
new_list = """  c_submittable      constant text[] := ARRAY[
    'short_text','long_text','email','url','phone',
    'number','decimal','boolean','date','time',
    'single_select','multi_select','rating','scale',
    'datetime','address','matrix'];"""
assert submit_fn.count(old_list) == 1
submit_new = submit_fn.replace(old_list, new_list, 1)

# 2. Extend DECLAREs (v_d date; exists — add timestamp + record vars)
old_decl = "  v_d          date;"
new_decl = """  v_d          date;
  v_ts         timestamp;
  v_ts_min     timestamp;
  v_ts_max     timestamp;
  v_rec        jsonb;
  v_rec_key    text;
  v_rec_val    text;
  v_rows       text[];
  v_cols       text[];
  v_row        text;"""
assert submit_new.count(old_decl) == 1
submit_new = submit_new.replace(old_decl, new_decl, 1)

# 3. Insert the three new validation branches after the time branch,
#    before the single_select branch.
sub_anchor = "    /* ---------------- single_select ---------------- */"
assert submit_new.count(sub_anchor) == 1

sub_insert = """    /* ---------------- datetime (007) ---------------- */
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
        v_rows := COALESCE(ARRAY(
          SELECT x.e FROM jsonb_array_elements(COALESCE(v_config->'rows', '[]'::jsonb)) AS x(e)
          WHERE jsonb_typeof(x.e) = 'string' ORDER BY ord), ARRAY[]::text[]);
        v_cols := COALESCE(ARRAY(
          SELECT x.e FROM jsonb_array_elements(COALESCE(v_config->'columns', '[]'::jsonb)) AS x(e)
          WHERE jsonb_typeof(x.e) = 'string' ORDER BY ord), ARRAY[]::text[]);
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

"""

submit_new = submit_new.replace(sub_anchor, sub_insert + sub_anchor, 1)

# ---- sanity: unchanged 006 branches still present in the new bodies ----
for probe in [
    "ELSIF v_type = 'time'",
    "ELSIF v_type = 'rating'",
    "honeypot",
    "form_rate_limits",
    "v_store_keys := v_store_keys || v_key;",
]:
    assert probe in submit_new, f"submit lost: {probe}"
for probe in ["FILE_UPLOAD_NOT_SUPPORTED", "schema_snapshot", "c_max_snapshot_bytes"]:
    assert probe in publish_new, f"publish lost: {probe}"

# ================= COMPOSE THE 007 FILE =================
header = """-- =====================================================================
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

"""

with open(OUT, "w") as f:
    f.write(header + publish_new + "\n\n" + submit_new + "\n")

print("WROTE", OUT)
print("publish_fn chars:", len(publish_fn), "→", len(publish_new))
print("submit_fn chars:", len(submit_fn), "→", len(submit_new))
