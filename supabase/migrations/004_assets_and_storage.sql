-- =====================================================================
-- FormNull Migration 004 — Assets, Storage Buckets, Storage Policies
-- =====================================================================
-- Establishes:
--   * assets table — metadata for every file uploaded to Supabase Storage
--     (kept in Postgres so it can be queried, joined, and protected by RLS)
--   * Storage buckets:
--       - avatars         (public read; user-scoped write)
--       - workspaces      (private; workspace-scoped)
--       - form-assets     (private; form-scoped)
--       - submissions     (private; submission-scoped)
--       - exports         (private; workspace-scoped, time-limited)
--
-- Storage policies enforce path-based ownership:
--   avatars/{user_id}/...        — only that user can write/delete
--   workspaces/{workspace_id}/.. — workspace members can read;
--                                  admins can write/delete
--   form-assets/{form_id}/...    — workspace members can read;
--                                  editors can write/delete
--   submissions/{submission_id}/.. — workspace members can read;
--                                     submitter can write (Phase 2)
--   exports/{workspace_id}/...   — workspace admins only
--
-- All buckets are private EXCEPT avatars (public-read for rendering).
-- Private files are served via signed URLs generated server-side.
-- =====================================================================

-- ------------------------------------------------------------------
-- assets table — metadata for every file in Storage
-- ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE asset_kind AS ENUM (
    'avatar', 'workspace_logo', 'form_asset',
    'submission_upload', 'export', 'inline_image'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id         uuid REFERENCES public.forms(id) ON DELETE CASCADE,
  submission_id   uuid REFERENCES public.submissions(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            asset_kind NOT NULL,
  bucket          text NOT NULL,
  storage_path    text NOT NULL,
  original_filename text,
  mime_type       text,
  size_bytes      bigint NOT NULL DEFAULT 0,
  -- Image-specific (populated on upload)
  width           int,
  height          int,
  -- SHA-256 for dedup / integrity
  checksum        text,
  -- Visibility model — but actual access is enforced by Storage policies.
  is_public       boolean NOT NULL DEFAULT false,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_owner_id_idx ON public.assets(owner_id);
CREATE INDEX IF NOT EXISTS assets_workspace_id_idx ON public.assets(workspace_id);
CREATE INDEX IF NOT EXISTS assets_form_id_idx ON public.assets(form_id);
CREATE INDEX IF NOT EXISTS assets_submission_id_idx ON public.assets(submission_id);
CREATE INDEX IF NOT EXISTS assets_kind_idx ON public.assets(kind);
CREATE INDEX IF NOT EXISTS assets_bucket_path_idx ON public.assets(bucket, storage_path);

CREATE OR REPLACE FUNCTION public.fn_assets_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assets_touch_updated_at ON public.assets;
CREATE TRIGGER trg_assets_touch_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.fn_assets_touch_updated_at();

-- RLS for assets: owner can always see their own assets; workspace members
-- can see assets tied to their workspaces/forms/submissions.
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assets_select_owner_or_member ON public.assets;
CREATE POLICY assets_select_owner_or_member ON public.assets
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.fn_user_is_workspace_member(workspace_id))
    OR (form_id IS NOT NULL AND public.fn_user_is_form_member(form_id))
  );

DROP POLICY IF EXISTS assets_insert_owner ON public.assets;
CREATE POLICY assets_insert_owner ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      -- avatar: must be owned by user, no workspace needed
      (kind = 'avatar' AND workspace_id IS NULL)
      -- workspace_logo: must be admin of workspace
      OR (kind = 'workspace_logo' AND workspace_id IS NOT NULL AND public.fn_user_can_admin_workspace(workspace_id))
      -- form_asset: must be editor of form's workspace
      OR (kind = 'form_asset' AND form_id IS NOT NULL AND public.fn_user_can_edit_form(form_id))
      -- submission_upload: in Phase 1 only authed members create submissions
      OR (kind = 'submission_upload' AND submission_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.submissions s
        WHERE s.id = submission_id AND public.fn_user_is_workspace_member(s.workspace_id)
      ))
      -- export: admin only
      OR (kind = 'export' AND workspace_id IS NOT NULL AND public.fn_user_can_admin_workspace(workspace_id))
      -- inline_image: editor of form's workspace
      OR (kind = 'inline_image' AND form_id IS NOT NULL AND public.fn_user_can_edit_form(form_id))
    )
  );

