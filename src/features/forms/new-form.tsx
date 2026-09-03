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
import { FIELD_TYPE_REGISTRY, fieldMeta, defaultConfigForType, type FieldType } from "@/features/forms/field-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * New Form page.
 *
 * Phase 1 scope:
 *   - Name + description + initial field configuration
 *   - Save creates a `forms` row (status=draft) + the chosen fields
 *   - Redirects to /dashboard/forms/[id] after save
 *
 * Phase 2 will add the full drag-and-drop builder with field reordering,
 * conditional logic, and per-field validation rules.
 *
 * Field types come from the CENTRALIZED 16-type registry
 * (src/features/forms/field-types.ts) — never a local copy — and every
 * field row is created with the registry's type-appropriate default
 * config, so select-like fields start with a valid `options` array.
 */

interface DraftField {
  field_key: string;
  field_type: FieldType;
  label: string;
  is_required: boolean;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "field_" + Math.random().toString(36).slice(2, 8);
}

export function NewFormPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspaceId, loading: wsLoading, currentWorkspace } = useWorkspaceCtx();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<DraftField[]>([
    { field_key: "name", field_type: "short_text", label: "Name", is_required: true },
    { field_key: "email", field_type: "email", label: "Email", is_required: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string }>({});

  // Unique field_key generation against the current draft fields.
  function uniqueKey(label: string): string {
    const base = slugify(label);
    const keys = fields.map((f) => f.field_key);
    if (!keys.includes(base)) return base;
    let i = 2;
    while (keys.includes(`${base}_${i}`)) i += 1;
    return `${base}_${i}`;
  }

  function addField(type: FieldType) {
    const label = fieldMeta(type)?.defaultLabel ?? "Field";
    const field_key = uniqueKey(label);
    setFields([...fields, { field_key, field_type: type, label, is_required: false }]);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields(fields.filter((_, i) => i !== index));
  }

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
      // 1. Create the form row.
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

      // 2. Create the form fields (if any) — with the registry's
      // type-appropriate default config (selects get valid options).
      if (fields.length > 0) {
        const rows = fields.map((f, i) => ({
          form_id: form.id,
          field_key: f.field_key,
          field_type: f.field_type,
          label: f.label,
          is_required: f.is_required,
          sort_order: i,
          config: defaultConfigForType(f.field_type),
        }));
        const { error: fieldsErr } = await supabaseBrowser
          .from("form_fields")
          .insert(rows);
        if (fieldsErr) throw fieldsErr;
      }

      toast.success("Form created!", { description: "Opening the form editor…" });
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

        {/* Form details */}
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
                placeholder="What is this form for? Visible only to your team."
                disabled={saving}
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Field builder */}
        <div className="rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold">Fields</h3>
              <p className="text-xs text-muted-foreground">
                Add the fields your respondents will fill out.
              </p>
            </div>
          </div>

          {/* Existing fields */}
          {fields.length > 0 && (
            <ul className="mb-4 space-y-2">
              {fields.map((f, i) => (
                <li
                  key={i}
                  className="grid grid-cols-12 items-center gap-2 rounded-lg border border-foreground/10 bg-background p-2"
                >
                  <Input
                    className="col-span-12 sm:col-span-5 h-9"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    placeholder="Field label"
                    disabled={saving}
                  />
                  <Select
                    value={f.field_type}
                    onValueChange={(v) => updateField(i, { field_type: v as FieldType })}
                    disabled={saving}
                  >
                    <SelectTrigger
                      className="col-span-12 h-9 sm:col-span-4"
                      aria-label={`Type for field ${f.label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPE_REGISTRY.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="col-span-3 sm:col-span-2 flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={f.is_required}
                      onChange={(e) => updateField(i, { is_required: e.target.checked })}
                      disabled={saving}
                      className="h-4 w-4 accent-[color:var(--memphis-coral)]"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={saving}
                    className="col-span-2 sm:col-span-1 flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove field ${f.label}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add field buttons */}
          <div className="flex flex-wrap gap-2">
            {FIELD_TYPE_REGISTRY.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => addField(t.value)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-foreground/30 hover:bg-accent/10"
              >
                <span className="flex h-5 w-5 items-center justify-center text-[color:var(--memphis-coral)]" aria-hidden>
                  {(() => {
                    const Icon = t.icon;
                    return <Icon className="h-3.5 w-3.5" />;
                  })()}
                </span>
                {t.label}
              </button>
            ))}
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
        Set up the basics. You can add and reorder fields in the next step.
      </p>
    </div>
  );
}
