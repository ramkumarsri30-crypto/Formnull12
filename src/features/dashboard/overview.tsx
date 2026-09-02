"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { useWorkspaceCtx } from "@/features/workspace/workspace-context";
import {
  EmptyState,
  LoadingState,
  ErrorState,
} from "@/components/formnull/states";
import { Button } from "@/components/ui/button";
import {
  GeometricCircle,
  GeometricSquare,
  GeometricTriangle,
  GeometricZigZag,
} from "@/components/memphis/memphis-decorations";
import { FileText, Inbox, Plus, ArrowRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type RecentForm = Pick<
  Database["public"]["Tables"]["forms"]["Row"],
  "id" | "name" | "description" | "status" | "created_at"
>;

/**
 * Dashboard overview — ALL data comes from real Supabase queries.
 *
 *   - Forms count:      head COUNT query (no rows transferred)
 *   - Submissions count: head COUNT query on the workspace's submissions
 *   - Workspace plan:   active workspace row (RLS-authorized)
 *   - Member since:     membership.joined_at for the ACTIVE workspace
 *   - Recent forms:     limited query (6 rows, selected columns only)
 *
 * When there is no data, proper empty states are shown — never mock
 * numbers.
 */
export function DashboardOverview() {
  const { user, profile } = useAuth();
  const {
    currentWorkspace,
    currentWorkspaceId,
    memberships,
    loading: wsLoading,
    error: wsError,
    switching,
  } = useWorkspaceCtx();

  const [formsCount, setFormsCount] = useState<number | null>(null);
  const [submissionsCount, setSubmissionsCount] = useState<number | null>(null);
  const [recentForms, setRecentForms] = useState<RecentForm[] | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const memberSince = memberships.find(
    (m) => m.workspace_id === currentWorkspaceId,
  )?.joined_at;

  // Real stats — re-run whenever the active workspace changes.
  useEffect(() => {
    const wsId = currentWorkspaceId;
    let mounted = true;

    async function loadStats() {
      if (!wsId) {
        setFormsCount(null);
        setSubmissionsCount(null);
        setRecentForms(null);
        return;
      }
      await run(wsId);
    }

    async function run(wsId: string) {
      setStatsError(null);
      // Three independent, bounded queries — run in parallel.
      // count/head uses PostgREST's exact count without fetching rows.
      const [formsRes, subsRes, recentRes] = await Promise.all([
        supabaseBrowser
          .from("forms")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId),
        supabaseBrowser
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId),
        supabaseBrowser
          .from("forms")
          .select("id, name, description, status, created_at")
          .eq("workspace_id", wsId)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      if (!mounted) return;

      const firstError = formsRes.error ?? subsRes.error ?? recentRes.error;
      if (firstError) {
        // Missing tables (migrations not applied) → show empty, not fake data.
        if (
          firstError.code === "42P01" ||
          firstError.code === "PGRST205"
        ) {
          setFormsCount(0);
          setSubmissionsCount(0);
          setRecentForms([]);
        } else {
          setStatsError(firstError.message);
        }
        return;
      }
      setFormsCount(formsRes.count ?? 0);
      setSubmissionsCount(subsRes.count ?? 0);
      setRecentForms((recentRes.data as RecentForm[]) ?? []);
    }

    void loadStats();
    return () => {
      mounted = false;
    };
  }, [currentWorkspaceId]);

  const loading = wsLoading || formsCount === null || recentForms === null || switching;

  if (wsError) {
    return (
      <ErrorState
        title="Couldn't load workspace"
        description={wsError}
      />
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Welcome banner */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-foreground p-5 text-background sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <GeometricCircle color="coral" size={120} className="-top-8 -right-8 opacity-80" />
          <GeometricSquare color="mint" size={48} rotate={12} className="bottom-4 right-1/3 opacity-80 hidden sm:block" />
          <GeometricTriangle color="sun" size={40} rotate={-15} className="bottom-2 right-12 opacity-80 hidden md:block" />
          <GeometricZigZag color="background" width={80} className="top-4 left-1/2 opacity-30 hidden lg:block" />
        </div>
        <div className="relative max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-background/70">
            Welcome back
          </p>
          <h1 className="mt-1 font-display text-2xl tracking-tight sm:text-3xl">
            {profile?.display_name ?? user?.email?.split("@")[0] ?? "there"} 👋
          </h1>
          <p className="mt-2 text-sm text-background/80 sm:text-base">
            {currentWorkspace
              ? `Working in ${currentWorkspace.name}.`
              : "Set up a workspace to start building forms."}
          </p>
          <div className="mt-5">
            <Button asChild variant="memphis-coral" size="sm">
              <Link href="/dashboard/forms/new">
                <Plus className="h-4 w-4" />
                Create a form
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats — all real values from Supabase */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatCard
          label="Forms"
          value={loading ? "—" : String(formsCount ?? 0)}
          icon={<FileText className="h-4 w-4" />}
          color="coral"
        />
        <StatCard
          label="Submissions"
          value={loading ? "—" : String(submissionsCount ?? 0)}
          icon={<Inbox className="h-4 w-4" />}
          color="mint"
        />
        <StatCard
          label="Workspace plan"
          value={currentWorkspace?.plan ?? (loading ? "—" : "—")}
          icon={<span className="text-xs font-bold">★</span>}
          color="violet"
        />
        <StatCard
          label="Member since"
          value={
            memberSince
              ? new Date(memberSince).toLocaleDateString()
              : loading
                ? "—"
                : "—"
          }
          icon={<span className="text-xs font-bold">●</span>}
          color="sun"
        />
      </div>

      {statsError && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
          Some stats failed to load: {statsError}
        </p>
      )}

      {/* Recent forms */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            Recent forms
          </h2>
          {(formsCount ?? 0) > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/forms/">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>

        {loading ? (
          <LoadingState title="Loading your forms…" />
        ) : (formsCount ?? 0) === 0 ? (
          <EmptyState
            title="No forms yet"
            description="Create your first form to start collecting submissions. It takes less than a minute."
            icon={<FileText className="h-7 w-7" />}
            action={{
              label: "Create your first form",
              href: "/dashboard/forms/new",
            }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(recentForms ?? []).map((f) => (
              <FormCard key={f.id} form={f} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard                                                            */
/* ------------------------------------------------------------------ */
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "coral" | "mint" | "sun" | "violet";
}) {
  const colorVar = `var(--memphis-${color})`;
  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-foreground/10 bg-surface p-4">
      <div
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md"
        style={{ backgroundColor: colorVar, color: "var(--memphis-ink)" }}
        aria-hidden
      >
        {icon}
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight capitalize sm:text-3xl">
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FormCard                                                            */
/* ------------------------------------------------------------------ */
function FormCard({ form }: { form: RecentForm }) {
  const statusColor =
    form.status === "published"
      ? "var(--memphis-mint)"
      : form.status === "paused"
        ? "var(--memphis-sun)"
        : form.status === "archived"
          ? "var(--muted-foreground)"
          : "var(--memphis-coral)";

  return (
    <Link
      href={`/dashboard/forms/${form.id}`}
      className="group relative block overflow-hidden rounded-xl border-2 border-foreground/10 bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[4px_4px_0_0_var(--memphis-ink)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-semibold text-foreground">{form.name}</h3>
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: statusColor }}
          aria-label={form.status}
        />
      </div>
      {form.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground sm:text-sm">
          {form.description}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="capitalize">{form.status}</span>
        <span>
          {new Date(form.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </Link>
  );
}
