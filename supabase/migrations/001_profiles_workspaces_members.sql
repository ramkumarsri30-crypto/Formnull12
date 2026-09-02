-- =====================================================================
-- FormNull Migration 001 — Profiles, Workspaces, Members
-- =====================================================================
-- Establishes the multi-tenant foundation:
--   * profiles             — application-level user data, FK to auth.users
--   * workspaces           — top-level tenant / organization container
--   * workspace_members    — membership + role per workspace
--   * workspace_invites    — pending invitations (foundation for later)
--
-- All user-owned tables have RLS enabled. Policies enforce that:
--   * A user can read/update only their own profile.
--   * A user can read a workspace only if they are a member of it.
--   * Workspace mutation is restricted to owner/admin role.
--
-- A SECURITY DEFINER trigger auto-creates a personal workspace when a
-- new auth.users row is inserted (sign-up).
--
-- Scalability notes:
--   * UUID PKs avoid integer overflow at 50M+ users.
--   * workspace_members has a UNIQUE(workspace_id, user_id) constraint
--     + supporting index on user_id for "my workspaces" queries.
--   * All timestamp columns are TIMESTAMPTZ (UTC) for global correctness.
-- =====================================================================

-- ------------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------------
-- uuid-ossp + pgcrypto are already available in Supabase by default.
-- We use gen_random_uuid() for any UUIDs we generate outside auth.users.

-- ------------------------------------------------------------------
-- Enumerations
-- ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workspace_plan AS ENUM ('free', 'pro', 'business', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  display_name    text,
  avatar_path     text,
  default_workspace_id uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON public.profiles(created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_profiles_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_touch_updated_at();

-- ------------------------------------------------------------------
-- workspaces
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  avatar_path     text,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan            workspace_plan NOT NULL DEFAULT 'free',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_owner_id_idx ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS workspaces_created_at_idx ON public.workspaces(created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_workspaces_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workspaces_touch_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_touch_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.fn_workspaces_touch_updated_at();

-- ------------------------------------------------------------------
-- workspace_members
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            workspace_role NOT NULL DEFAULT 'editor',
  invited_email   text,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_id_idx ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_role_idx ON public.workspace_members(role);

CREATE OR REPLACE FUNCTION public.fn_workspace_members_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workspace_members_touch_updated_at ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_touch_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_workspace_members_touch_updated_at();

-- ------------------------------------------------------------------
-- workspace_invites (foundation for collaboration; not yet used by app)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_email   text NOT NULL,
  invited_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role            workspace_role NOT NULL DEFAULT 'editor',
  token           text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invites_workspace_id_idx ON public.workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_invites_invited_email_idx ON public.workspace_invites(invited_email);
CREATE INDEX IF NOT EXISTS workspace_invites_token_idx ON public.workspace_invites(token);

CREATE OR REPLACE FUNCTION public.fn_workspace_invites_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workspace_invites_touch_updated_at ON public.workspace_invites;
CREATE TRIGGER trg_workspace_invites_touch_updated_at
  BEFORE UPDATE ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.fn_workspace_invites_touch_updated_at();

-- ------------------------------------------------------------------
-- Sign-up trigger: auto-create profile + personal workspace
-- Runs as SECURITY DEFINER (system) so it can write to public.profiles
-- and public.workspaces even though the new user has no RLS grants yet.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_workspace_id uuid;
  base_slug text;
  final_slug text;
  slug_attempt int := 0;
BEGIN
  -- 1. Insert profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  -- 2. Create personal workspace
  base_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN base_slug := 'workspace'; END IF;
  final_slug := base_slug;

  LOOP
    SELECT id INTO new_workspace_id FROM public.workspaces WHERE slug = final_slug;
    EXIT WHEN new_workspace_id IS NULL;
    slug_attempt := slug_attempt + 1;
    final_slug := base_slug || '-' || slug_attempt;
  END LOOP;

  INSERT INTO public.workspaces (slug, name, owner_id, description)
  VALUES (final_slug, split_part(NEW.email, '@', 1) || '''s workspace', NEW.id, 'Personal workspace')
  RETURNING id INTO new_workspace_id;

  -- 3. Add user as owner of the new workspace
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner');

  -- 4. Set default workspace
  UPDATE public.profiles SET default_workspace_id = new_workspace_id WHERE id = NEW.id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- Revoke function execution from anon/authenticated — only the system trigger should call it.
REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC;

-- ------------------------------------------------------------------
-- Helper: is current user a member of given workspace with role >= X?
-- Returns boolean. Used by RLS policies to avoid repeating subqueries.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_user_workspace_role(p_workspace_id uuid)
RETURNS workspace_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wm.role FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id AND wm.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.fn_user_is_workspace_member(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_user_can_edit_workspace(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin','editor')
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_user_can_admin_workspace(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_user_owns_workspace(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
  );
$$;

REVOKE EXECUTE ON FUNCTION
  public.fn_user_workspace_role(uuid),
  public.fn_user_is_workspace_member(uuid),
  public.fn_user_can_edit_workspace(uuid),
  public.fn_user_can_admin_workspace(uuid),
  public.fn_user_owns_workspace(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.fn_user_workspace_role(uuid),
  public.fn_user_is_workspace_member(uuid),
  public.fn_user_can_edit_workspace(uuid),
  public.fn_user_can_admin_workspace(uuid),
  public.fn_user_owns_workspace(uuid)
TO authenticated;

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- profiles: self-only read/write
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No INSERT/DELETE via API — profiles are created/removed by the system trigger.

-- workspaces: visible to members, editable by editors+, deletable by owner only
DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(id));

DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;
CREATE POLICY workspaces_insert_owner ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS workspaces_update_editor ON public.workspaces;
CREATE POLICY workspaces_update_editor ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.fn_user_can_edit_workspace(id))
  WITH CHECK (public.fn_user_can_edit_workspace(id));

DROP POLICY IF EXISTS workspaces_delete_owner ON public.workspaces;
CREATE POLICY workspaces_delete_owner ON public.workspaces
  FOR DELETE TO authenticated
  USING (public.fn_user_owns_workspace(id));

-- workspace_members: visible to workspace members, managed by admins
DROP POLICY IF EXISTS wm_select_member ON public.workspace_members;
CREATE POLICY wm_select_member ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.fn_user_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS wm_insert_admin ON public.workspace_members;
CREATE POLICY wm_insert_admin ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS wm_update_admin ON public.workspace_members;
CREATE POLICY wm_update_admin ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id))
  WITH CHECK (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS wm_delete_admin ON public.workspace_members;
CREATE POLICY wm_delete_admin ON public.workspace_members
  FOR DELETE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id));

-- workspace_invites: visible to workspace admins
DROP POLICY IF EXISTS wi_select_admin ON public.workspace_invites;
CREATE POLICY wi_select_admin ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS wi_insert_admin ON public.workspace_invites;
CREATE POLICY wi_insert_admin ON public.workspace_invites
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS wi_update_admin ON public.workspace_invites;
CREATE POLICY wi_update_admin ON public.workspace_invites
  FOR UPDATE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id))
  WITH CHECK (public.fn_user_can_admin_workspace(workspace_id));

DROP POLICY IF EXISTS wi_delete_admin ON public.workspace_invites;
CREATE POLICY wi_delete_admin ON public.workspace_invites
  FOR DELETE TO authenticated
  USING (public.fn_user_can_admin_workspace(workspace_id));

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles, public.workspaces, public.workspace_members, public.workspace_invites
  TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
