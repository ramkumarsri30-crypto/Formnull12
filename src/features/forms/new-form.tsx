"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWorkspaceCtx } from "@/features/workspace/workspace-context";
import { useAuth } from "@/features/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GeometricCircle,
  GeometricTriangle,
  GeometricSquare,
} from "@/components/memphis/memphis-decorations";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * New Form page (Field System 2.0).
 *
 * The creation step collects ONLY:
 *   - Form name           (required)
 *   - Description         (optional)
 *
 * ZERO fields are created. No default Name/Email/anything is inserted —
 * the builder opens with an empty canvas, the field library available,
 * and a clear "add your first field" experience. Fields are real rows
 * created one by one in the builder (immediate INSERT, registry-driven
 * defaults) — nothing is pre-seeded or mocked here.
 */

export function NewFormPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspaceId, loading: wsLoading, currentWorkspace } = useWorkspaceCtx();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "Form name is required." });
      return;
    }
    if (!user) {
      toast.error("You must be signed in to create a form.");
      return;
    }
    if (!currentWorkspaceId) {
      toast.error("No workspace available.", {
        description: "Please refresh the page or contact support.",
      });
      return;
    }

    setSaving(true);

    try {
      // Create the form row — and nothing else. No field rows are
      // inserted here; the builder owns field creation.
      const { data: form, error: formErr } = await supabaseBrowser
        .from("forms")
        .insert({
          workspace_id: currentWorkspaceId,
          name: name.trim(),
          description: description.trim() || null,
          status: "draft",
          created_by: user.id,
        })
        .select()
        .single();

      if (formErr) throw formErr;
      if (!form) throw new Error("Form creation returned no row.");

      toast.success("Form created!", {
        description: "Opening the builder — add your first field.",
      });
      router.push(`/dashboard/forms/${form.id}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create form.";
      toast.error("Failed to create form.", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  if (wsLoading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-2xl border-2 border-foreground/10 bg-surface p-8">
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Workspace context banner — real, from the active workspace */}
        <div className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Workspace:</span>
          <span className="truncate">{currentWorkspace?.name ?? "—"}</span>
        </div>

        {/* Form details — the ONLY creation inputs */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
          <GeometricCircle color="coral" size={32} className="-top-3 -right-3 opacity-80" />
          <div className="relative space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Form name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer feedback survey"
                disabled={saving}
                aria-invalid={!!errors.name}
                className="h-11"
                autoFocus
              />
              {errors.name && (
                <p className="text-xs font-medium text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this form for? You can change this later."
                disabled={saving}
                rows={3}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The form starts empty — you add every field yourself in the builder.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => router.push("/dashboard/forms")}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="memphis-coral"
            size="lg"
            disabled={saving || !currentWorkspaceId}
            className="w-full sm:w-auto"
          >
            {saving ? "Creating form…" : "Create form"}
          </Button>
        </div>
      </form>

      {/* Decorative footer */}
      <div aria-hidden className="pointer-events-none relative h-8 overflow-hidden">
        <GeometricTriangle color="mint" size={32} rotate={-15} className="left-4 opacity-30" />
        <GeometricSquare color="violet" size={24} rotate={12} className="right-8 opacity-30" />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        Create a new form
      </h1>
      <p className="text-sm text-muted-foreground">
        Name it now — build the questions in the next step.
      </p>
    </div>
  );
}
