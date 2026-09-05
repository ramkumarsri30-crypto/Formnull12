-- =====================================================================
-- FormNull Migration 008 — FIELD EXPANSION
-- (file upload, signature, contact info, payment, scheduler, embed)
-- =====================================================================
-- STATUS: CREATED, NOT YET APPLIED — the project owner applies
-- migrations manually through the Supabase SQL editor (same protocol
-- as 005/006/007). Never applied automatically.
--
-- WHAT THIS MIGRATION DELIVERS
-- ----------------------------
--   Section A1  field_type enum += contact_info, payment, scheduler,
--               embed (non-destructive ALTER TYPE ADD VALUE).
--   Section A2  form_uploads table — the anonymous upload registry
--               (pending → attached lifecycle, private bucket paths).
--   Section A3  payments table — Stripe payment records per
--               form/field/submission with a provider reference.
--   Section A4  bookings table — scheduler slots with a partial
--               UNIQUE index as the double-booking hard backstop.
--   Section A5  form-uploads STORAGE bucket (private) + the single
--               anonymous INSERT policy (pending/ paths only) + the
--               member-read policy. No anonymous reads, ever.
--   Section A6  create_upload_intent RPC — server-side pre-validation
--               of file name/size/mime against the PUBLISHED snapshot
--               before any bytes move; per-IP pending-upload bound.
--   Section A7  create_payment_intent RPC — PENDING payment rows for
--               published payment fields (idempotent per provider ref).
--   Section A8  Execution grants (anon + authenticated for the two
--               new RPCs; table SELECTs for workspace members).
--   Section B   publish_form: the 006/007 file_upload publish block is
--               REMOVED (uploads are now real); new config validation
--               branches for file_upload, contact_info, payment,
--               scheduler, embed.
--   Section C   submit_public_form: c_submittable gains file_upload,
--               signature, contact_info, scheduler (payment is gated
--               separately — payment fields carry no answer value);
--               upload tokens are resolved against form_uploads and
--               RE-VALIDATED from storage metadata (actual size/mime);
--               contact records validate per-part; scheduler answers
--               validate availability + alignment + notice + window
--               with an advisory-locked overlap check; required
--               payments must reference a webhook-succeeded payment
--               row; post-insert attachment of uploads/bookings/
--               payments; payment_ref joins the metadata whitelist;
--               probabilistic cleanup of stale pending uploads.
--
-- WHAT DOES *NOT* CHANGE
-- ----------------------
--   * Migrations 001–007 FILES are untouched. B and C use CREATE OR
--     REPLACE on functions (the sanctioned evolution path); their
--     007 bodies are carried forward byte-for-byte and extended by
--     exact string insertion (scripts/gen-008.py — same generator
--     discipline as 007).
--   * NOT ONE RLS policy of 001–007 is altered or dropped. New tables
--     get their own policies; storage gets ONE new policy for the new
--     bucket. The submissions/submissions bucket rules are untouched.
--   * The 17 previously-submittable types validate byte-identically to
--     007 — their branches were not edited.
--   * Existing rows: zero new NOT NULL columns on existing tables, no
--     data rewrites, no renames, no drops. Fully safe on live data.
--
-- ENUM ALTER TYPE NOTES
-- ---------------------
--   ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
--   PostgreSQL < 12; Supabase runs PostgreSQL 15+, where it CAN run in
--   a transaction as long as the new values are not USED in DDL within
--   the same transaction. This file only references the new values
--   inside function bodies (string literals — not resolved at DDL
--   time) and in text comparisons, so applying the whole file at once
--   is safe. If your SQL client still complains, run Section A1 first,
--   then the rest.
--
-- STORAGE MODEL (why a new bucket)
-- --------------------------------
--   004's submissions bucket requires an authenticated workspace
--   member for writes, and public.assets.owner_id is NOT NULL FK to
--   auth.users — an anonymous respondent fits neither (006's 3-fact
--   analysis). The form-uploads bucket inverts the model: anonymous
--   writes ONLY under unguessable pending/{uuid}/ paths (policy +
--   uuid entropy), NO anonymous reads (files are fetched exclusively
--   through short-lived signed URLs minted by the app's
--   /api/storage/signed-url route after a workspace-membership check),
--   and per-upload metadata lives in form_uploads (not assets) so 004's
--   ownership semantics stay untouched.
--
-- PAYMENT HONESTY CONTRACT
-- ------------------------
--   Nothing in this migration fakes a charge. The payments rows start
--   PENDING; only the app's Stripe webhook (which requires
--   STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in the app environment)
--   marks them succeeded; submit_public_form refuses required-payment
--   submissions without a succeeded, unconsumed payment. Until Stripe
--   is configured the payment field renders honestly as unavailable.
--
-- SCHEDULER DOUBLE-BOOKING MODEL
-- ------------------------------
--   Writers serialize on a transaction-scoped advisory lock per
--   (form_id, field_key) BEFORE the overlap check (slot + buffer
--   range intersection against existing 'booked' rows), and the
--   partial UNIQUE index (form_id, field_key, start_at) WHERE
--   status='booked' is the hard backstop for races outside the lock.
--   A SLOT_TAKEN failure rolls back the whole submission atomically.
--
-- ROLLBACK (run as postgres in the SQL editor)
-- --------------------------------------------
--   DROP FUNCTION IF EXISTS public.create_upload_intent(text, text, text, text, bigint);
--   DROP FUNCTION IF EXISTS public.create_payment_intent(text, text, text);
--   DROP TABLE IF EXISTS public.bookings;
--   DROP TABLE IF EXISTS public.payments;
--   DROP TABLE IF EXISTS public.form_uploads;
--   DELETE FROM storage.objects WHERE bucket_id = 'form-uploads';
--   DELETE FROM storage.buckets WHERE id = 'form-uploads';
--   DROP POLICY IF EXISTS "form_uploads_pending_write" ON storage.objects;
--   DROP POLICY IF EXISTS "form_uploads_member_read" ON storage.objects;
--   -- Enum values cannot be removed in PostgreSQL; leaving them is
--   -- harmless (no rows reference them after the tables are gone).
--   -- Restore the 007 publish/submit bodies by re-running 007's
--   -- CREATE OR REPLACE statements (git history has them verbatim).
--
-- POST-APPLY VERIFICATION PROBES (read-only)
-- ------------------------------------------
--   1. SELECT public.create_upload_intent('definitely-not-a-key','f','x','text/plain',1);
--      → NOT_FOUND (RPC exists + snapshot resolution live)
--   2. SELECT public.create_payment_intent('definitely-not-a-key','f','ref-12345678');
--      → NOT_FOUND
--   3. SELECT count(*) FROM information_schema.columns
--       WHERE table_name IN ('form_uploads','payments','bookings');
--      → 23 (13 + 10 + 8 columns)
--   4. SELECT relrowsecurity FROM pg_class
--       WHERE relname IN ('form_uploads','payments','bookings');
--      → true, true, true
--   5. Re-run scripts/verify-bugfixes.ts — the registry/capability
--      checks must all pass.
--   6. The builder auto-detects 008 (field-capabilities.ts probe) and
--      the six new library entries appear WITHOUT any code change.
-- =====================================================================


