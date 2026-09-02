"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";
import type { Database } from "@/lib/supabase/types";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"];

/**
 * useWorkspace — loads the current user's workspaces + membership info.
 *
 * For Phase 1, we surface the user's default workspace (or first workspace
 * if no default is set). The hook gracefully handles the case where
 * migrations haven't been applied yet (tables don't exist) by returning
 * empty arrays.
 *
 * Implementation note: we do TWO separate queries (memberships, then
 * workspaces by id) instead of a join, to keep the type inference clean
 * and to allow partial failure (e.g., if a workspace was deleted but the
 * membership row lingers).
 */
export function useWorkspace() {
  const { user, profile, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentWorkspaceId =
    profile?.default_workspace_id ?? workspaces[0]?.id ?? null;
  const currentWorkspace =
    workspaces.find((w) => w.id === currentWorkspaceId) ?? null;

  const load = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setMemberships([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Load memberships
      const { data: memberData, error: memberError } = await supabaseBrowser
        .from("workspace_members")
        .select("*")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true });

      if (memberError) {
        // Most likely: tables don't exist yet (migrations not applied).
        if (memberError.code === "42P01" || memberError.code === "PGRST205") {
          setWorkspaces([]);
          setMemberships([]);
        } else {
          throw memberError;
        }
      } else if (memberData) {
        setMemberships(memberData as WorkspaceMember[]);

        // 2. Load workspaces by id (separate query to avoid join typing issues)
        if (memberData.length > 0) {
          const wsIds = memberData.map((m) => m.workspace_id);
          const { data: wsData, error: wsError } = await supabaseBrowser
            .from("workspaces")
            .select("*")
            .in("id", wsIds)
            .order("created_at", { ascending: true });

          if (wsError) {
            throw wsError;
          }
          setWorkspaces((wsData as Workspace[]) ?? []);
        } else {
          setWorkspaces([]);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load workspace";
      setError(msg);
      console.warn("[useWorkspace] error:", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  return {
    workspaces,
    memberships,
    currentWorkspace,
    currentWorkspaceId,
    loading: loading || authLoading,
    error,
    reload: load,
  };
}
