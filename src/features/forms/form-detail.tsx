"use client";

/**
 * FormNull — Form Builder (Phase 2)
 * =====================================================================
 * The manual form builder. THE SOURCE OF TRUTH for form structure.
 *
 * Real Supabase persistence:
 *   - Form load:      SELECT forms + form_fields (sorted by sort_order)
 *   - Form save:      UPDATE forms (name, description)
 *   - Form delete:    DELETE forms (cascades fields + submissions via FK)
 *   - Add field:      INSERT form_fields (immediate, sort_order = max+1)
 *   - Edit field:     UPDATE form_fields (explicit Save per field)
 *   - Delete field:   DELETE form_fields (cascades submission_values via FK)
 *   - Reorder:        UPDATE sort_order for CHANGED rows only, once per
 *                     drop / button press (no writes during dragging)
 *
 * No fake success: every mutation awaits the real Supabase response and
 * only updates UI state after the database confirms. Failures surface
 * real errors and preserve unsaved local work.
 *
 * RLS: all queries run as the authenticated user — readers must be
 * workspace members, writers editors+. An unauthorized form id simply
 * returns no row ("Form not found").
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import type { Database, FieldType } from "@/lib/supabase/types";
import {
  ArrowLeft,
  Trash2,
  FileText,
  ChevronUp,
  ChevronDown,
  Pencil,
  GripVertical,
  ChevronDown as ChevronIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TYPES_BY_GROUP, fieldLabel, defaultConfigForType } from "./field-types";
import { FieldEditor } from "./field-editor";
import { useAuth } from "@/features/auth/auth-provider";

type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormField = Database["public"]["Tables"]["form_fields"]["Row"];

/* ------------------------------------------------------------------ */
/* field_key generation — unique per form                              */
/* ------------------------------------------------------------------ */

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "field"
  );
}

