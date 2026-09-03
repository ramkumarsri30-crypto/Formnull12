"use client";

/**
 * FormNull — Form Builder (Phase 3)
 * =====================================================================
 * THE manual form builder — the product's core surface. Professional
 * 3-pane layout, Memphis-designed:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ toolbar: back · status · name · save-state · preview ·     │
 *   │          publish · share · more                            │
 *   ├───────────┬───────────────────────────┬────────────────────┤
 *   │ field     │ live form canvas          │ properties         │
 *   │ library   │ (what respondents see)    │ (form / field)     │
 *   └───────────┴───────────────────────────┴────────────────────┘
 *
 * Tablet/mobile (< lg): canvas full-width; the field library and the
 * properties panel become Sheets. Nothing is unreachable.
 *
 * Real Supabase persistence (unchanged contracts from Phase 2A):
 *   - Form load:      SELECT forms + form_fields (sorted by sort_order)
 *   - Form save:      UPDATE forms (name, description, settings)
 *   - Form delete:    DELETE forms (cascades fields + submissions)
 *   - Add field:      INSERT form_fields (immediate, sort_order = max+1)
 *   - Edit field:     UPDATE form_fields (explicit Save per field)
 *   - Duplicate:      INSERT form_fields (config copy, unique key)
 *   - Delete field:   DELETE form_fields (006 keeps collected answers:
 *                     submission_values.field_id → ON DELETE SET NULL)
 *   - Reorder:        UPDATE sort_order for changed rows only, once
 *                     per drop / button press, with rollback.
 *   - Publish:        RPC publish_form (migration 006 — immutable
 *                     version snapshot + public link flip).
 *
 * No fake success: every mutation awaits the real Supabase response
 * and only updates UI state after the database confirms. Failures
 * surface real errors and preserve unsaved local work — selection
 * changes and unload are guarded while edits are pending.
 *
 * RLS: all queries run as the authenticated user — readers must be
 * workspace members, writers editors+. An unauthorized form id simply
 * returns no row ("Form not found"). publish_form re-checks editor
 * rights server-side (SECURITY DEFINER) — the button being visible
 * is never the permission boundary.
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GeometricCircle, GeometricTriangle } from "@/components/memphis/memphis-decorations";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { useMediaQuery } from "@/hooks/use-mobile";
import {
  ArrowLeft,
  Trash2,
  FileText,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Copy,
  Eye,
  Rocket,
  Share2,
  MoreHorizontal,
  Plus,
  X,
  TriangleAlert,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fieldMeta,
  fieldLabel,
  defaultConfigForType,
  MAX_FIELDS_PER_FORM,
  FIELD_LIMIT_WARN_AT,
  type FieldType,
} from "./field-types";
import { FieldEditor } from "./field-editor";
import { FieldLibrary } from "./field-library";
import { FieldLabelBlock, FieldControl, toRenderableField } from "./form-renderer";
import { PreviewDialog } from "./preview-dialog";
import { PublishDialog, ShareDialog } from "./publish-dialog";
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

function uniqueKey(base: string, existing: string[]): string {
  const b = slugify(base);
  if (!existing.includes(b)) return b;
  let i = 2;
  while (existing.includes(`${b}_${i}`)) i += 1;
  return `${b}_${i}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "published":
      return "var(--memphis-mint)";
    case "paused":
      return "var(--memphis-sun)";
    case "archived":
      return "var(--muted-foreground)";
    default:
      return "var(--memphis-coral)";
  }
}

/* ------------------------------------------------------------------ */
/* FormDetail (builder)                                                */
/* ------------------------------------------------------------------ */

