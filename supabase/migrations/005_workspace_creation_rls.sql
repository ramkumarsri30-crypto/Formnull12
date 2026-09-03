-- =====================================================================
-- FormNull Migration 005 — Workspace Creation RLS Fix (bootstrap RPC)
-- =====================================================================
-- STATUS: CREATED BUT **NOT APPLIED** — the project owner applies
-- migrations manually through the Supabase SQL editor.
--
-- THE ORIGINAL CIRCULAR-RLS PROBLEM
-- ---------------------------------
-- Migration 001 ships these policies:
--
--   workspaces_insert_owner (INSERT on workspaces)
--       WITH CHECK (owner_id = auth.uid())
--       → any authenticated user CAN insert a workspace they own.
--
--   wm_insert_admin (INSERT on workspace_members)
--       WITH CHECK (public.fn_user_can_admin_workspace(workspace_id))
--       → requires an EXISTING owner/admin membership row for that
--         workspace for auth.uid().
--
--   workspaces_delete_owner (DELETE on workspaces)
--       USING (public.fn_user_owns_workspace(id))
--       → also requires an EXISTING owner membership row.
--
-- The app's workspace-creation flow performed two client-side inserts:
--   1) INSERT INTO workspaces ... owner_id = auth.uid()   → SUCCEEDS
--   2) INSERT INTO workspace_members (owner row)          → BLOCKED by
--      wm_insert_admin, because the creator has no membership yet.
--      Membership cannot exist before it is inserted, but inserting it
--      requires it to already exist — a circular dependency.
--   3) The cleanup DELETE of the just-created orphan workspace is ALSO
--      blocked by workspaces_delete_owner (same circularity), so the
--      orphan row (e.g. "debug-test-ws") can only be removed with the
--      service role.
--
-- THE FIX — ATOMIC SECURITY DEFINER RPC
-- -------------------------------------
-- `public.create_workspace(p_name, p_description)` inserts the workspace
-- AND the owner membership in ONE transaction. If any statement fails,
-- the whole transaction rolls back — an orphan workspace row becomes
-- structurally impossible. This mirrors the trusted pattern already in
-- production for sign-ups: fn_handle_new_user() (migration 001) is also
-- SECURITY DEFINER and bootstraps profile + workspace + membership
-- because the freshly-created user has no RLS grants yet.
--
-- WHY THE RPC IS SAFE (authorization reasoning)
-- ---------------------------------------------
-- * The workspace row is always created with owner_id = auth.uid().
-- * The membership row is always (auth.uid(), 'owner') for exactly that
--   new workspace. There is NO parameter for workspace_id or user_id, so
--   a caller CANNOT create a membership in another user's workspace,
--   CANNOT grant themselves a role in an existing workspace, and CANNOT
--   spoof another owner. Cross-tenant membership creation is impossible
--   by construction, not by policy inspection.
-- * EXECUTE is revoked from PUBLIC and anon; granted only to
--   authenticated. The service role (postgres owner) may call it, which
--   is the standard privilege model for Supabase RPCs.
-- * SECURITY DEFINER runs as the function owner (postgres) — the same
--   trust level as the existing sign-up trigger. search_path is pinned
--   to public to prevent schema-shadowing attacks.
-- * RLS policies from migrations 001–004 are NOT weakened or altered:
--   wm_insert_admin keeps guarding every non-RPC membership insert.
--
-- WHY NOT A LOOSER wm_insert_admin POLICY INSTEAD?
-- ------------------------------------------------
-- A policy like "you may insert your own owner membership when
-- workspaces.owner_id = auth.uid()" would still leave a two-statement
-- client flow: a crash between the statements produces an orphan
-- workspace (exactly the observed bug), and the policy surface grows.
-- The RPC keeps every policy untouched and puts bootstrap authorization
-- in a single, auditable place. It is also the pattern Supabase
-- recommends for owner-bootstrap deadlocks.
--
-- IDEMPOTENCY / SAFETY FOR EXISTING DATA
-- --------------------------------------
-- * CREATE OR REPLACE + idempotent REVOKE/GRANT → safe to re-run.
-- * Touches NO existing rows, tables, columns, or policies: existing
--   workspaces, members, profiles, forms and submissions are unaffected.
-- * Rollback (if ever needed): DROP FUNCTION public.create_workspace(text, text);
--   — no data is lost because the function owns no persistent state.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_workspace(
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.workspaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       uuid;
  v_slug       text;
  v_base_slug  text;
  v_attempt    int := 0;
  v_workspace  public.workspaces;
BEGIN
  -- Authorization: a signed-in user is mandatory. auth.uid() is NULL for
  -- anon key usage and for service-key calls without a user JWT, so those
  -- are rejected outright.
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: create_workspace requires a signed-in user';
  END IF;

  -- Input validation (matches the app's own guard: non-empty after trim).
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME: workspace name cannot be empty';
  END IF;

  -- Derive a unique slug with the same convention as fn_handle_new_user():
  -- lower-case, non-alphanumerics collapsed to '-', suffixed on collision.
  v_slug := lower(regexp_replace(btrim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := 'workspace';
  END IF;
  v_base_slug := v_slug;

  WHILE EXISTS (SELECT 1 FROM public.workspaces w WHERE w.slug = v_slug) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base_slug || '-' || v_attempt;
  END LOOP;
  -- Note: under extreme concurrency the loop can race; the UNIQUE
  -- constraint on workspaces.slug is the hard backstop and surfaces a
  -- clean unique-violation error the caller can retry.

  -- Atomic bootstrap: workspace + owner membership in ONE transaction.
  -- An orphan is impossible — a failure anywhere rolls everything back.
  INSERT INTO public.workspaces (slug, name, description, owner_id)
  VALUES (v_slug, btrim(p_name), nullif(btrim(p_description), ''), v_user)
  RETURNING * INTO v_workspace;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace.id, v_user, 'owner');

  RETURN v_workspace;
END;
$$;

-- Execution privileges: authenticated users only (never anon / public).
REVOKE EXECUTE ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;