-- =====================================================================
-- SECTION A1 — field_type enum additions
-- =====================================================================
-- Four new field types. contact_info / payment / scheduler / embed do
-- not exist in 002's enum; these ADDs are additive-only (no rename, no
-- reorder, no removal — 002's 21 values are untouched).
-- =====================================================================

ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'contact_info';
ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'scheduler';
ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'embed';


-- =====================================================================
-- SECTION A2 — public.form_uploads (anonymous upload registry)
-- =====================================================================
-- Lifecycle: 'pending' (intent created, client may upload) →
-- 'attached' (claimed by a submission at submit_public_form time) →
-- orphaned rows older than 24h are swept by the probabilistic cleanup
-- (their storage objects deleted with them).
--
-- Access: RLS enabled. SELECT for workspace members (the signed-URL
-- route + the future responses browser). ALL writes happen inside
-- SECURITY DEFINER RPCs / the submit function — there are no
-- INSERT/UPDATE/DELETE policies, so no API role can mutate rows.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.form_uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id        uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  field_key      text NOT NULL,
  bucket         text NOT NULL DEFAULT 'form-uploads',
  storage_path   text NOT NULL,
  original_name  text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0),
  ip_hash        text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','attached','orphaned')),
  submission_id  uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  attached_at    timestamptz
);

CREATE INDEX IF NOT EXISTS form_uploads_form_field_idx
  ON public.form_uploads(form_id, field_key, status);
CREATE INDEX IF NOT EXISTS form_uploads_submission_idx
  ON public.form_uploads(submission_id);
CREATE INDEX IF NOT EXISTS form_uploads_pending_age_idx
  ON public.form_uploads(created_at) WHERE status = 'pending';

ALTER TABLE public.form_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_uploads_select_member ON public.form_uploads;
CREATE POLICY form_uploads_select_member ON public.form_uploads
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

GRANT SELECT ON public.form_uploads TO authenticated;


