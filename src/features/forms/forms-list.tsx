"use client";

import Link from "next/link";
import { useWorkspaceCtx } from "@/features/workspace/workspace-context";
import { useForms } from "@/features/forms/use-forms";
import {
  EmptyState,
  LoadingState,
  ErrorState,
} from "@/components/formnull/states";
import { Button } from "@/components/ui/button";
import { FileText, Plus } from "lucide-react";
import type { Database } from "@/lib/supabase/types";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];

export function FormsList() {
  const { currentWorkspaceId, loading: wsLoading, error: wsError, currentWorkspace } = useWorkspaceCtx();
  const { forms, loading: formsLoading, error: formsError, reload } = useForms(currentWorkspaceId);

  const loading = wsLoading || formsLoading;

  if (loading) {
    return <LoadingState title="Loading forms…" />;
  }

  if (wsError || formsError) {
    return (
      <ErrorState
        title="Couldn't load forms"
        description={wsError ?? formsError ?? undefined}
        onRetry={reload}
      />
    );
  }

  if (forms.length === 0) {
    return (
      <div className="space-y-4">
        <Header workspaceName={currentWorkspace?.name} />
        <EmptyState
          title="No forms yet"
          description="Create your first form to start collecting submissions. Forms are workspace-scoped and use normalized storage for unlimited scale."
          icon={<FileText className="h-7 w-7" />}
          action={{
            label: "Create your first form",
            href: "/dashboard/forms/new",
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header workspaceName={currentWorkspace?.name} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {forms.map((f) => (
          <FormRowCard key={f.id} form={f} />
        ))}
      </div>
    </div>
  );
}

function Header({ workspaceName }: { workspaceName?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Forms
        </h1>
        <p className="text-sm text-muted-foreground">
          {workspaceName
            ? `All forms in ${workspaceName}.`
            : "Manage all forms in this workspace."}
        </p>
      </div>
      <Button asChild variant="memphis-coral" size="sm">
        <Link href="/dashboard/forms/new">
          <Plus className="h-4 w-4" />
          New form
        </Link>
      </Button>
    </div>
  );
}

function FormRowCard({ form }: { form: FormRow }) {
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
        <h3 className="line-clamp-2 font-semibold">{form.name}</h3>
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
            year: "numeric",
          })}
        </span>
      </div>
    </Link>
  );
}
