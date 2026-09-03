"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];

interface Cursor {
  created_at: string;
  id: string;
}

/**
 * useForms — loads forms for a given workspace, with keyset pagination.
 *
 * Pagination strategy:
 *   - Uses (created_at DESC, id DESC) as the cursor — stable across
 *     inserts, no drift like OFFSET pagination.
 *   - pageSize default 20.
 *   - Returns hasMore flag based on whether we fetched one extra row.
 *
 * ── Loop-safety (Phase 3 fix) ─────────────────────────────────────────
 * The cursor lives in a REF, never in the useCallback dependency array
 * of `load`. The previous implementation kept `cursor` in state AND in
 * `load`'s deps AND `load` in the effect's deps:
 *
 *   effect → setCursor(null) + load(true) → fetch → setCursor({...})
 *   → new `load` identity → effect re-fires → setCursor(null) → new
 *   `load` identity → … an INFINITE fetch cycle (measured: 2,457
 *   identical requests in ~60s, UI stuck flickering "Loading forms…").
 *
 * Now `load` is stable per (workspaceId, pageSize), the effect runs
 * exactly once per workspace change, and `loadMore`/`reload` read the
 * cursor from the ref. A mounted-guard prevents state updates after
 * unmount.
 *
 * Gracefully handles missing tables (migrations not yet applied).
 */
export function useForms(workspaceId: string | null, pageSize = 20) {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<Cursor | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      if (!workspaceId) {
        cursorRef.current = null;
        setForms([]);
        setHasMore(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let query = supabaseBrowser
          .from("forms")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(pageSize + 1);

        const cursor = cursorRef.current;
        if (!reset && cursor) {
          query = query.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
          );
        }

        const { data, error: err } = await query;

        if (err) {
          if (err.code === "42P01" || err.code === "PGRST205") {
            if (!mountedRef.current) return;
            setForms([]);
            setHasMore(false);
          } else {
            throw err;
          }
        } else if (data) {
          if (!mountedRef.current) return;
          const more = data.length > pageSize;
          const rows = more ? data.slice(0, pageSize) : data;
          setForms((prev) => (reset ? (rows as FormRow[]) : [...prev, ...(rows as FormRow[])]));
          setHasMore(more);
          cursorRef.current =
            rows.length > 0
              ? {
                  created_at: (rows[rows.length - 1] as FormRow).created_at,
                  id: (rows[rows.length - 1] as FormRow).id,
                }
              : null;
        }
      } catch (e) {
        if (!mountedRef.current) return;
        const msg = e instanceof Error ? e.message : "Failed to load forms";
        setError(msg);
        console.warn("[useForms] error:", e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [workspaceId, pageSize],
  );

  // Runs exactly once per workspace change — `load` is stable because
  // the cursor no longer participates in its dependency array.
  useEffect(() => {
    cursorRef.current = null;
    void load(true);
  }, [workspaceId, load]);

  const loadMore = useCallback(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => {
    cursorRef.current = null;
    void load(true);
  }, [load]);

  return { forms, loading, error, hasMore, loadMore, reload };
}