DROP POLICY IF EXISTS assets_update_owner ON public.assets;
CREATE POLICY assets_update_owner ON public.assets
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS assets_delete_owner_or_admin ON public.assets;
CREATE POLICY assets_delete_owner_or_admin ON public.assets
  FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.fn_user_can_admin_workspace(workspace_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;

-- ------------------------------------------------------------------
-- Storage buckets
-- ------------------------------------------------------------------
-- avatars: public-read bucket. Users can read anyone's avatar (for UI
-- rendering) but only write/delete their own.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true, 5242880,
  ARRAY['image/png','image/jpeg','image/webp','image/gif']
) ON CONFLICT (id) DO NOTHING;

-- workspaces: private. Workspace-scoped logos & branding.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspaces', 'workspaces', false, 10485760,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']
) ON CONFLICT (id) DO NOTHING;

-- form-assets: private. Files attached to a form during design
-- (cover images, decorative assets, etc.).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-assets', 'form-assets', false, 10485760,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','image/gif','application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- submissions: private. Files uploaded by submitters as field answers.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submissions', 'submissions', false, 26214400,
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

-- exports: private. Workspace-scoped export files (CSV/XLSX exports).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exports', 'exports', false, 104857600,
  ARRAY[
    'text/csv','text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json','application/zip'
  ]
) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------
-- Storage RLS policies (Storage uses its own policy model on storage.objects)
-- =====================================================================
-- Path conventions:
--   avatars/{user_id}/{filename}
--   workspaces/{workspace_id}/{filename}
--   form-assets/{form_id}/{filename}
--   submissions/{submission_id}/{filename}
--   exports/{workspace_id}/{filename}
-- ------------------------------------------------------------------

-- ======================
-- avatars bucket
-- ======================
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_write" ON storage.objects;
CREATE POLICY "avatars_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ======================
-- workspaces bucket
-- ======================
DROP POLICY IF EXISTS "workspaces_member_read" ON storage.objects;
CREATE POLICY "workspaces_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'workspaces'
    AND public.fn_user_is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "workspaces_admin_write" ON storage.objects;
CREATE POLICY "workspaces_admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspaces'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "workspaces_admin_update" ON storage.objects;
CREATE POLICY "workspaces_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'workspaces'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'workspaces'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "workspaces_admin_delete" ON storage.objects;
CREATE POLICY "workspaces_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspaces'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

-- ======================
-- form-assets bucket
-- ======================
DROP POLICY IF EXISTS "form_assets_member_read" ON storage.objects;
CREATE POLICY "form_assets_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-assets'
    AND public.fn_user_is_form_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "form_assets_editor_write" ON storage.objects;
CREATE POLICY "form_assets_editor_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'form-assets'
    AND public.fn_user_can_edit_form(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "form_assets_editor_update" ON storage.objects;
CREATE POLICY "form_assets_editor_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'form-assets'
    AND public.fn_user_can_edit_form(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'form-assets'
    AND public.fn_user_can_edit_form(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "form_assets_editor_delete" ON storage.objects;
CREATE POLICY "form_assets_editor_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'form-assets'
    AND public.fn_user_can_edit_form(((storage.foldername(name))[1])::uuid)
  );

-- ======================
-- submissions bucket
-- ======================
DROP POLICY IF EXISTS "submissions_member_read" ON storage.objects;
CREATE POLICY "submissions_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'submissions'
    AND EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = ((storage.foldername(name))[1])::uuid
        AND public.fn_user_is_workspace_member(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS "submissions_member_write" ON storage.objects;
CREATE POLICY "submissions_member_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submissions'
    AND EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = ((storage.foldername(name))[1])::uuid
        AND public.fn_user_is_workspace_member(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS "submissions_admin_update" ON storage.objects;
CREATE POLICY "submissions_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'submissions'
    AND EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = ((storage.foldername(name))[1])::uuid
        AND public.fn_user_can_admin_workspace(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS "submissions_admin_delete" ON storage.objects;
CREATE POLICY "submissions_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'submissions'
    AND EXISTS(
      SELECT 1 FROM public.submissions s
      WHERE s.id = ((storage.foldername(name))[1])::uuid
        AND public.fn_user_can_admin_workspace(s.workspace_id)
    )
  );

-- ======================
-- exports bucket
-- ======================
DROP POLICY IF EXISTS "exports_admin_read" ON storage.objects;
CREATE POLICY "exports_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'exports'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "exports_admin_write" ON storage.objects;
CREATE POLICY "exports_admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'exports'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "exports_admin_update" ON storage.objects;
CREATE POLICY "exports_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'exports'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "exports_admin_delete" ON storage.objects;
CREATE POLICY "exports_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'exports'
    AND public.fn_user_can_admin_workspace(((storage.foldername(name))[1])::uuid)
  );
