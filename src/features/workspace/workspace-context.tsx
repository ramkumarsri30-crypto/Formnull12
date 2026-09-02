"use client";

/**
 * FormNull — Workspace Context (Phase 2)
 * =====================================================================
 * The single source of truth for active-workspace state across the app.
 *
 * Data flow:
 *   Authenticated Supabase User
 *           ↓
 *   workspace_members (memberships)
 *           ↓
 *   workspaces (rows via RLS — only member-visible)
 *           ↓
 *   active workspace (profile.default_workspace_id, persisted in DB)
 *           ↓
 *   workspace-dependent queries (dashboard, forms, settings)
 *
 * Persistence strategy: the selected workspace is written to
 * `profiles.default_workspace_id` on every switch. That makes the
 * selection survive refresh AND follow the user across devices —
 * the database is the persistence layer, never localStorage.
 *
 * Security: workspace rows are only readable through RLS
 * (fn_user_is_workspace_member), so this context can never leak a
 * workspace the user isn't a member of. Switching merely picks among
 * rows Postgres already authorized.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";
import { toast } from "sonner";
import type { Database } from "@/lib/supabase/types";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"];

interface WorkspaceContextValue {
  workspaces: Workspace[];
  memberships: WorkspaceMember[];
  /** The active workspace row (or null while loading / no membership). */
  currentWorkspace: Workspace | null;
  currentWorkspaceId: string | null;
  /** The user's role in the active workspace (or null). */
  currentRole: Database["public"]["Enums"]["workspace_role"] | null;
  loading: boolean;
  error: string | null;
  /**
   * Switch the active workspace. Persists to profiles.default_workspace_id
   * (Supabase write — the DB is the persistence layer). Consumers re-query
   * automatically because currentWorkspaceId changes.
   */
  setWorkspace: (workspaceId: string) => Promise<void>;
  /**
   * Create a new workspace owned by the current user and switch to it.
   * Real INSERT into public.workspaces + public.workspace_members,
   * guarded by RLS (owner_id = auth.uid()).
   */
  createWorkspace: (name: string, description?: string) => Promise<Workspace | null>;
  /** Re-fetch memberships + workspaces from Supabase. */
  reload: () => Promise<void>;
  /** True while a switch/create is in flight (for disabling controls). */
  switching: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  memberships: [],
  currentWorkspace: null,
  currentWorkspaceId: null,
  currentRole: null,
  loading: true,
  error: null,
  setWorkspace: async () => {},
  createWorkspace: async () => null,
  reload: async () => {},
  switching: false,
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialProfileDefault, setInitialProfileDefault] = useState<string | null | undefined>(
    undefined,
  );

  // Read the profile's default workspace once per user.
  // profile.default_workspace_id is written by setWorkspace() below and by
  // the sign-up trigger — it IS the persisted selection.
  useEffect(() => {
    if (!user) {
      setInitialProfileDefault(undefined);
      return;
    }
    let mounted = true;
    supabaseBrowser
      .from("profiles")
      .select("default_workspace_id")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (mounted) setInitialProfileDefault(data?.default_workspace_id ?? null);
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  const load = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setMemberships([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: memberData, error: memberError } = await supabaseBrowser
        .from("workspace_members")
        .select("*")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true });

      if (memberError) {
        if (memberError.code === "42P01" || memberError.code === "PGRST205") {
          setWorkspaces([]);
          setMemberships([]);
        } else {
          throw memberError;
        }
      } else if (memberData) {
        setMemberships(memberData as WorkspaceMember[]);

        if (memberData.length > 0) {
          const wsIds = memberData.map((m) => m.workspace_id);
          const { data: wsData, error: wsError } = await supabaseBrowser
            .from("workspaces")
            .select("*")
            .in("id", wsIds)
            .order("created_at", { ascending: true });

          if (wsError) throw wsError;
          const wsRows = (wsData as Workspace[]) ?? [];
          setWorkspaces(wsRows);

          // Resolve active workspace:
          //   1. current activeId if still valid (survives reloads)
          //   2. profile.default_workspace_id (persisted selection)
          //   3. first membership (fallback — deterministic)
          setActiveId((prev) => {
            if (prev && wsRows.some((w) => w.id === prev)) return prev;
            const profileDefault =
              initialProfileDefault !== undefined ? initialProfileDefault : null;
            if (profileDefault && wsRows.some((w) => w.id === profileDefault)) {
              return profileDefault;
            }
            return wsRows[0]?.id ?? null;
          });
        } else {
          setWorkspaces([]);
          setActiveId(null);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load workspaces";
      setError(msg);
      console.warn("[workspace] load error:", e);
    } finally {
      setLoading(false);
    }
  }, [user, initialProfileDefault]);

  useEffect(() => {
    if (authLoading) return;
    // Wait until the profile default has been read (or determined null)
    // so the first render doesn't flash the wrong workspace.
    if (user && initialProfileDefault === undefined) return;
    load();
  }, [authLoading, user, initialProfileDefault, load]);

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  const currentRole = useMemo(() => {
    if (!activeId) return null;
    const m = memberships.find((m) => m.workspace_id === activeId);
    return m?.role ?? null;
  }, [memberships, activeId]);

  const setWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!user) return;
      if (!workspaces.some((w) => w.id === workspaceId)) return;
      if (workspaceId === activeId) return;

      setSwitching(true);
      // Optimistic switch — consumers re-query immediately.
      setActiveId(workspaceId);
      try {
        // PERSIST: the DB is the source of truth for the selection.
        const { error: updateError } = await supabaseBrowser
          .from("profiles")
          .update({ default_workspace_id: workspaceId })
          .eq("id", user.id);
        if (updateError) throw updateError;
        setInitialProfileDefault(workspaceId);
      } catch (e) {
        // Persistence failed — revert the optimistic switch and surface
        // a real error. Never pretend the switch succeeded.
        setActiveId(activeId);
        toast.error("Could not switch workspace.", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
      } finally {
        setSwitching(false);
      }
    },
    [user, workspaces, activeId],
  );

  const createWorkspace = useCallback(
    async (name: string, description?: string): Promise<Workspace | null> => {
      if (!user) return null;
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Workspace name is required.");
        return null;
      }
      setSwitching(true);
      try {
        // 1. Insert workspace (RLS: owner_id must be auth.uid()).
        const { data: ws, error: wsError } = await supabaseBrowser
          .from("workspaces")
          .insert({
            slug: slugify(trimmed) + "-" + Math.random().toString(36).slice(2, 6),
            name: trimmed,
            description: description?.trim() || null,
            owner_id: user.id,
          })
          .select()
          .single();
        if (wsError) throw wsError;
        if (!ws) throw new Error("Workspace creation returned no row.");

        // 2. Owner membership (RLS: admins may insert members).
        const { error: memberError } = await supabaseBrowser
          .from("workspace_members")
          .insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });
        if (memberError) {
          // Workspace exists but membership failed → clean up the orphan
          // so the user doesn't end up with an invisible workspace.
          await supabaseBrowser.from("workspaces").delete().eq("id", ws.id);
          throw memberError;
        }

        // 3. Update local state + persist as default.
        setWorkspaces((prev) => [...prev, ws]);
        setMemberships((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            workspace_id: ws.id,
            user_id: user.id,
            role: "owner" as const,
            invited_email: null,
            joined_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
        setActiveId(ws.id);
        const { error: updateError } = await supabaseBrowser
          .from("profiles")
          .update({ default_workspace_id: ws.id })
          .eq("id", user.id);
        if (updateError) throw updateError;
        setInitialProfileDefault(ws.id);

        toast.success("Workspace created!", { description: `Switched to ${trimmed}.` });
        return ws;
      } catch (e) {
        toast.error("Could not create workspace.", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
        return null;
      } finally {
        setSwitching(false);
      }
    },
    [user],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      memberships,
      currentWorkspace,
      currentWorkspaceId: activeId,
      currentRole,
      loading: loading || authLoading || (user !== null && initialProfileDefault === undefined),
      error,
      setWorkspace,
      createWorkspace,
      reload: load,
      switching,
    }),
    [
      workspaces,
      memberships,
      currentWorkspace,
      activeId,
      currentRole,
      loading,
      authLoading,
      user,
      initialProfileDefault,
      error,
      setWorkspace,
      createWorkspace,
      load,
      switching,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceCtx() {
  return useContext(WorkspaceContext);
}

/**
 * Convenience: the user's role for a given workspace id.
 */
export function roleForWorkspace(
  memberships: WorkspaceMember[],
  workspaceId: string,
): Database["public"]["Enums"]["workspace_role"] | null {
  return memberships.find((m) => m.workspace_id === workspaceId)?.role ?? null;
}