export function FormDetail({ formId }: { formId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [form, setForm] = useState<FormRow | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form-level editing (parent-held so panel switching never loses drafts)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitLabel, setSubmitLabel] = useState("");
  const [savingForm, setSavingForm] = useState(false);
  const [deletingForm, setDeletingForm] = useState(false);

  // Field-level editing
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [addingField, setAddingField] = useState<FieldType | null>(null);
  const [duplicatingFieldId, setDuplicatingFieldId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Dialogs / sheets
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteFormOpen, setDeleteFormOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<FormField | null>(null);
  const [deleteFieldBusy, setDeleteFieldBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null | "cancel">(null);
  const [librarySheetOpen, setLibrarySheetOpen] = useState(false);
  const [propsSheetOpen, setPropsSheetOpen] = useState(false);

  const fieldIds = useMemo(() => fields.map((f) => f.id), [fields]);
  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );
  const savedSubmitLabel =
    typeof form?.settings?.submit_button_label === "string"
      ? (form.settings.submit_button_label as string)
      : "";
  const formDetailsDirty =
    form !== null &&
    (name !== form.name ||
      (description || "") !== (form.description ?? "") ||
      submitLabel !== savedSubmitLabel);
  const hasFileUpload = fields.some((f) => f.field_type === "file_upload");

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
      setSubmitLabel(
        typeof formRes.data.settings?.submit_button_label === "string"
          ? (formRes.data.settings.submit_button_label as string)
          : "",
      );

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

  /* ------------ Unload guard — no silent data loss ------------ */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (formDetailsDirty || editorDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formDetailsDirty, editorDirty]);

  /* ---------------- Selection (with dirty guard) ---------------- */

  function selectField(id: string | null) {
    if (editorDirty && id !== selectedFieldId) {
      setPendingSelection(id);
      setDiscardOpen(true);
      return;
    }
    setSelectedFieldId(id);
    if (id !== null && !isDesktop) setPropsSheetOpen(true);
  }

  function closeProperties() {
    if (editorDirty) {
      setPendingSelection("cancel");
      setDiscardOpen(true);
      return;
    }
    setSelectedFieldId(null);
    setPropsSheetOpen(false);
  }

  function confirmDiscard() {
    setEditorDirty(false);
    if (pendingSelection === "cancel" || pendingSelection === null) {
      setSelectedFieldId(null);
      setPropsSheetOpen(false);
    } else {
      setSelectedFieldId(pendingSelection);
      if (!isDesktop) setPropsSheetOpen(true);
    }
    setPendingSelection(null);
    setDiscardOpen(false);
  }

  /* ---------------- Form-level mutations ---------------- */

  async function saveForm() {
    if (!form) return;
    if (!name.trim()) {
      toast.error("Form name cannot be empty.");
      return;
    }
    if (!user) {
      toast.error("Your session has expired. Please sign in again.");
      return;
    }
    setSavingForm(true);
    const nextSettings: Record<string, unknown> = { ...(form.settings ?? {}) };
    const trimmedLabel = submitLabel.trim().slice(0, 40);
    if (trimmedLabel) nextSettings.submit_button_label = trimmedLabel;
    else delete nextSettings.submit_button_label;

    const { error } = await supabaseBrowser
      .from("forms")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        settings: nextSettings,
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
      settings: nextSettings,
      updated_by: user.id,
    });
  }

  async function deleteForm() {
    if (!form) return;
    setDeletingForm(true);
    const { error } = await supabaseBrowser.from("forms").delete().eq("id", form.id);
    setDeletingForm(false);
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
    if (fields.length >= MAX_FIELDS_PER_FORM) {
      toast.error("Field limit reached.", {
        description: `A form supports at most ${MAX_FIELDS_PER_FORM} fields (matching the publish limit).`,
      });
      return;
    }
    const meta = { type, label: fieldLabel(type) };
    setAddingField(type);
    try {
      const existingKeys = fields.map((f) => f.field_key);
      const key = uniqueKey(meta.label, existingKeys);
      const nextOrder =
        fields.length > 0 ? Math.max(...fields.map((f) => f.sort_order)) + 1 : 0;

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
      selectField(data.id);
      if (!isDesktop) setLibrarySheetOpen(false);
      toast.success(`${meta.label} field added.`);
      // Bring the new card into view (data-attr lookup — no ref plumbing).
      window.requestAnimationFrame(() => {
        document
          .querySelector(`[data-field-id="${data.id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
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
    return true;
  }

  async function duplicateField(field: FormField) {
    if (!form) return;
    if (fields.length >= MAX_FIELDS_PER_FORM) {
      toast.error("Field limit reached.", {
        description: `A form supports at most ${MAX_FIELDS_PER_FORM} fields.`,
      });
      return;
    }
    setDuplicatingFieldId(field.id);
    try {
      const existingKeys = fields.map((f) => f.field_key);
      const key = uniqueKey(field.field_key, existingKeys);
      const nextOrder =
        fields.length > 0 ? Math.max(...fields.map((f) => f.sort_order)) + 1 : 0;

      const { data, error } = await supabaseBrowser
        .from("form_fields")
        .insert({
          form_id: form.id,
          field_key: key,
          field_type: field.field_type,
          label: `${field.label} (copy)`,
          description: field.description,
          placeholder: field.placeholder,
          help_text: field.help_text,
          is_required: field.is_required,
          width: field.width,
          sort_order: nextOrder,
          config: { ...(field.config ?? {}) },
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error("Duplication returned no row.");

      setFields((prev) => [...prev, data as FormField]);
      selectField(data.id);
      toast.success("Field duplicated.");
      window.requestAnimationFrame(() => {
        document
          .querySelector(`[data-field-id="${data.id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } catch (e) {
      toast.error("Could not duplicate field.", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setDuplicatingFieldId(null);
    }
  }

  async function deleteField(target: FormField) {
    setDeleteFieldBusy(true);
    const { error } = await supabaseBrowser
      .from("form_fields")
      .delete()
      .eq("id", target.id);
    setDeleteFieldBusy(false);
    if (error) {
      toast.error("Could not delete field.", { description: error.message });
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== target.id));
    if (selectedFieldId === target.id) {
      setSelectedFieldId(null);
      setPropsSheetOpen(false);
      setEditorDirty(false);
    }
    toast.success("Field deleted.");
    setDeleteFieldTarget(null);
  }

  /**
   * Persist a new field order. Only rows whose sort_order actually changed
   * are written (typically 1–3 rows per move) — one batch of updates AFTER
   * the drop, never during dragging. On failure: best-effort rollback of
   * the previous order (documented limitation: not a single transaction).
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
    } catch (e) {
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

  const busyAny =
    savingForm || deletingForm || addingField !== null || deleteFieldBusy;

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selectedFieldId && e.target === e.currentTarget) {
          closeProperties();
        }
      }}
    >
      {/* ================= Toolbar ================= */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-foreground/10 bg-surface p-2.5 sm:gap-3 sm:p-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to forms">
          <Link href="/dashboard/forms/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor(form.status) }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => selectField(null)}
            className="min-w-0 truncate text-left font-display text-base font-bold tracking-tight sm:text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1"
            aria-label={`Form name: ${form.name}. Edit form settings`}
            title="Edit form settings"
          >
            {form.name}
          </button>
          {form.status === "published" && form.published_version != null && (
            <span className="hidden shrink-0 rounded-md bg-[color:var(--memphis-mint)]/15 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--memphis-mint)] sm:inline">
              v{form.published_version}
            </span>
          )}
        </div>

        {/* Save state chip */}
        <SaveStateChip
          saving={savingForm || savingFieldId !== null}
          formDirty={formDetailsDirty}
          editorDirty={editorDirty}
        />

        {/* Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={busyAny}
            aria-label="Preview form"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">Preview</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShareOpen(true)}
            disabled={busyAny}
            aria-label="Share form link"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
          <Button
            variant="memphis-coral"
            size="sm"
            onClick={() => setPublishOpen(true)}
            disabled={busyAny}
            aria-label={form.status === "published" ? "Publish a new version" : "Publish form"}
          >
            <Rocket className="h-4 w-4" />
            <span className="hidden sm:inline">
              {form.status === "published" ? "Republish" : "Publish"}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={busyAny}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setDeleteFormOpen(true)}
                className="gap-2 text-destructive focus:text-destructive"
                disabled={deletingForm}
              >
                <Trash2 className="h-4 w-4" />
                Delete form
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile: open field library */}
        <Button
          variant="outline"
          size="sm"
          className="w-full lg:hidden"
          onClick={() => setLibrarySheetOpen(true)}
          disabled={busyAny}
          aria-label="Open field library to add a field"
        >
          <Plus className="h-4 w-4" />
          Add field
        </Button>
      </div>

      {/* ================= 3-pane workspace ================= */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:h-[calc(100vh-9rem)]">
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          {/* ── Left: field library (lg+) ── */}
          <aside
            className="hidden w-52 shrink-0 flex-col overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface lg:flex xl:w-56"
            aria-label="Field library"
          >
            <div className="border-b border-foreground/10 px-3 py-2.5">
              <p className="font-display text-sm font-bold">Add fields</p>
              <p className="text-[11px] text-muted-foreground">
                Click to append to the form
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <FieldLibrary
                onAdd={addField}
                disabled={addingField !== null || deletingForm || savingForm}
                fieldCount={fields.length}
              />
            </div>
          </aside>

          {/* ── Center: live canvas ── */}
          <main
            className="min-w-0 flex-1 overflow-y-auto rounded-2xl border-2 border-foreground/10 bg-[color:var(--surface)]/60 p-3 sm:p-4 lg:p-5"
            aria-label="Form canvas"
          >
            <div className="mx-auto w-full max-w-2xl">
              {/* Respondent-view header (read-only preview of form intro) */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
                <GeometricCircle color="coral" size={32} className="-top-3 -right-3 opacity-70" />
                <div className="relative">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Eye className="h-3 w-3" aria-hidden />
                    Respondent view
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                    {form.name}
                  </h2>
                  {form.description && (
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {form.description}
                    </p>
                  )}
                  <p className="mt-2.5 text-xs text-muted-foreground/80">
                    {fields.length} field{fields.length === 1 ? "" : "s"}
                    {submitLabel.trim() ? ` · button “${submitLabel.trim()}”` : ""}
                  </p>
                </div>
              </div>

              {/* Field limit warning */}
              {fields.length >= FIELD_LIMIT_WARN_AT && (
                <div
                  role="status"
                  className={cn(
                    "mt-3 flex items-start gap-2 rounded-xl border-2 p-3 text-xs font-medium",
                    fields.length >= MAX_FIELDS_PER_FORM
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-[color:var(--memphis-sun)]/40 bg-[color:var(--memphis-sun)]/10 text-[color:var(--memphis-sun)]",
                  )}
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {fields.length >= MAX_FIELDS_PER_FORM
                      ? `Field limit reached (${fields.length}/${MAX_FIELDS_PER_FORM}) — remove fields to add more.`
                      : `Approaching the field limit (${fields.length}/${MAX_FIELDS_PER_FORM}).`}
                  </span>
                </div>
              )}

              {reorderError && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-destructive/10 p-2.5 text-xs font-medium text-destructive"
                >
                  {reorderError}
                </p>
              )}

              {/* Field cards */}
              {fields.length === 0 ? (
                <div className="mt-4 rounded-2xl border-2 border-dashed border-foreground/20 p-8 text-center">
                  <GeometricTriangle
                    color="violet"
                    size={20}
                    rotate={-12}
                    className="relative mx-auto mb-3 opacity-60"
                  />
                  <p className="font-display text-base font-bold">No fields yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Add your first field from the library{isDesktop ? " on the left" : ""}. Every
                    field is stored as a normalized database row — no mock data.
                  </p>
                  <Button
                    variant="memphis-outline"
                    size="sm"
                    className="mt-4 lg:hidden"
                    onClick={() => setLibrarySheetOpen(true)}
                    aria-label="Add your first field"
                  >
                    <Plus className="h-4 w-4" />
                    Add field
                  </Button>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
                    <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-12 sm:gap-x-4">
                      {fields.map((field, index) => (
                        <CanvasFieldCard
                          key={field.id}
                          field={field}
                          index={index}
                          total={fields.length}
                          selected={selectedFieldId === field.id}
                          busy={
                            addingField !== null ||
                            deleteFieldBusy ||
                            deletingForm ||
                            savingForm
                          }
                          saving={savingFieldId === field.id}
                          duplicating={duplicatingFieldId === field.id}
                          onSelect={() =>
                            selectField(selectedFieldId === field.id ? null : field.id)
                          }
                          onMove={(dir) => moveField(field.id, dir)}
                          onDuplicate={() => duplicateField(field)}
                          onDelete={() => setDeleteFieldTarget(field)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}

              {/* Canvas footer: add field (mobile) */}
              {fields.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full border-dashed lg:hidden"
                  onClick={() => setLibrarySheetOpen(true)}
                  disabled={busyAny}
                  aria-label="Add another field"
                >
                  <Plus className="h-4 w-4" />
                  Add field
                </Button>
              )}
            </div>
          </main>

          {/* ── Right: properties (lg+) ── */}
          <aside
            className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface lg:flex xl:w-96"
            aria-label="Properties"
          >
            <PropertiesPanel
              form={form}
              fields={fields}
              selectedField={selectedField}
              savingForm={savingForm}
              savingField={savingFieldId === selectedField?.id}
              editorDirty={editorDirty}
              name={name}
              description={description}
              submitLabel={submitLabel}
              onName={setName}
              onDescription={setDescription}
              onSubmitLabel={setSubmitLabel}
              onSaveForm={saveForm}
              formDetailsDirty={formDetailsDirty}
              onOpenShare={() => setShareOpen(true)}
              onSelectField={(id) => selectField(id)}
              onClose={closeProperties}
              onEditorDirty={setEditorDirty}
              onSaveField={saveField}
            />
          </aside>
        </div>
      </div>

      {/* ================= Tablet/mobile Sheets ================= */}

      {/* Field library sheet */}
      {!isDesktop && (
        <Sheet open={librarySheetOpen} onOpenChange={setLibrarySheetOpen}>
          <SheetContent
            side="left"
            className="flex w-80 max-w-[92vw] flex-col gap-0 p-0 sm:max-w-md"
          >
            <SheetHeader className="border-b border-foreground/10 px-4 py-3">
              <SheetTitle className="text-left">Add a field</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1">
              <FieldLibrary
                onAdd={addField}
                disabled={addingField !== null}
                fieldCount={fields.length}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Properties sheet */}
      {!isDesktop && (
        <Sheet
          open={propsSheetOpen && selectedField !== null}
          onOpenChange={(o) => {
            if (!o) closeProperties();
          }}
        >
          <SheetContent
            side="right"
            className="flex w-[85vw] max-w-md flex-col gap-0 overflow-y-auto p-0 sm:w-96"
          >
            <SheetHeader className="sticky top-0 z-10 border-b border-foreground/10 bg-surface px-4 py-3">
              <SheetTitle className="flex items-center justify-between text-left">
                Field properties
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={closeProperties}
                  aria-label="Close field properties"
                >
                  <X className="h-4 w-4" />
                </Button>
              </SheetTitle>
            </SheetHeader>
            <div className="p-4">
              {selectedField && (
                <FieldEditor
                  key={selectedField.id}
                  field={selectedField}
                  saving={savingFieldId === selectedField.id}
                  onSave={(draft) => saveField(selectedField.id, draft)}
                  onCancel={closeProperties}
                  onDirtyChange={setEditorDirty}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* ================= Dialogs ================= */}

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        form={{
          name: form.name,
          description: form.description,
          settings: (form.settings ?? {}) as Record<string, unknown>,
        }}
        fields={fields.map(toRenderableField)}
      />

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        formId={form.id}
        formName={form.name}
        fieldCount={fields.length}
        hasFileUpload={hasFileUpload}
        onPublished={({ version }) => {
          setForm((prev) =>
            prev ? { ...prev, status: "published", published_version: version } : prev,
          );
        }}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        publicKey={form.public_key}
        version={form.published_version}
        status={form.status}
      />

      {/* Delete form */}
      <AlertDialog open={deleteFormOpen} onOpenChange={setDeleteFormOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{form.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The form, its fields, and every collected response will be permanently
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingForm}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void deleteForm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingForm ? "Deleting…" : "Delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete field */}
      <AlertDialog
        open={deleteFieldTarget !== null}
        onOpenChange={(o) => {
          if (!o && !deleteFieldBusy) setDeleteFieldTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete field “{deleteFieldTarget?.label}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The field is removed from the form immediately. Answers already collected
              for it are preserved in existing submissions. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFieldBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteFieldTarget) void deleteField(deleteFieldTarget);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteFieldBusy ? "Deleting…" : "Delete field"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard unsaved field edits */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved edits?</AlertDialogTitle>
            <AlertDialogDescription>
              This field has changes that were never saved to the database. Discarding
              them cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Save state chip                                                      */
/* ------------------------------------------------------------------ */

function SaveStateChip({
  saving,
  formDirty,
  editorDirty,
}: {
  saving: boolean;
  formDirty: boolean;
  editorDirty: boolean;
}) {
  let label: string;
  let cls: string;
  let icon = <Check className="h-3 w-3" aria-hidden />;
  if (saving) {
    label = "Saving…";
    cls = "bg-[color:var(--memphis-sun)]/15 text-[color:var(--memphis-sun)]";
    icon = <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  } else if (editorDirty) {
    label = "Unsaved field edits";
    cls = "bg-[color:var(--memphis-coral)]/12 text-[color:var(--memphis-coral)]";
    icon = <TriangleAlert className="h-3 w-3" aria-hidden />;
  } else if (formDirty) {
    label = "Unsaved changes";
    cls = "bg-[color:var(--memphis-coral)]/12 text-[color:var(--memphis-coral)]";
    icon = <TriangleAlert className="h-3 w-3" aria-hidden />;
  } else {
    label = "All changes saved";
    cls = "bg-[color:var(--memphis-mint)]/15 text-[color:var(--memphis-mint)]";
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold md:inline-flex",
        cls,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Properties panel (desktop right pane)                                */
/* ------------------------------------------------------------------ */

function PropertiesPanel({
  form,
  fields,
  selectedField,
  savingForm,
  savingField,
  editorDirty,
  name,
  description,
  submitLabel,
  onName,
  onDescription,
  onSubmitLabel,
  onSaveForm,
  formDetailsDirty,
  onOpenShare,
  onSelectField,
  onClose,
  onEditorDirty,
  onSaveField,
}: {
  form: FormRow;
  fields: FormField[];
  selectedField: FormField | null;
  savingForm: boolean;
  savingField: boolean;
  editorDirty: boolean;
  name: string;
  description: string;
  submitLabel: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmitLabel: (v: string) => void;
  onSaveForm: () => void;
  formDetailsDirty: boolean;
  onOpenShare: () => void;
  onSelectField: (id: string | null) => void;
  onClose: () => void;
  onEditorDirty: (dirty: boolean) => void;
  onSaveField: (
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
  ) => Promise<boolean>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2.5">
        <p className="font-display text-sm font-bold">
          {selectedField ? "Field properties" : "Form settings"}
        </p>
        {selectedField && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close field properties"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selectedField ? (
          <FieldEditor
            key={selectedField.id}
            field={selectedField}
            saving={savingField}
            onSave={(draft) => onSaveField(selectedField.id, draft)}
            onCancel={onClose}
            onDirtyChange={onEditorDirty}
          />
        ) : (
          <FormSettingsView
            form={form}
            fields={fields}
            saving={savingForm}
            dirty={formDetailsDirty || editorDirty}
            name={name}
            description={description}
            submitLabel={submitLabel}
            onName={onName}
            onDescription={onDescription}
            onSubmitLabel={onSubmitLabel}
            onSave={onSaveForm}
            onOpenShare={onOpenShare}
            onSelectField={onSelectField}
          />
        )}
      </div>
    </div>
  );
}

function FormSettingsView({
  form,
  fields,
  saving,
  dirty,
  name,
  description,
  submitLabel,
  onName,
  onDescription,
  onSubmitLabel,
  onSave,
  onOpenShare,
  onSelectField,
}: {
  form: FormRow;
  fields: FormField[];
  saving: boolean;
  dirty: boolean;
  name: string;
  description: string;
  submitLabel: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmitLabel: (v: string) => void;
  onSave: () => void;
  onOpenShare: () => void;
  onSelectField: (id: string | null) => void;
}) {
  const statusLabel = (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: statusColor(form.status) }}
        aria-hidden
      />
      <span className="capitalize">{form.status}</span>
      {form.status === "published" && form.published_version != null && (
        <span className="text-muted-foreground">· v{form.published_version}</span>
      )}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Field list quick nav (form settings home) */}
      <div className="rounded-xl bg-background p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          {statusLabel}
        </div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fields
          </p>
          <p className="text-xs text-foreground">
            {fields.length} ·{" "}
            {fields.filter((f) => f.is_required).length} required
          </p>
        </div>
        {form.status !== "draft" && (
          <Button variant="outline" size="sm" className="w-full" onClick={onOpenShare}>
            <Share2 className="h-3.5 w-3.5" />
            Share link
          </Button>
        )}
      </div>

      {fields.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fields — click to edit
          </p>
          <ul className="space-y-1">
            {fields.map((f, i) => {
              const meta = fieldMeta(f.field_type);
              const Icon = meta?.icon;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelectField(f.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-transparent bg-background px-2.5 py-1.5 text-left text-sm transition-colors hover:border-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Edit field ${f.label}`}
                  >
                    <span className="w-4 shrink-0 text-[11px] text-muted-foreground">
                      {i + 1}
                    </span>
                    {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    {f.is_required && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--memphis-coral)]"
                        aria-label="required"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-4 border-t border-foreground/10 pt-4">
        <div className="space-y-2">
          <Label htmlFor="form-name">Name</Label>
          <Input
            id="form-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            disabled={saving}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="form-description">Description (optional)</Label>
          <Textarea
            id="form-description"
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            rows={3}
            disabled={saving}
            placeholder="Shown under the form title to respondents"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="form-submit-label">Submit button label</Label>
          <Input
            id="form-submit-label"
            value={submitLabel}
            onChange={(e) => onSubmitLabel(e.target.value)}
            disabled={saving}
            className="h-10"
            placeholder="Submit"
            maxLength={40}
          />
          <p className="text-[11px] text-muted-foreground">
            The button respondents press (defaults to “Submit”).
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground" role="status">
            {dirty ? "Unsaved changes" : "Saved to database"}
          </p>
          <Button variant="memphis-coral" size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CanvasFieldCard — selectable/draggable wrapper around the field      */
/* ------------------------------------------------------------------ */

function CanvasFieldCard({
  field,
  index,
  total,
  selected,
  busy,
  saving,
  duplicating,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  index: number;
  total: number;
  selected: boolean;
  busy: boolean;
  saving: boolean;
  duplicating: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const meta = fieldMeta(field.field_type);
  const rf = toRenderableField(field);
  const isSection = field.field_type === "section";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      data-field-id={field.id}
      style={{ ...style, "--field-w": field.width } as React.CSSProperties}
      className={cn("form-field-cell list-none", isDragging && "z-20")}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-pressed={selected}
        aria-label={`${selected ? "Close" : "Open"} properties for ${field.label} (${meta?.label ?? field.field_type})`}
        className={cn(
          "group relative cursor-pointer rounded-2xl border-2 p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSection
            ? "border-dashed border-foreground/25 bg-transparent hover:border-foreground/40"
            : "border-foreground/10 bg-surface hover:border-foreground/30",
          selected && "border-[color:var(--memphis-coral)] bg-surface shadow-[4px_4px_0_0_var(--memphis-ink)]",
          isDragging && "opacity-80 shadow-lg",
        )}
      >
        {/* Action toolbar — visible on hover / selection / focus-within */}
        <div
          className={cn(
            "absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-lg border-2 border-foreground/10 bg-surface px-1 py-0.5 transition-opacity",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          role="toolbar"
          aria-label={`Actions for ${field.label}`}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onMove(-1);
            }}
            disabled={index === 0 || busy}
            aria-label={`Move ${field.label} up`}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onMove(1);
            }}
            disabled={index === total - 1 || busy}
            aria-label={`Move ${field.label} down`}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            disabled={busy}
            aria-label={`Duplicate ${field.label}`}
          >
            {duplicating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={busy}
            aria-label={`Delete ${field.label}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Drag handle */}
        <button
          type="button"
          className={cn(
            "absolute -left-3 top-4 z-10 flex h-7 w-5 cursor-grab touch-none items-center justify-center rounded-md border-2 border-foreground/10 bg-surface text-muted-foreground/70 transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          disabled={busy}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${field.label} (drag, or use the up and down buttons)`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Selected-state badge: type + key */}
        <div
          className={cn(
            "mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-opacity",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {meta?.icon ? (
            <meta.icon className="h-3.5 w-3.5 text-[color:var(--memphis-coral)]" aria-hidden />
          ) : null}
          <span className="font-semibold">{meta?.label ?? field.field_type}</span>
          <span className="font-mono opacity-70">{field.field_key}</span>
          <span className="ml-auto opacity-70">#{index + 1}</span>
        </div>

        {/* The field exactly as respondents see it — visually exact,
            interaction-inert (pointer-events pass through to the card,
            so clicking an input selects the field) */}
        <div className="builder-inert">
          <FieldRendererForCanvas field={rf} selected={selected} saving={saving} />
        </div>
      </div>
    </li>
  );
}

/**
 * Canvas-side field rendering — composes the SHARED atoms
 * (FieldLabelBlock + FieldControl) so the canvas can never drift from
 * the preview/public rendering. Section fields render their divider
 * form. Inputs are inert (builder mode) — clicks select the card.
 */
function FieldRendererForCanvas({
  field,
  selected,
  saving,
}: {
  field: ReturnType<typeof toRenderableField>;
  selected: boolean;
  saving: boolean;
}) {
  const id = `canvas-${field.field_key}`;
  if (field.field_type === "section") {
    return (
      <div>
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block h-2.5 w-2.5 rotate-45 bg-[color:var(--memphis-coral)]"
            aria-hidden
          />
          <h3 className="font-display text-lg font-bold text-foreground">{field.label}</h3>
        </div>
        {field.description && (
          <p className="mt-1 text-sm text-muted-foreground">{field.description}</p>
        )}
        {field.help_text && (
          <p className="mt-0.5 text-xs text-muted-foreground/80">{field.help_text}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <FieldLabelBlock field={field} htmlFor={id} />
      <FieldControl
        field={field}
        value={undefined}
        onChange={() => {
          /* inert in builder mode — the card's click selects it */
        }}
        disabled={true}
        id={id}
      />
      {saving && (
        <p className="text-[11px] text-muted-foreground" role="status">
          Saving…
        </p>
      )}
      {selected && (
        <p className="text-[11px] font-medium text-[color:var(--memphis-coral)]">
          Editing — properties panel open
        </p>
      )}
    </div>
  );
}
