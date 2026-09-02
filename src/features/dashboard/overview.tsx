"use client";

import Link from "next/link";
import { useAuth } from "@/features/auth/auth-provider";
import { useWorkspace } from "@/features/dashboard/use-workspace";
import { useForms } from "@/features/forms/use-forms";
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

/**
 * Dashboard overview.
 *
 * Shows:
 *   - Welcome banner with workspace name
 *   - Stat cards (forms count, submissions count)
 *   - Recent forms list (or empty state if no forms)
 *
 * All data is loaded from Supabase via RLS-protected queries. If
 * migrations haven't been applied yet, the UI shows appropriate empty
 * states — no mock data, no fake users, no fake forms.
 */
export function DashboardOverview() {
  const { user, profile } = useAuth();
  const { currentWorkspace, currentWorkspaceId, loading: wsLoading } = useWorkspace();
  const { forms, loading: formsLoading } = useForms(currentWorkspaceId);

  const loading = wsLoading || formsLoading;
  const formsCount = forms.length;
  const submissionsCount = forms.reduce((sum, f) => {
    const n = (f.metadata as { submission_count?: number })?.submission_count ?? 0;
    return sum + n;
  }, 0);

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
              : "Set up your workspace to start building forms."}
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatCard
          label="Forms"
          value={loading ? "—" : String(formsCount)}
          icon={<FileText className="h-4 w-4" />}
          color="coral"
        />
        <StatCard
          label="Submissions"
          value={loading ? "—" : String(submissionsCount)}
          icon={<Inbox className="h-4 w-4" />}
          color="mint"
        />
        <StatCard
          label="Workspace plan"
          value={currentWorkspace?.plan ?? "free"}
          icon={<span className="text-xs font-bold">★</span>}
          color="violet"
        />
        <StatCard
          label="Member since"
          value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}
          icon={<span className="text-xs font-bold">●</span>}
          color="sun"
        />
      </div>

      {/* Recent forms */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            Recent forms
          </h2>
          {formsCount > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/forms">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>

        {loading ? (
          <LoadingState title="Loading your forms…" />
        ) : formsCount === 0 ? (
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
            {forms.slice(0, 6).map((f) => (
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
import type { Database } from "@/lib/supabase/types";
type FormRow = Database["public"]["Tables"]["forms"]["Row"];

function FormCard({ form }: { form: FormRow }) {
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
