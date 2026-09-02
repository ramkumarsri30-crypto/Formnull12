"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/formnull/states";
import {
  GeometricCircle,
  GeometricTriangle,
} from "@/components/memphis/memphis-decorations";
import { supabaseBrowser } from "@/lib/supabase/client";
import type {
  Database,
  FieldType,
} from "@/lib/supabase/types";
import { ArrowLeft, Trash2, FileText } from "lucide-react";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormField = Database["public"]["Tables"]["form_fields"]["Row"];

/**
 * Form detail page.
 *
 * Phase 1 surfaces:
 *   - Edit form name + description
 *   - View list of fields
 *   - Delete the form
 *
 * Phase 2 will add:
 *   - Full drag-and-drop field reordering
 *   - Per-field configuration (validation, options, etc.)
 *   - Publish / unpublish with versioning
 *   - Public share link
 */
export function FormDetail({ formId }: { formId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormRow | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable form state (keyed remount would be cleaner; for single-form
  // editing we accept the lint pattern with a guard).
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);
  const [descInitialized, setDescInitialized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formRes, fieldsRes] = await Promise.all([
        supabaseBrowser.from("forms").select("*").eq("id", formId).maybeSingle(),
        supabaseBrowser
          .from("form_fields")
          .select("*")
          .eq("form_id", formId)
          .order("sort_order", { ascending: true }),
      ]);

      if (formRes.error) throw formRes.error;
      if (!formRes.data) {
        setForm(null);
        setError("Form not found, or you don't have access to it.");
        setLoading(false);
        return;
      }
      setForm(formRes.data);
      if (!nameInitialized) {
        setName(formRes.data.name);
        setNameInitialized(true);
      }
      if (!descInitialized) {
        setDescription(formRes.data.description ?? "");
        setDescInitialized(true);
      }

      if (fieldsRes.error) throw fieldsRes.error;
      setFields(fieldsRes.data ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load form.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [formId, nameInitialized, descInitialized]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveForm() {
    if (!form) return;
    setSaving(true);
    const { error } = await supabaseBrowser
      .from("forms")
      .update({ name: name.trim(), description: description.trim() || null })
      .eq("id", form.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save form.", { description: error.message });
      return;
    }
    toast.success("Form updated.");
    setForm({ ...form, name: name.trim(), description: description.trim() || null });
  }

  async function deleteForm() {
    if (!form) return;
    if (!confirm(`Delete "${form.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabaseBrowser.from("forms").delete().eq("id", form.id);
    setDeleting(false);
    if (error) {
      toast.error("Could not delete form.", { description: error.message });
      return;
    }
    toast.success("Form deleted.");
    router.push("/dashboard/forms");
    router.refresh();
  }

  if (loading) return <LoadingState title="Loading form…" />;
  if (error) return <ErrorState title="Couldn't load form" description={error} />;
  if (!form) {
    return (
      <EmptyState
        title="Form not found"
        description="This form may have been deleted, or you don't have access."
        icon={<FileText className="h-7 w-7" />}
        action={{ label: "Back to forms", href: "/dashboard/forms" }}
      />
    );
  }

  const statusColor =
    form.status === "published"
      ? "var(--memphis-mint)"
      : form.status === "paused"
        ? "var(--memphis-sun)"
        : form.status === "archived"
          ? "var(--muted-foreground)"
          : "var(--memphis-coral)";

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/dashboard/forms"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to forms
        </Link>
      </div>

      {/* Form header */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
        <GeometricCircle color="coral" size={32} className="-top-3 -right-3 opacity-80" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: statusColor }}
              aria-label={form.status}
            />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {form.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                Created {new Date(form.created_at).toLocaleDateString()} · Status:{" "}
                <span className="capitalize">{form.status}</span>
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={deleteForm}
            disabled={deleting}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {/* Edit form details */}
      <section className="rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Form details</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Edit the name and description.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={saving}
              placeholder="What is this form for?"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveForm} variant="memphis-coral" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </section>

      {/* Fields list */}
      <section className="rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold">Fields</h2>
            <p className="text-xs text-muted-foreground">
              {fields.length} field{fields.length === 1 ? "" : "s"} in this form.
            </p>
          </div>
        </div>

        {fields.length === 0 ? (
          <EmptyState
            title="No fields in this form"
            description="Fields added during form creation appear here. Full field management is coming in Phase 2."
            icon={<FileText className="h-6 w-6" />}
          />
        ) : (
          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li
                key={f.id}
                className="grid grid-cols-12 items-center gap-2 rounded-lg border border-foreground/10 bg-background p-3"
              >
                <span className="col-span-1 font-display text-xs text-muted-foreground">
                  #{i + 1}
                </span>
                <div className="col-span-12 sm:col-span-5">
                  <p className="font-semibold text-sm">{f.label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{f.field_key}</p>
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    {f.field_type}
                  </span>
                </div>
                <div className="col-span-5 sm:col-span-2 text-xs text-muted-foreground">
                  {f.is_required ? "Required" : "Optional"}
                </div>
                <div className="col-span-1 text-right">
                  {f.is_required && (
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-[color:var(--memphis-coral)]"
                      aria-label="Required"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 rounded-lg border border-dashed border-foreground/15 bg-background/50 p-3 text-xs text-muted-foreground">
          <GeometricTriangle color="violet" size={12} className="absolute opacity-50" />
          <p>
            <strong className="text-foreground">Phase 2 preview:</strong> The full
            drag-and-drop field builder — reordering, conditional logic, validation
            rules, and per-field configuration — lands in the next phase. The
            underlying schema is already in place to support it.
          </p>
        </div>
      </section>
    </div>
  );
}