-- =====================================================================
-- SECTION A3 — public.payments (Stripe payment records)
-- =====================================================================
-- One row per payment intent. provider_ref is the client-generated
-- reference threaded through the Stripe Checkout session
-- (client_reference_id) and the webhook — the lookup key at submit.
-- submission_id links the claimed payment to the stored submission
-- (set by submit_public_form; single-use is enforced by the
-- submission_id IS NULL + FOR UPDATE claim in (6b)).
--
-- Access: RLS enabled; SELECT for workspace members; all writes via
-- RPCs (create_payment_intent / the webhook's service-role client).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id        uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  submission_id  uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  field_key      text NOT NULL,
  provider       text NOT NULL DEFAULT 'stripe',
  provider_ref   text,
  amount_cents   int NOT NULL CHECK (amount_cents >= 0),
  currency       text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','succeeded','failed','refunded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_uniq
  ON public.payments(form_id, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_form_field_idx
  ON public.payments(form_id, field_key, status);
CREATE INDEX IF NOT EXISTS payments_submission_idx
  ON public.payments(submission_id);

CREATE OR REPLACE FUNCTION public.fn_payments_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_touch_updated_at ON public.payments;
CREATE TRIGGER trg_payments_touch_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payments_touch_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_member ON public.payments;
CREATE POLICY payments_select_member ON public.payments
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

GRANT SELECT ON public.payments TO authenticated;


-- =====================================================================
-- SECTION A4 — public.bookings (scheduler slots)
-- =====================================================================
-- One row per booked slot. The partial UNIQUE index is the hard
-- double-booking backstop (same start, same field, same form); the
-- overlap check in submit_public_form (under a per-field advisory
-- lock) additionally rejects overlapping DIFFERENT starts (slot
-- duration + buffer). Cancelling a booking frees the slot.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id        uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  submission_id  uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  field_key      text NOT NULL,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  timezone       text NOT NULL,
  status         text NOT NULL DEFAULT 'booked'
                   CHECK (status IN ('booked','cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
  ON public.bookings(form_id, field_key, start_at) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS bookings_form_field_idx
  ON public.bookings(form_id, field_key, status, start_at);
CREATE INDEX IF NOT EXISTS bookings_submission_idx
  ON public.bookings(submission_id);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_select_member ON public.bookings;
CREATE POLICY bookings_select_member ON public.bookings
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

GRANT SELECT ON public.bookings TO authenticated;


-- =====================================================================
-- SECTION A5 — form-uploads storage bucket + policies
-- =====================================================================
-- Private bucket. Anonymous/authenticated INSERT is allowed ONLY into
-- pending/{token}/ paths (the token is server-generated and
-- unguessable); the bucket's file_size_limit (25 MiB) and MIME
-- allowlist are enforced by the Storage API itself — a second,
-- independent server-side ceiling on top of the per-field config
-- checked in create_upload_intent and re-checked at submit.
--
-- READS: there is deliberately NO anon/authenticated SELECT policy.
-- Files are fetched only via short-lived signed URLs minted with the
-- service key by /api/storage/signed-url after a workspace-membership
-- check. Nothing is ever public.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-uploads', 'form-uploads', false, 26214400,
  ARRAY[
    'image/png','image/jpeg','image/webp','image/gif',
    'application/pdf','text/plain','text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'
  ]
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "form_uploads_pending_write" ON storage.objects;
CREATE POLICY "form_uploads_pending_write" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'form-uploads'
    AND (storage.foldername(name))[1] = 'pending'
  );

-- Member read policy: workspace members can LIST/download their own
-- forms' uploads directly (defense-in-depth companion to the signed-
-- URL route; the token path segment maps to form_uploads.form_id).
DROP POLICY IF EXISTS "form_uploads_member_read" ON storage.objects;
CREATE POLICY "form_uploads_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-uploads'
    AND EXISTS (
      SELECT 1 FROM public.form_uploads fu
       WHERE fu.bucket = 'form-uploads'
         AND fu.storage_path = storage.objects.name
         AND public.fn_user_is_workspace_member(fu.workspace_id)
    )
  );


-- =====================================================================
-- SECTION A6 — public.create_upload_intent
-- =====================================================================
-- The anonymous pre-upload validation RPC. Validates the file against
-- the PUBLISHED snapshot's field config (type file_upload or
-- signature; size <= maxSizeMb / signature <= 2 MB; mime within
-- allowedTypes), bounds pending uploads per hashed IP (20 per 15
-- minutes), sanitizes the file name, and returns the unguessable
-- token + pending/ storage path. SECURITY DEFINER: it performs its
-- own snapshot-based authorization (the public key IS the authority
-- for public-form uploads, exactly like submit_public_form).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_upload_intent(
    p_public_key text,
    p_field_key text,
    p_file_name text,
    p_mime_type text,
    p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_pending      constant int := 20;
  c_pending_window   constant int := 900;   -- 15 minutes

  v_form       record;
  v_snapshot   jsonb;
  v_fields     jsonb;
  v_f          jsonb;
  v_type       text;
  v_config     jsonb;
  v_max_bytes  bigint;
  v_allowed    text[];
  v_name       text;
  v_token      uuid;
  v_path       text;
  v_headers    jsonb;
  v_ip_raw     text;
  v_ip_hash    text;
  v_parts      text[];
  v_pending    int;
BEGIN
  -- Resolve the PUBLISHED form (paused forms reject uploads: they are
  -- not accepting responses).
  SELECT f.id, f.workspace_id, fv.schema_snapshot
    INTO v_form
    FROM public.forms f
    JOIN public.form_versions fv
      ON fv.form_id = f.id
     AND fv.version_number = f.published_version
   WHERE f.public_key = p_public_key
     AND f.status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no published form for this key';
  END IF;

  v_snapshot := v_form.schema_snapshot;
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object'
     OR jsonb_typeof(v_snapshot->'fields') <> 'array' THEN
    RAISE EXCEPTION 'SNAPSHOT_INVALID: the published form data is malformed';
  END IF;
  v_fields := v_snapshot->'fields';

  -- Find the field (by key) in the immutable snapshot.
  v_f := NULL;
  FOR v_f IN SELECT t.e FROM jsonb_array_elements(v_fields) AS t(e) LOOP
    EXIT WHEN v_f->>'key' = p_field_key;
  END LOOP;
  IF v_f IS NULL OR v_f->>'key' <> p_field_key THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: this form has no such field';
  END IF;

  v_type := v_f->>'type';
  IF v_type NOT IN ('file_upload', 'signature') THEN
    RAISE EXCEPTION 'NOT_AN_UPLOAD_FIELD: this field does not accept file uploads';
  END IF;

  v_config := COALESCE(v_f->'config', '{}'::jsonb);
  IF jsonb_typeof(v_config) <> 'object' THEN
    v_config := '{}'::jsonb;
  END IF;

  -- Size ceiling: the field config (publish-validated 1..100 MB) for
  -- file_upload; a fixed 2 MB for signatures (canvas PNGs).
  IF v_type = 'signature' THEN
    v_max_bytes := 2097152;
  ELSE
    v_max_bytes := 10485760;
    IF jsonb_typeof(v_config->'maxSizeMb') = 'number'
       AND (v_config->>'maxSizeMb')::int BETWEEN 1 AND 100 THEN
      v_max_bytes := (v_config->>'maxSizeMb')::int * 1048576;
    END IF;
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'INVALID_SIZE: the file size must be a positive number of bytes';
  END IF;
  IF p_size_bytes > v_max_bytes THEN
    RAISE EXCEPTION 'FILE_TOO_LARGE: files for this field may be at most % MB',
      v_max_bytes / 1048576;
  END IF;

  -- MIME: signatures must be PNG; file_upload narrows within the
  -- bucket's allowlist (empty config = the full bucket set).
  IF v_type = 'signature' THEN
    IF COALESCE(p_mime_type, '') <> 'image/png' THEN
      RAISE EXCEPTION 'INVALID_TYPE: signatures are stored as PNG drawings';
    END IF;
  ELSE
    v_allowed := ARRAY(
      SELECT y.e FROM jsonb_array_elements_text(COALESCE(v_config->'allowedTypes', '[]'::jsonb)) AS y(e)
    );
    IF array_length(v_allowed, 1) > 0 AND COALESCE(p_mime_type, '') <> ''
       AND NOT (p_mime_type = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'INVALID_TYPE: this field does not accept %', p_mime_type;
    END IF;
  END IF;

  -- Per-IP pending-upload bound (best-effort headers, same as the
  -- submit RPC; no raw IP is stored — only the hash).
  v_ip_raw := NULL;
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  IF v_headers IS NOT NULL THEN
    v_ip_raw := btrim(COALESCE(v_headers->>'cf-connecting-ip', ''));
    IF v_ip_raw = '' AND v_headers->>'x-forwarded-for' IS NOT NULL THEN
      v_parts := string_to_array(v_headers->>'x-forwarded-for', ',');
      v_ip_raw := btrim(v_parts[array_length(v_parts, 1)]);
    END IF;
  END IF;
  IF v_ip_raw IS NOT NULL AND v_ip_raw <> '' THEN
    BEGIN
      v_ip_hash := encode(extensions.digest(v_ip_raw, 'sha256'), 'hex');
    EXCEPTION WHEN undefined_function THEN
      v_ip_hash := md5(v_ip_raw);
    END;
    SELECT count(*) INTO v_pending
      FROM public.form_uploads
     WHERE ip_hash = v_ip_hash
       AND status = 'pending'
       AND created_at > now() - make_interval(secs => c_pending_window);
    IF v_pending >= c_max_pending THEN
      RAISE EXCEPTION 'UPLOAD_RATE_LIMITED: too many pending uploads — please slow down';
    END IF;
  END IF;

  -- Sanitize the file name: strip anything unsafe, bound the length.
  v_name := COALESCE(p_file_name, 'file');
  v_name := regexp_replace(v_name, '[^[:alnum:]._() -]+', '_', 'g');
  v_name := regexp_replace(v_name, '[.]{2,}', '.', 'g');
  v_name := left(btrim(v_name), 120);
  IF v_name = '' OR v_name = '.' THEN
    v_name := 'file';
  END IF;

  v_token := gen_random_uuid();
  v_path := 'pending/' || v_token || '/' || v_name;

  INSERT INTO public.form_uploads
    (workspace_id, form_id, field_key, bucket, storage_path,
     original_name, mime_type, size_bytes, ip_hash, status)
  VALUES
    (v_form.workspace_id, v_form.id, p_field_key, 'form-uploads', v_path,
     v_name, COALESCE(p_mime_type, 'application/octet-stream'), p_size_bytes, v_ip_hash, 'pending');

  RETURN jsonb_build_object(
    'token', v_token,
    'path', v_path,
    'max_bytes', v_max_bytes
  );
END;
$$;


-- =====================================================================
-- SECTION A7 — public.create_payment_intent
-- =====================================================================
-- Creates (idempotently) a PENDING payments row for a published
-- payment field. The CHARGE itself never happens here — it runs
-- through Stripe Checkout from the app's /api/payments/checkout
-- route; the webhook marks the row succeeded. Amount and currency are
-- read from the immutable snapshot (never from the client).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_payment_intent(
    p_public_key text,
    p_field_key text,
    p_provider_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form      record;
  v_snapshot  jsonb;
  v_f         jsonb;
  v_cents     int;
  v_currency  text;
  v_existing  record;
BEGIN
  SELECT f.id, f.workspace_id, fv.schema_snapshot
    INTO v_form
    FROM public.forms f
    JOIN public.form_versions fv
      ON fv.form_id = f.id
     AND fv.version_number = f.published_version
   WHERE f.public_key = p_public_key
     AND f.status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no published form for this key';
  END IF;

  IF p_provider_ref IS NULL OR p_provider_ref !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'INVALID_REF: the payment reference is malformed';
  END IF;

  v_snapshot := v_form.schema_snapshot;
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object'
     OR jsonb_typeof(v_snapshot->'fields') <> 'array' THEN
    RAISE EXCEPTION 'SNAPSHOT_INVALID: the published form data is malformed';
  END IF;

  v_f := NULL;
  FOR v_f IN SELECT t.e FROM jsonb_array_elements(v_snapshot->'fields') AS t(e) LOOP
    EXIT WHEN v_f->>'key' = p_field_key;
  END LOOP;
  IF v_f IS NULL OR v_f->>'key' <> p_field_key THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: this form has no such field';
  END IF;
  IF v_f->>'type' <> 'payment' THEN
    RAISE EXCEPTION 'NOT_A_PAYMENT_FIELD: this field does not collect payments';
  END IF;

  v_cents := NULL;
  IF jsonb_typeof(v_f->'config'->'amountCents') = 'number' THEN
    v_cents := (v_f->'config'->>'amountCents')::int;
  END IF;
  IF v_cents IS NULL OR v_cents NOT BETWEEN 50 AND 10000000 THEN
    RAISE EXCEPTION 'CONFIG_INVALID: the payment field has no valid amount';
  END IF;
  v_currency := v_f->'config'->>'currency';
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    v_currency := 'USD';
  END IF;

  -- Idempotent: the same provider_ref returns the existing row.
  SELECT * INTO v_existing FROM public.payments
   WHERE form_id = v_form.id AND provider_ref = p_provider_ref;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_existing.id,
      'amount_cents', v_existing.amount_cents,
      'currency', v_existing.currency,
      'status', v_existing.status
    );
  END IF;

  INSERT INTO public.payments
    (workspace_id, form_id, field_key, provider, provider_ref, amount_cents, currency, status)
  VALUES
    (v_form.workspace_id, v_form.id, p_field_key, 'stripe', p_provider_ref, v_cents, v_currency, 'pending')
  RETURNING * INTO v_existing;

  RETURN jsonb_build_object(
    'payment_id', v_existing.id,
    'amount_cents', v_existing.amount_cents,
    'currency', v_existing.currency,
    'status', v_existing.status
  );
END;
$$;


-- =====================================================================
-- SECTION A8 — execution grants for the new RPCs
-- =====================================================================
-- Same privilege model as 006/007: the public-form RPCs are
-- anon-executable (they authorize themselves against the published
-- snapshot); table mutations remain impossible for API roles.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.create_upload_intent(text, text, text, text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_upload_intent(text, text, text, text, bigint) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_payment_intent(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_payment_intent(text, text, text) TO anon, authenticated;


-- =====================================================================
-- SECTION B — publish_form (007 body + Field Expansion validation)
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
  v_bool     boolean;
  v_int      int;
  v_tz       text;
  v_k        text;
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
  -- FILE_UPLOAD: the 008 upload contract (form-uploads bucket +
  -- create_upload_intent RPC + submit-side re-validation) makes
  -- file_upload fields publishable. Config is validated below like
  -- every other type; v_files stays informational only.

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

    ELSIF r.ftype = 'file_upload' THEN
      -- 008 contract: maxSizeMb 1..100, maxFiles 1..10, multiple bool,
      -- allowedTypes = unique MIME strings (<= 20 entries, <= 100 chars).
      v_cfg := v_config->>'maxSizeMb';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,3}$' OR v_cfg::int NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" maxSizeMb must be a whole number between 1 and 100', r.field_key;
      END IF;
      v_cfg := v_config->>'maxFiles';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,2}$' OR v_cfg::int NOT BETWEEN 1 AND 10) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" maxFiles must be a whole number between 1 and 10', r.field_key;
      END IF;
      IF jsonb_exists(v_config, 'multiple') AND jsonb_typeof(v_config->'multiple') <> 'boolean' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" multiple must be true or false', r.field_key;
      END IF;
      v_opt := v_config->'allowedTypes';
      IF v_opt IS NOT NULL THEN
        IF jsonb_typeof(v_opt) <> 'array' THEN
          RAISE EXCEPTION 'CONFIG_INVALID: field "%" allowedTypes must be a list', r.field_key;
        END IF;
        SELECT count(*),
               count(DISTINCT x.e #>> '{}'),
               count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'string'
                                  OR x.e #>> '{}' !~ '^[a-z0-9!*+.-]+/[a-z0-9!*+.-]+$'
                                  OR length(x.e #>> '{}') > 100)
          INTO v_n, v_distinct, v_nonstr
          FROM jsonb_array_elements(v_opt) AS x(e);
        IF v_n < 1 OR v_n > 20 OR v_nonstr > 0 OR v_distinct <> v_n THEN
          RAISE EXCEPTION 'CONFIG_INVALID: field "%" allowedTypes must be up to 20 unique MIME strings like image/png', r.field_key;
        END IF;
      END IF;

    ELSIF r.ftype = 'contact_info' THEN
      -- 008 contract: parts = unique subset of the four known parts and
      -- non-empty; requiredParts a subset of parts; label/placeholder
      -- maps keyed by enabled parts with string values <= 100 chars.
      v_opt := v_config->'parts';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" requires a config.parts array', r.field_key;
      END IF;
      SELECT count(*),
             count(DISTINCT x.e #>> '{}'),
             count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'string'
                                OR x.e #>> '{}' NOT IN ('first_name','last_name','email','phone'))
        INTO v_n, v_distinct, v_nonstr
        FROM jsonb_array_elements(v_opt) AS x(e);
      IF v_n < 1 OR v_n > 4 OR v_nonstr > 0 OR v_distinct <> v_n THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" parts must be unique entries from first_name, last_name, email, phone', r.field_key;
      END IF;
      v_opt := v_config->'requiredParts';
      IF v_opt IS NOT NULL THEN
        IF jsonb_typeof(v_opt) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_opt) AS x(e)
                       WHERE jsonb_typeof(x.e) <> 'string'
                          OR NOT (x.e #>> '{}' = ANY (ARRAY(SELECT y.e #>> '{}'
                                                             FROM jsonb_array_elements(v_config->'parts') AS y(e))))) THEN
          RAISE EXCEPTION 'CONFIG_INVALID: field "%" requiredParts must be enabled parts', r.field_key;
        END IF;
      END IF;
      FOR v_k IN SELECT t.k FROM jsonb_object_keys(v_config) AS t(k) LOOP
        IF v_k IN ('partLabels', 'partPlaceholders') THEN
          IF jsonb_typeof(v_config->v_k) <> 'object'
             OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_config->v_k) AS t2(k2)
                         WHERE NOT (t2.k2 = ANY (ARRAY(SELECT y.e #>> '{}'
                                                         FROM jsonb_array_elements(v_config->'parts') AS y(e)))))
             OR EXISTS (SELECT 1 FROM jsonb_each(v_config->v_k) AS t2(k2, v2)
                         WHERE jsonb_typeof(t2.v2) <> 'string' OR length(t2.v2) > 100) THEN
            RAISE EXCEPTION 'CONFIG_INVALID: field "%" % must map enabled parts to short labels', r.field_key, v_k;
          END IF;
        END IF;
      END LOOP;

    ELSIF r.ftype = 'payment' THEN
      -- 008 contract: amountCents 50..10,000,000; currency from the
      -- supported Stripe set; amountMode fixed|minimum; paymentNote
      -- <= 200 chars.
      v_cfg := v_config->>'amountCents';
      IF v_cfg IS NULL OR v_cfg !~ '^[0-9]{1,8}$' OR v_cfg::int NOT BETWEEN 50 AND 10000000 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" amountCents must be a whole number of cents between 50 and 10000000', r.field_key;
      END IF;
      v_cfg := v_config->>'currency';
      IF v_cfg IS NULL OR v_cfg !~ '^(USD|EUR|GBP|INR|AUD|CAD|JPY|SGD|AED)$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" currency must be one of the supported payment currencies', r.field_key;
      END IF;
      v_cfg := v_config->>'amountMode';
      IF v_cfg IS NOT NULL AND v_cfg NOT IN ('fixed', 'minimum') THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" amountMode must be fixed or minimum', r.field_key;
      END IF;
      v_cfg := v_config->>'paymentNote';
      IF v_cfg IS NOT NULL AND length(v_cfg) > 200 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" paymentNote must be at most 200 characters', r.field_key;
      END IF;

    ELSIF r.ftype = 'scheduler' THEN
      -- 008 contract: days = unique 0..6, non-empty; windows = non-
      -- overlapping HH:MM pairs; slotMinutes 5..240; bufferMinutes
      -- 0..60; minNoticeHours 0..720; maxBookingDays 1..365;
      -- timezone a real IANA name.
      v_opt := v_config->'days';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" requires a config.days array', r.field_key;
      END IF;
      SELECT count(*),
             count(DISTINCT x.e #>> '{}'),
             count(*) FILTER (WHERE jsonb_typeof(x.e) <> 'number'
                                OR (x.e #>> '{}')::int NOT BETWEEN 0 AND 6)
        INTO v_n, v_distinct, v_nonstr
        FROM jsonb_array_elements(v_opt) AS x(e);
      IF v_n < 1 OR v_n > 7 OR v_nonstr > 0 OR v_distinct <> v_n THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" days must be unique weekday numbers 0-6', r.field_key;
      END IF;
      v_opt := v_config->'windows';
      IF v_opt IS NULL OR jsonb_typeof(v_opt) <> 'array' OR jsonb_array_length(v_opt) < 1
         OR jsonb_array_length(v_opt) > 5 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" needs 1 to 5 config.windows', r.field_key;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opt) AS x(e)
                  WHERE jsonb_typeof(x.e) <> 'object'
                     OR jsonb_typeof(x.e->'start') <> 'string'
                     OR jsonb_typeof(x.e->'end') <> 'string'
                     OR x.e->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                     OR x.e->>'end'   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                     OR x.e->>'start' >= x.e->>'end') THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" windows must be HH:MM start/end pairs with start before end', r.field_key;
      END IF;
      IF EXISTS (SELECT 1
                   FROM jsonb_array_elements(v_opt) AS a(e)
                   JOIN jsonb_array_elements(v_opt) AS b(e)
                     ON a.ord < b.ord
                  WHERE a.e->>'start' < b.e->>'end'
                    AND b.e->>'start' < a.e->>'end') THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" windows cannot overlap — merge them instead', r.field_key;
      END IF;
      v_cfg := v_config->>'slotMinutes';
      IF v_cfg IS NULL OR v_cfg !~ '^[0-9]{1,3}$' OR v_cfg::int NOT BETWEEN 5 AND 240 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" slotMinutes must be a whole number between 5 and 240', r.field_key;
      END IF;
      v_cfg := v_config->>'bufferMinutes';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,2}$' OR v_cfg::int NOT BETWEEN 0 AND 60) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" bufferMinutes must be between 0 and 60', r.field_key;
      END IF;
      v_cfg := v_config->>'minNoticeHours';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,3}$' OR v_cfg::int NOT BETWEEN 0 AND 720) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" minNoticeHours must be between 0 and 720', r.field_key;
      END IF;
      v_cfg := v_config->>'maxBookingDays';
      IF v_cfg IS NOT NULL AND (v_cfg !~ '^[0-9]{1,3}$' OR v_cfg::int NOT BETWEEN 1 AND 365) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" maxBookingDays must be between 1 and 365', r.field_key;
      END IF;
      v_tz := v_config->>'timezone';
      IF v_tz IS NULL OR length(v_tz) > 60
         OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" timezone must be a valid IANA timezone name', r.field_key;
      END IF;

    ELSIF r.ftype = 'embed' THEN
      -- 008 contract: embedType video|link; https url <= 2048 chars;
      -- video urls must be YouTube/Vimeo hosts; aspectRatio 16:9|4:3|1:1;
      -- linkText <= 200. Presentation-only keys flow through unchanged.
      v_cfg := v_config->>'embedType';
      IF v_cfg IS NOT NULL AND v_cfg NOT IN ('video', 'link') THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" embedType must be video or link', r.field_key;
      END IF;
      v_cfg := v_config->>'url';
      IF v_cfg IS NOT NULL AND v_cfg <> '' THEN
        IF v_cfg !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/|$)' OR length(v_cfg) > 2048 THEN
          RAISE EXCEPTION 'CONFIG_INVALID: field "%" url must be an https:// URL of at most 2048 characters', r.field_key;
        END IF;
        IF COALESCE(v_config->>'embedType', 'video') = 'video'
           AND v_cfg !~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)/' THEN
          RAISE EXCEPTION 'CONFIG_INVALID: field "%" video embeds accept YouTube and Vimeo URLs only — use a link embed for other sites', r.field_key;
        END IF;
      END IF;
      v_cfg := v_config->>'aspectRatio';
      IF v_cfg IS NOT NULL AND v_cfg !~ '^(16:9|4:3|1:1)$' THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" aspectRatio must be 16:9, 4:3 or 1:1', r.field_key;
      END IF;
      v_cfg := v_config->>'linkText';
      IF v_cfg IS NOT NULL AND length(v_cfg) > 200 THEN
        RAISE EXCEPTION 'CONFIG_INVALID: field "%" linkText must be at most 200 characters', r.field_key;
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
-- SECTION C — submit_public_form (007 body + Field Expansion contract)
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
    'single_select','multi_select','rating','scale',
    'datetime','address','matrix',
    'file_upload','signature','contact_info','scheduler'];

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
  -- 008 additions (uploads / scheduler / payments)
  v_tokens     text[];
  v_tok        text;
  v_upl        record;
  v_actual     bigint;
  v_max_bytes  bigint;
  v_allowed    text[];
  v_stored     jsonb;
  v_attach     text[];
  v_start_txt  text;
  v_start      timestamptz;
  v_end        timestamptz;
  v_tz         text;
  v_dow        int;
  v_minutes    int;
  v_ws         int;
  v_we         int;
  v_slot       int;
  v_buffer     int;
  v_bk_keys    text[];
  v_bk_starts  timestamptz[];
  v_bk_ends    timestamptz[];
  v_bk_tzs     text[];
  v_pay_ref    text;
  v_pay_id     uuid;
  v_pay_ids    uuid[];
  v_int        int;
  v_bool       boolean;
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

    /* ---------------- file_upload (008) ---------------- */
    ELSIF v_type = 'file_upload' THEN
      IF jsonb_typeof(v_val) <> 'array' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Upload at least one file.');
      ELSE
        IF jsonb_array_length(v_val) = 0 THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'This field is required.');
          END IF;
        ELSE
          -- maxFiles (publish-validated; re-guarded against a poisoned
          -- snapshot before use)
          v_int := 5;
          IF jsonb_typeof(v_config->'maxFiles') = 'number'
             AND (v_config->>'maxFiles')::int BETWEEN 1 AND 10 THEN
            v_int := (v_config->>'maxFiles')::int;
          END IF;
          IF jsonb_array_length(v_val) > v_int THEN
            v_errors := v_errors || jsonb_build_object(v_key, format('At most %s files are allowed.', v_int));
          ELSE
            -- Tokens: the client sends objects {token,...}; plain token
            -- strings are accepted too (both shapes resolve identically).
            v_tokens := ARRAY(
              SELECT COALESCE(NULLIF(x.e->>'token',''), NULLIF(x.e #>> '{}',''))
                FROM jsonb_array_elements(v_val) AS x(e)
            );
            IF EXISTS (SELECT 1 FROM unnest(v_tokens) AS u(s) GROUP BY u.s HAVING count(*) > 1)
               OR EXISTS (SELECT 1 FROM unnest(v_tokens) AS u(s) WHERE u.s IS NULL OR u.s = '') THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'One of the uploads is still in progress.');
            ELSE
              v_max_bytes := 10485760;   -- default 10 MB
              IF jsonb_typeof(v_config->'maxSizeMb') = 'number'
                 AND (v_config->>'maxSizeMb')::int BETWEEN 1 AND 100 THEN
                v_max_bytes := (v_config->>'maxSizeMb')::int * 1048576;
              END IF;
              v_allowed := ARRAY(
                SELECT y.e FROM jsonb_array_elements_text(COALESCE(v_config->'allowedTypes', '[]'::jsonb)) AS y(e)
              );
              v_stored := '[]'::jsonb;
              FOR v_tok IN SELECT u.s FROM unnest(v_tokens) AS u(s) LOOP
                -- (a) The intent row must exist, be pending, and belong
                --     to THIS form + field (cross-form token replay is
                --     structurally impossible).
                SELECT * INTO v_upl FROM public.form_uploads
                 WHERE token = v_tok AND status = 'pending'
                   AND form_id = v_form.id AND field_key = v_key;
                IF NOT FOUND THEN
                  v_errors := v_errors || jsonb_build_object(v_key, 'One of the uploads is no longer available — upload it again.');
                  EXIT;
                END IF;
                -- (b) The storage object must exist; its ACTUAL size and
                --     mime are authoritative (never trust client claims).
                SELECT (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
                  INTO v_actual, v_txt
                  FROM storage.objects o
                 WHERE o.bucket_id = 'form-uploads' AND o.name = v_upl.storage_path;
                IF v_actual IS NULL THEN
                  v_errors := v_errors || jsonb_build_object(v_key, 'One of the uploaded files is missing from storage.');
                  EXIT;
                END IF;
                IF v_actual > v_max_bytes THEN
                  v_errors := v_errors || jsonb_build_object(v_key, 'One of the files exceeds the size limit.');
                  EXIT;
                END IF;
                IF array_length(v_allowed, 1) > 0 AND NOT (v_txt = ANY (v_allowed)) THEN
                  v_errors := v_errors || jsonb_build_object(v_key, 'One of the files is not an allowed type.');
                  EXIT;
                END IF;
                v_stored := v_stored || jsonb_build_object(
                  'token', v_tok,
                  'name', v_upl.original_name,
                  'mime_type', v_txt,
                  'size_bytes', v_actual);
              END LOOP;
              IF NOT jsonb_exists(v_errors, v_key) THEN
                -- Canonical stored answer (server-derived metadata only).
                v_val := v_stored;
                v_attach := v_attach || v_tokens;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;

    /* ---------------- signature (008) ---------------- */
    ELSIF v_type = 'signature' THEN
      IF jsonb_typeof(v_val) <> 'string' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Please draw your signature.');
      ELSE
        v_tok := v_val #>> '{}';
        IF btrim(v_tok) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Please draw your signature.');
          END IF;
        ELSE
          SELECT * INTO v_upl FROM public.form_uploads
           WHERE token = v_tok AND status = 'pending'
             AND form_id = v_form.id AND field_key = v_key;
          IF NOT FOUND THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'The signature is no longer available — draw it again.');
          ELSE
            SELECT (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
              INTO v_actual, v_txt
              FROM storage.objects o
             WHERE o.bucket_id = 'form-uploads' AND o.name = v_upl.storage_path;
            IF v_actual IS NULL THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'The signature upload is missing from storage.');
            ELSIF v_txt <> 'image/png' OR v_actual > 2097152 THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'The signature could not be validated.');
            ELSE
              v_val := jsonb_build_object(
                'token', v_tok,
                'name', v_upl.original_name,
                'mime_type', 'image/png',
                'size_bytes', v_actual);
              v_attach := v_attach || ARRAY[v_tok];
            END IF;
          END IF;
        END IF;
      END IF;

    /* ---------------- contact_info (008) ---------------- */
    ELSIF v_type = 'contact_info' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Fill in your contact details.');
      ELSE
        v_rec := v_val;
        v_txt := '';
        FOR v_rec_key IN SELECT t.k FROM jsonb_object_keys(v_rec) AS t(k) LOOP
          IF v_rec_key NOT IN ('first_name','last_name','email','phone') THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Unknown contact part.');
            EXIT;
          END IF;
          v_rec_val := v_rec->>v_rec_key;
          IF v_rec_val IS NULL OR jsonb_typeof(v_rec->v_rec_key) <> 'string' THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Contact parts must be text.');
            EXIT;
          END IF;
          IF length(v_rec_val) > 200 THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'One of the contact parts is too long.');
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
          -- Enabled parts come from the snapshot; keys outside them are
          -- rejected (the client only renders enabled parts anyway).
          v_rows := ARRAY(
            SELECT y.e FROM jsonb_array_elements_text(COALESCE(v_config->'parts', '[]'::jsonb)) AS y(e)
          );
          IF array_length(v_rows, 1) > 0 THEN
            FOR v_rec_key IN SELECT t.k FROM jsonb_object_keys(v_rec) AS t(k) LOOP
              IF NOT (v_rec_key = ANY (v_rows)) THEN
                v_errors := v_errors || jsonb_build_object(v_key, 'One of the contact parts is no longer offered.');
                EXIT;
              END IF;
            END LOOP;
          END IF;
          IF NOT jsonb_exists(v_errors, v_key) THEN
            -- Required parts (from the snapshot config) must be filled.
            v_rows := ARRAY(
              SELECT y.e FROM jsonb_array_elements_text(COALESCE(v_config->'requiredParts', '[]'::jsonb)) AS y(e)
            );
            FOREACH v_row IN ARRAY v_rows LOOP
              IF btrim(COALESCE(v_rec->>v_row, '')) = '' THEN
                v_errors := v_errors || jsonb_build_object(v_key, format('The %s part is required.', replace(v_row, '_', ' ')));
                EXIT;
              END IF;
            END LOOP;
          END IF;
          IF NOT jsonb_exists(v_errors, v_key) AND btrim(COALESCE(v_rec->>'email','')) <> ''
             AND v_rec->>'email' !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Enter a valid email address.');
          END IF;
          IF NOT jsonb_exists(v_errors, v_key) AND btrim(COALESCE(v_rec->>'phone','')) <> ''
             AND (v_rec->>'phone' !~ '^[+]?[0-9(). -]{5,25}$'
                  OR (SELECT count(*) FROM regexp_matches(v_rec->>'phone', '[0-9]', 'g')) NOT BETWEEN 4 AND 15) THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Enter a valid phone number.');
          END IF;
        END IF;
      END IF;

    /* ---------------- scheduler (008) ---------------- */
    ELSIF v_type = 'scheduler' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'Pick an available time slot.');
      ELSE
        v_start_txt := v_val->>'start_at';
        IF v_start_txt IS NULL OR btrim(v_start_txt) = '' THEN
          v_empty := true;
          IF v_required THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'Pick an available time slot.');
          END IF;
        ELSE
          v_start := NULL;
          BEGIN
            v_start := v_start_txt::timestamptz;
          EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_start := NULL;
          END;
          IF v_start IS NULL THEN
            v_errors := v_errors || jsonb_build_object(v_key, 'The selected slot is not a valid time.');
          ELSE
            v_tz := COALESCE(v_config->>'timezone', 'UTC');
            IF length(v_tz) > 60 OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
              v_tz := 'UTC';
            END IF;
            -- Day-of-week + minutes-since-midnight in the FIELD's zone
            v_dow := EXTRACT(DOW FROM v_start AT TIME ZONE v_tz)::int;
            v_minutes := EXTRACT(HOUR FROM v_start AT TIME ZONE v_tz)::int * 60
                       + EXTRACT(MINUTE FROM v_start AT TIME ZONE v_tz)::int;
            v_rows := ARRAY(
              SELECT (y.e #>> '{}')::int
                FROM jsonb_array_elements(COALESCE(v_config->'days', '[]'::jsonb)) AS y(e)
               WHERE jsonb_typeof(y.e) = 'number'
            );
            IF array_length(v_rows, 1) IS NULL OR NOT (v_dow = ANY (v_rows)) THEN
              v_errors := v_errors || jsonb_build_object(v_key, 'That day is not available.');
            ELSE
              -- Slot alignment inside a window (start aligned AND the
              -- whole slot within the window's end).
              v_int := 30;
              IF jsonb_typeof(v_config->'slotMinutes') = 'number'
                 AND (v_config->>'slotMinutes')::int BETWEEN 5 AND 240 THEN
                v_int := (v_config->>'slotMinutes')::int;
              END IF;
              v_slot := v_int;
              v_bool := false;
              FOR v_rec IN SELECT * FROM jsonb_array_elements(COALESCE(v_config->'windows', '[]'::jsonb)) AS w(e) LOOP
                IF v_rec->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                   AND v_rec->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
                  v_ws := substring(v_rec->>'start' from 1 for 2)::int * 60 + substring(v_rec->>'start' from 4 for 2)::int;
                  v_we := substring(v_rec->>'end' from 1 for 2)::int * 60 + substring(v_rec->>'end' from 4 for 2)::int;
                  IF v_minutes >= v_ws
                     AND v_minutes + v_slot <= v_we
                     AND (v_minutes - v_ws) % v_slot = 0 THEN
                    v_bool := true;
                    EXIT;
                  END IF;
                END IF;
              END LOOP;
              IF NOT v_bool THEN
                v_errors := v_errors || jsonb_build_object(v_key, 'Pick one of the offered time slots.');
              ELSE
                -- Notice + booking window
                v_int := 0;
                IF jsonb_typeof(v_config->'minNoticeHours') = 'number'
                   AND (v_config->>'minNoticeHours')::int BETWEEN 0 AND 720 THEN
                  v_int := (v_config->>'minNoticeHours')::int;
                END IF;
                IF v_start < now() + make_interval(hours => v_int) THEN
                  v_errors := v_errors || jsonb_build_object(v_key, 'That time is too soon — pick a later slot.');
                ELSE
                  v_int := 30;
                  IF jsonb_typeof(v_config->'maxBookingDays') = 'number'
                     AND (v_config->>'maxBookingDays')::int BETWEEN 1 AND 365 THEN
                    v_int := (v_config->>'maxBookingDays')::int;
                  END IF;
                  IF v_start > now() + make_interval(days => v_int) THEN
                    v_errors := v_errors || jsonb_build_object(v_key, 'That time is outside the booking window.');
                  ELSE
                    -- Double-booking prevention: serialize writers on a
                    -- per-(form, field) transaction lock, THEN check for
                    -- overlapping existing bookings (buffer included).
                    v_buffer := 0;
                    IF jsonb_typeof(v_config->'bufferMinutes') = 'number'
                       AND (v_config->>'bufferMinutes')::int BETWEEN 0 AND 60 THEN
                      v_buffer := (v_config->>'bufferMinutes')::int;
                    END IF;
                    v_end := v_start + make_interval(mins => v_slot);
                    PERFORM pg_advisory_xact_lock(
                      hashtextextended('formnull:bookings:' || v_form.id::text || ':' || v_key, 0));
                    IF EXISTS (
                      SELECT 1 FROM public.bookings b
                       WHERE b.form_id = v_form.id
                         AND b.field_key = v_key
                         AND b.status = 'booked'
                         AND tstzrange(b.start_at - make_interval(mins => v_buffer),
                                       b.end_at + make_interval(mins => v_buffer))
                             && tstzrange(v_start, v_end)
                    ) THEN
                      v_errors := v_errors || jsonb_build_object(v_key, 'That time was just booked — pick another.');
                    ELSE
                      -- Canonical stored answer: server-derived end + tz.
                      v_val := jsonb_build_object(
                        'start_at', to_jsonb(v_start)::text,
                        'end_at', to_jsonb(v_end)::text,
                        'timezone', v_tz);
                      v_bk_keys := v_bk_keys || ARRAY[v_key];
                      v_bk_starts := v_bk_starts || ARRAY[v_start];
                      v_bk_ends := v_bk_ends || ARRAY[v_end];
                      v_bk_tzs := v_bk_tzs || ARRAY[v_tz];
                    END IF;
                  END IF;
                END IF;
              END IF;
            END IF;
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

  -- (6b) Payment gate (008): a REQUIRED payment field must have a
  -- SUCCEEDED payment (marked by the Stripe webhook) referenced by
  -- p_meta.payment_ref and not yet consumed by another submission.
  -- The row is locked FOR UPDATE so a single payment can never be
  -- claimed twice; the check's error joins v_errors so the client
  -- renders it on the payment field itself.
  v_pay_ids := ARRAY[]::uuid[];
  FOR v_f IN SELECT t.e FROM jsonb_array_elements(v_fields) AS t(e)
              WHERE t.e->>'type' = 'payment' LOOP
    v_key := v_f->>'key';
    v_required := COALESCE((v_f->>'required') = 'true', false);
    IF NOT v_required THEN
      CONTINUE;
    END IF;
    v_pay_ref := NULL;
    IF p_meta IS NOT NULL AND jsonb_typeof(p_meta) = 'object'
       AND p_meta->>'payment_ref' ~ '^[A-Za-z0-9_-]{8,64}$' THEN
      v_pay_ref := p_meta->>'payment_ref';
    END IF;
    IF v_pay_ref IS NULL THEN
      v_errors := v_errors || jsonb_build_object(v_key, 'Complete the payment before submitting.');
    ELSE
      SELECT p.id INTO v_pay_id
        FROM public.payments p
       WHERE p.form_id = v_form.id
         AND p.field_key = v_key
         AND p.provider_ref = v_pay_ref
         AND p.status = 'succeeded'
         AND p.submission_id IS NULL
         FOR UPDATE;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_object(v_key, 'The payment was not completed or is already used.');
      ELSE
        v_pay_ids := v_pay_ids || ARRAY[v_pay_id];
      END IF;
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
    IF p_meta->>'payment_ref' IS NOT NULL THEN
      v_meta_out := v_meta_out || jsonb_build_object('payment_ref', left(p_meta->>'payment_ref', 64));
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

  -- (9c) Attach the validated pending uploads to this submission (a
  -- single bounded UPDATE; the tokens were locked by validation and
  -- only status='pending' rows can match).
  IF COALESCE(array_length(v_attach, 1), 0) > 0 THEN
    UPDATE public.form_uploads
       SET status = 'attached', submission_id = v_sub_id, attached_at = now()
     WHERE form_id = v_form.id
       AND status = 'pending'
       AND token = ANY (v_attach);
  END IF;

  -- (9d) Bookings: insert one row per scheduler answer. The unique
  -- partial index (form_id, field_key, start_at) is the hard backstop
  -- for races the (6) advisory lock + overlap check cannot see; a
  -- violation rolls the WHOLE submission back atomically (the
  -- respondent simply picks another slot).
  FOR v_i IN 1..COALESCE(array_length(v_bk_keys, 1), 0) LOOP
    BEGIN
      INSERT INTO public.bookings
        (workspace_id, form_id, submission_id, field_key, start_at, end_at, timezone, status)
      VALUES
        (v_form.workspace_id, v_form.id, v_sub_id, v_bk_keys[v_i],
         v_bk_starts[v_i], v_bk_ends[v_i], v_bk_tzs[v_i], 'booked');
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'SLOT_TAKEN: that time was just booked — please pick another slot';
    END;
  END LOOP;

  -- (9e) Link the claimed payments to this submission (rows were
  -- locked FOR UPDATE in (6b), so the claim cannot be stolen).
  IF COALESCE(array_length(v_pay_ids, 1), 0) > 0 THEN
    UPDATE public.payments
       SET submission_id = v_sub_id, updated_at = now()
     WHERE id = ANY (v_pay_ids);
  END IF;

  -- (10) Probabilistic cleanup of expired rate-limit windows (1% of
  -- submissions; BRIN-bounded delete — never a full-table scan), plus
  -- (10b) stale pending uploads: uploads never claimed by a submission
  -- within 24h are garbage (abandoned forms) — their storage objects
  -- and rows are removed. Bounded by the (status, created_at) index.
  IF random() < 0.01 THEN
    DELETE FROM public.form_rate_limits
     WHERE window_start < now() - interval '1 hour';
    DELETE FROM storage.objects
     WHERE bucket_id = 'form-uploads'
       AND name IN (SELECT storage_path FROM public.form_uploads
                     WHERE status = 'pending'
                       AND created_at < now() - interval '24 hours');
    DELETE FROM public.form_uploads
     WHERE status = 'pending'
       AND created_at < now() - interval '24 hours';
  END IF;

  -- (11)
  RETURN jsonb_build_object('ok', true, 'reference', v_sub_seq);
END;
$$;
