"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];

/**
 * useForms — loads forms for a given workspace, with keyset pagination.
 *
 * Pagination strategy:
 *   - Uses (created_at DESC, id DESC) as the cursor — stable across
 *     inserts, no drift like OFFSET pagination.
 *   - pageSize default 20.
 *   - Returns hasMore flag based on whether we fetched one extra row.
 *
 * Gracefully handles missing tables (migrations not yet applied).
 */
export function useForms(workspaceId: string | null, pageSize = 20) {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<{ created_at: string; id: string } | null>(null);

  const load = useCallback(
    async (reset = false) => {
      if (!workspaceId) {
        setForms([]);
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

        if (!reset && cursor) {
          query = query.or(
            `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
          );
        }

        const { data, error: err } = await query;

        if (err) {
          if (err.code === "42P01" || err.code === "PGRST205") {
            setForms([]);
            setHasMore(false);
          } else {
            throw err;
          }
        } else if (data) {
          const more = data.length > pageSize;
          const rows = more ? data.slice(0, pageSize) : data;
          setForms((prev) => (reset ? rows : [...prev, ...rows]));
          setHasMore(more);
          if (rows.length > 0) {
            const last = rows[rows.length - 1];
            setCursor({ created_at: last.created_at, id: last.id });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load forms";
        setError(msg);
        console.warn("[useForms] error:", e);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, pageSize, cursor],
  );

  useEffect(() => {
    setCursor(null);
    load(true);
  }, [workspaceId, load]);

  return {
    forms,
    loading,
    error,
    hasMore,
    loadMore: () => load(false),
    reload: () => {
      setCursor(null);
      load(true);
    },
  };
}