function uniqueKey(label: string, existing: string[]): string {
  const base = slugify(label);
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/* ------------------------------------------------------------------ */
/* FormDetail (builder)                                                */
/* ------------------------------------------------------------------ */

export function FormDetail({ formId }: { formId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [form, setForm] = useState<FormRow | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form-level editing
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [savingForm, setSavingForm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Field-level editing
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [addingField, setAddingField] = useState<string | null>(null);
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const fieldIds = useMemo(() => fields.map((f) => f.id), [fields]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
        setLoadError("Form not found, or you don't have access to it.");
        setLoading(false);
        return;
      }
      setForm(formRes.data);
      setName(formRes.data.name);
      setDescription(formRes.data.description ?? "");

      if (fieldsRes.error) throw fieldsRes.error;
      setFields((fieldsRes.data as FormField[]) ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load form.";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------- Form-level mutations ---------------- */

  async function saveForm() {
    if (!form) return;
    if (!name.trim()) {
      toast.error("Form name cannot be empty.");
      return;
    }
    // updated_by must be the AUTHENTICATED current user — never a
    // fabricated or inherited id (previously this wrote created_by,
    // which misattributes edits when a workspace admin saves the form).
    if (!user) {
      toast.error("Your session has expired. Please sign in again.");
      return;
    }
    setSavingForm(true);
    const { error } = await supabaseBrowser
      .from("forms")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        updated_by: user.id,
      })
      .eq("id", form.id);
    setSavingForm(false);
    if (error) {
      toast.error("Could not save form.", { description: error.message });
      return;
    }
    toast.success("Form updated.");
    setForm({
      ...form,
      name: name.trim(),
      description: description.trim() || null,
      updated_by: user.id,
    });
  }

  async function deleteForm() {
    if (!form) return;
    if (!confirm(`Delete "${form.name}"? All fields and submissions will be permanently removed. This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    const { error } = await supabaseBrowser.from("forms").delete().eq("id", form.id);
    setDeleting(false);
    if (error) {
      toast.error("Could not delete form.", { description: error.message });
      return;
    }
    toast.success("Form deleted.");
    router.push("/dashboard/forms/");
    router.refresh();
  }

  /* ---------------- Field mutations ---------------- */

  async function addField(type: FieldType) {
    if (!form) return;
    const meta = { type, label: fieldLabel(type) };
    setAddingField(type);
    try {
      const existingKeys = fields.map((f) => f.field_key);
      const key = uniqueKey(meta.label, existingKeys);
      const nextOrder = fields.length > 0 ? Math.max(...fields.map((f) => f.sort_order)) + 1 : 0;

      // Type-appropriate default config from the CENTRALIZED registry
      // (selects start with valid options, ratings with max=5).
      const defaultConfig = defaultConfigForType(type);

      const { data, error } = await supabaseBrowser
        .from("form_fields")
        .insert({
          form_id: form.id,
          field_key: key,
          field_type: type,
          label: meta.label,
          is_required: false,
          sort_order: nextOrder,
          width: 12,
          config: defaultConfig,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error("Field creation returned no row.");

      // Real row confirmed by the database — now update the UI.
      setFields((prev) => [...prev, data as FormField]);
      setEditingFieldId(data.id);
      toast.success(`${meta.label} field added.`);
    } catch (e) {
      toast.error("Could not add field.", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setAddingField(null);
    }
  }

  async function saveField(
    fieldId: string,
    draft: {
      label: string;
      description: string | null;
      placeholder: string | null;
      help_text: string | null;
      is_required: boolean;
      width: number;
      config: Record<string, unknown>;
    },
  ): Promise<boolean> {
    setSavingFieldId(fieldId);
    const { error } = await supabaseBrowser
      .from("form_fields")
      .update({
        label: draft.label,
        description: draft.description,
        placeholder: draft.placeholder,
        help_text: draft.help_text,
        is_required: draft.is_required,
        width: draft.width,
        config: draft.config,
      })
      .eq("id", fieldId);
    setSavingFieldId(null);
    if (error) {
      toast.error("Could not save field.", { description: error.message });
      return false;
    }
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...draft } : f)));
    toast.success("Field saved.");
    setEditingFieldId(null);
    return true;
  }

  async function deleteField(field: FormField) {
    if (
      !confirm(
        `Delete field "${field.label}"? Answers already collected for this field will also be removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingFieldId(field.id);
    const { error } = await supabaseBrowser.from("form_fields").delete().eq("id", field.id);
    setDeletingFieldId(null);
    if (error) {
      toast.error("Could not delete field.", { description: error.message });
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== field.id));
    if (editingFieldId === field.id) setEditingFieldId(null);
    toast.success("Field deleted.");
  }

  /**
   * Persist a new field order. Only rows whose sort_order actually changed
   * are written (typically 1–3 rows per move) — one batch of updates AFTER
   * the drop, never during dragging.
   */
  async function persistOrder(nextFields: FormField[], previousFields: FormField[]) {
    setReorderError(null);
    setFields(nextFields);

    const updates: { id: string; sort_order: number }[] = [];
    nextFields.forEach((f, idx) => {
      if (previousFields.find((p) => p.id === f.id)?.sort_order !== idx) {
        updates.push({ id: f.id, sort_order: idx });
      }
    });
    if (updates.length === 0) return;

    try {
      // Fire the (typically 1–3) row updates as ONE parallel batch —
      // every row is disjoint, so ordering between them is irrelevant.
      // Previously these were sequential awaits: N network round-trips.
      // NOTE: this is still N separate UPDATE statements, not one
      // transaction — a mid-batch failure can leave a partial order in
      // the DB. True atomicity would require a reorder RPC (new function
      // via a future migration); that is intentionally NOT invented here.
      // Instead, on failure we best-effort restore the previous order.
      const results = await Promise.all(
        updates.map((u) =>
          supabaseBrowser
            .from("form_fields")
            .update({ sort_order: u.sort_order })
            .eq("id", u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
      toast.success("Field order saved.");
    } catch (e) {
      // Best-effort rollback: write the previous sort_orders back so the
      // database matches the restored UI below. Rollback errors are
      // logged but never mask the original failure.
      try {
        await Promise.all(
          previousFields.map((p) =>
            supabaseBrowser
              .from("form_fields")
              .update({ sort_order: p.sort_order })
              .eq("id", p.id),
          ),
        );
      } catch (rollbackErr) {
        console.warn("[builder] order rollback failed:", rollbackErr);
      }
      setFields(previousFields);
      setReorderError(
        "Could not save the new order. Reverted to the last saved order.",
      );
      toast.error("Could not save field order.", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  }

  /* ---------------- Drag and drop ---------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(fields, oldIndex, newIndex);
    void persistOrder(next, fields);
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.id === fieldId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= fields.length) return;
    const next = arrayMove(fields, index, target);
    void persistOrder(next, fields);
  }

  /* ---------------- Render ---------------- */

  if (loading) return <LoadingState title="Loading form…" />;
  if (loadError) return <ErrorState title="Couldn't load form" description={loadError} />;
  if (!form) {
    return (
      <EmptyState
        title="Form not found"
        description="This form may have been deleted, or you don't have access."
        icon={<FileText className="h-7 w-7" />}
        action={{ label: "Back to forms", href: "/dashboard/forms/" }}
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
          href="/dashboard/forms/"
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
                <span className="capitalize">{form.status}</span> ·{" "}
                {fields.length} field{fields.length === 1 ? "" : "s"}
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
            {deleting ? "Deleting…" : "Delete form"}
          </Button>
        </div>
      </div>

      {/* Edit form details */}
      <section className="rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Form details</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Edit the name and description. Saved directly to the database.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={savingForm}
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
              disabled={savingForm}
              placeholder="What is this form for?"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveForm} variant="memphis-coral" disabled={savingForm}>
            {savingForm ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </section>

      {/* Builder */}
      <section className="rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-display text-lg font-bold">Fields</h2>
          <p className="text-xs text-muted-foreground">
            Add, edit, reorder and delete fields. Every change is saved to
            Supabase — drag to reorder, or use the arrow buttons.
          </p>
        </div>

        {reorderError && (
          <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
            {reorderError}
          </p>
        )}

        {fields.length === 0 ? (
          <EmptyState
            title="No fields yet"
            description="Add your first field below. Fields are stored as normalized rows — add, edit, reorder and delete are all real database operations."
            icon={<FileText className="h-6 w-6" />}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {fields.map((field, index) => (
                  <SortableFieldRow
                    key={field.id}
                    field={field}
                    index={index}
                    total={fields.length}
                    editing={editingFieldId === field.id}
                    saving={savingFieldId === field.id}
                    deleting={deletingFieldId === field.id}
                    disabled={editingFieldId !== null || deletingFieldId !== null}
                    onEdit={() =>
                      setEditingFieldId(editingFieldId === field.id ? null : field.id)
                    }
                    onSave={(draft) => saveField(field.id, draft)}
                    onCancel={() => setEditingFieldId(null)}
                    onDelete={() => deleteField(field)}
                    onMove={(dir) => moveField(field.id, dir)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {/* Add field palette */}
        <div className="mt-6 space-y-3 border-t border-foreground/10 pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Add a field
          </p>
          {(
            [
              ["Basic", FIELD_TYPES_BY_GROUP.basic],
              ["Choice", FIELD_TYPES_BY_GROUP.choice],
              ["Advanced", FIELD_TYPES_BY_GROUP.advanced],
            ] as const
          ).map(([groupName, group]) => (
            <div key={groupName}>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground/80">
                {groupName}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => addField(t.value)}
                    disabled={addingField !== null || editingFieldId !== null}
                    className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-foreground/30 hover:bg-accent/10 disabled:opacity-50"
                    aria-label={`Add ${t.label} field`}
                  >
                    <span className="font-bold text-[color:var(--memphis-coral)]">
                      {t.icon}
                    </span>
                    {t.label}
                    {addingField === t.value && (
                      <span className="text-muted-foreground">…</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-foreground/15 bg-background/50 p-3 text-xs text-muted-foreground">
          <GeometricTriangle color="violet" size={12} className="relative -top-2 opacity-50" />
          <p>
            <strong className="text-foreground">Note:</strong> publishing with
            immutable version snapshots and the public share link arrive in a
            later phase. The structure you build here is the source of truth
            the future AI builder will use too.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SortableFieldRow                                                    */
/* ------------------------------------------------------------------ */

function SortableFieldRow({
  field,
  index,
  total,
  editing,
  saving,
  deleting,
  disabled,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onMove,
}: {
  field: FormField;
  index: number;
  total: number;
  editing: boolean;
  saving: boolean;
  deleting: boolean;
  disabled: boolean;
  onEdit: () => void;
  onSave: (draft: {
    label: string;
    description: string | null;
    placeholder: string | null;
    help_text: string | null;
    is_required: boolean;
    width: number;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  onCancel: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-foreground/10 bg-background",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 p-3 sm:flex-nowrap">
        {/* Drag handle */}
        <button
          type="button"
          className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-40"
          disabled={disabled}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${field.label} (drag or use arrow buttons)`}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Index + label + key */}
        <span className="w-6 shrink-0 font-display text-xs text-muted-foreground">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {field.label}
            {field.is_required && (
              <span
                className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[color:var(--memphis-coral)] align-middle"
                aria-label="Required"
              />
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {field.field_key}
          </p>
        </div>

        {/* Type badge */}
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
          {fieldLabel(field.field_type)}
        </span>

        {/* Width badge */}
        <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          w:{field.width}
        </span>

        {/* Move up/down — always available (mobile + keyboard friendly) */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0 || disabled}
            aria-label={`Move ${field.label} up`}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === total - 1 || disabled}
            aria-label={`Move ${field.label} down`}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        {/* Edit toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          disabled={deleting || (disabled && !editing)}
          aria-label={editing ? `Close editor for ${field.label}` : `Edit ${field.label}`}
          aria-expanded={editing}
        >
          {editing ? <ChevronIcon className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>

        {/* Delete */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={deleting || disabled}
          aria-label={`Delete ${field.label}`}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          {deleting ? "…" : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      {/* Expanded editor */}
      {editing && (
        <div className="px-3 pb-3">
          <FieldEditor
            field={field}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
          />
        </div>
      )}
    </li>
  );
}
