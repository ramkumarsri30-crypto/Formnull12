"use client";

/**
 * FormNull — Form Builder (Field System 2.0 shell)
 * =====================================================================
 * THE manual form builder — the product's core surface, rebuilt as a
 * FIXED-HEIGHT application:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ toolbar: back · status · name · save-state · preview · share │
 *   ├────────┬───────────────────────────────┬─────────────────────┤
 *   │ field  │ live form canvas              │ properties          │
 *   │ rail   │ (own scroll context)          │ (own scroll context)│
 *   └────────┴───────────────────────────────┴─────────────────────┘
 *
 * The three regions scroll INDEPENDENTLY — the page itself never
 * scrolls on desktop (the dashboard shell opts this route into a
 * full-bleed, overflow-hidden main; see dashboard-shell.tsx).
 *
 * Field library modes (desktop lg+):
 *   RAIL    (default) — 56px icon strip; hovering it (or opening
 *           search) expands the full library as an overlay panel that
 *           floats over the canvas; clicking any rail icon adds that
 *           field type with one click.
 *   PINNED  — the library becomes a fixed 240px pane (canvas reflows
 *           wider). The pin preference persists per browser.
 *
 * Tablet/mobile (< lg): canvas fills the workspace; the library and
 * the properties panel become Sheets. Nothing is unreachable.
 *
 * Real Supabase persistence (contracts unchanged since Phase 3):
 *   - Form load:      SELECT forms + form_fields (sorted by sort_order)
 *   - Form save:      UPDATE forms (name, description, settings)
 *   - Form delete:    DELETE forms (cascades fields + submissions)
 *   - Add field:      INSERT form_fields (immediate, sort_order = max+1)
 *   - Edit field:     UPDATE form_fields (explicit Save per field)
 *   - Duplicate:      INSERT form_fields (deep-copied config, unique key)
 *   - Delete field:   DELETE form_fields (006 keeps collected answers:
 *                     submission_values.field_id → ON DELETE SET NULL)
 *   - Reorder:        UPDATE sort_order for changed rows only, once
 *                     per drop / button press, with rollback.
 *   - Publish:        RPC publish_form (migration 006 — immutable
 *                     version snapshot + public link flip).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
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
  fieldDef,
  fieldDefSafe,
  libraryLabelFor,
  MAX_FIELDS_PER_FORM,
  FIELD_LIMIT_WARN_AT,
  LIBRARY_ENTRIES,
  libraryGroupsFor,
  blockedTypeLabelsFor,
  type FieldGroup,
  type LibraryEntry,
} from "./field-registry";
import { detectFieldCapabilities } from "./field-capabilities";
import { EmbedBlock } from "./form-renderer";
import { FieldPropertyEditor, type FieldDraft } from "./field-property-editor";
import { FieldLibrary } from "./field-library";
import { FieldLabelBlock, FieldControl, toRenderableField, type RenderableFormHeader } from "./form-renderer";
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

/** Deep-copy a JSON-safe config (duplicate isolation — never share
 *  object identity between the original and the copy). */
function cloneConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
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

const PIN_PREF_KEY = "formnull.builder.libraryPinned"; // retired — the library is now always expanded (owner directive)

/**
 * Draft-aware preview header settings — mirrors saveForm()'s conventions
 * (submit label + card mode + screens stored only when set) so the
 * preview shows the builder's CURRENT state, unsaved edits included.
 * Without this the preview would silently show the last-saved header
 * while the canvas respondent-view mixes saved and draft values.
 */
function previewSettingsFor(
  saved: Record<string, unknown> | null | undefined,
  draftSubmitLabel: string,
  draftMode: "standard" | "card",
  drafts: ScreenDrafts,
): Record<string, unknown> {
  const s: Record<string, unknown> = { ...(saved ?? {}) };
  const t = draftSubmitLabel.trim().slice(0, 40);
  if (t) s.submit_button_label = t;
  else delete s.submit_button_label;
  if (draftMode === "card") s.mode = "card";
  else delete s.mode;
  if (drafts.welcomeOn) {
    const w: Record<string, unknown> = { enabled: true };
    if (drafts.welcomeTitle.trim()) w.title = drafts.welcomeTitle.trim().slice(0, 200);
    if (drafts.welcomeDescription.trim()) w.description = drafts.welcomeDescription.trim().slice(0, 1000);
    if (drafts.welcomeButton.trim()) w.button_label = drafts.welcomeButton.trim().slice(0, 40);
    s.welcome = w;
  } else delete s.welcome;
  if (drafts.thankyouOn) {
    const tk: Record<string, unknown> = { enabled: true };
    if (drafts.thankyouTitle.trim()) tk.title = drafts.thankyouTitle.trim().slice(0, 200);
    if (drafts.thankyouDescription.trim()) tk.description = drafts.thankyouDescription.trim().slice(0, 1000);
    if (drafts.thankyouButton.trim()) tk.button_label = drafts.thankyouButton.trim().slice(0, 40);
    if (/^https:\/\//.test(drafts.thankyouLink.trim())) tk.link_url = drafts.thankyouLink.trim().slice(0, 2048);
    s.thankyou = tk;
  } else delete s.thankyou;
  return s;
}

/** Screen drafts bundle (welcome + thank-you). */
interface ScreenDraftSetters {
  setWelcomeOn: (v: boolean) => void;
  setWelcomeTitle: (v: string) => void;
  setWelcomeDescription: (v: string) => void;
  setWelcomeButton: (v: string) => void;
  setThankyouOn: (v: boolean) => void;
  setThankyouTitle: (v: string) => void;
  setThankyouDescription: (v: string) => void;
  setThankyouButton: (v: string) => void;
  setThankyouLink: (v: string) => void;
}

/** Screen drafts bundle (welcome + thank-you). */
interface ScreenDrafts {
  welcomeOn: boolean;
  welcomeTitle: string;
  welcomeDescription: string;
  welcomeButton: string;
  thankyouOn: boolean;
  thankyouTitle: string;
  thankyouDescription: string;
  thankyouButton: string;
  thankyouLink: string;
}

/** Read saved screen settings as plain drafts for dirty comparison. */
function readScreenDrafts(
  settings: Record<string, unknown> | null | undefined,
  which: "welcome" | "thankyou",
): { enabled?: boolean; title?: string; description?: string; button?: string; link?: string } {
  const o = settings?.[which];
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    title: typeof r.title === "string" ? r.title : undefined,
    description: typeof r.description === "string" ? r.description : undefined,
    button: typeof r.button_label === "string" ? r.button_label : undefined,
    link: typeof r.link_url === "string" ? r.link_url : undefined,
  };
}

/** Quick-start library entries offered in the empty canvas. */
const QUICK_START_ENTRIES: LibraryEntry[] = LIBRARY_ENTRIES.filter((e) =>
  ["short_text", "email", "single_select", "nps"].includes(e.key),
);

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
  /** Presentation mode — "card" shows one question at a time (preview +
   *  public). Stored in forms.settings, snapshotted by publish_form. */
  const [formMode, setFormMode] = useState<"standard" | "card">("standard");
  /** Welcome / thank-you screen drafts (settings.welcome / .thankyou —
   *  presentation-only, flow through the publish snapshot wholesale). */
  const [welcomeOn, setWelcomeOn] = useState(false);
  const [welcomeTitle, setWelcomeTitle] = useState("");
  const [welcomeDescription, setWelcomeDescription] = useState("");
  const [welcomeButton, setWelcomeButton] = useState("");
  const [thankyouOn, setThankyouOn] = useState(false);
  const [thankyouTitle, setThankyouTitle] = useState("");
  const [thankyouDescription, setThankyouDescription] = useState("");
  const [thankyouButton, setThankyouButton] = useState("");
  const [thankyouLink, setThankyouLink] = useState("");
  /** Migration-008 capability (new field types' server contract). */
  const [v008, setV008] = useState<boolean | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [deletingForm, setDeletingForm] = useState(false);

  // Field-level editing
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [addingField, setAddingField] = useState<LibraryEntry["type"] | null>(null);
  const [duplicatingFieldId, setDuplicatingFieldId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Library rail state — RETIRED per owner directive: the Add Fields
  // pane is now ALWAYS expanded on desktop (no shrink/collapse mode).

  // Dialogs / sheets
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteFormOpen, setDeleteFormOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<FormField | null>(null);
  const [deleteFieldBusy, setDeleteFieldBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  /** null | field-id | "cancel" | "navigate" (leaving the builder). */
  const [pendingSelection, setPendingSelection] = useState<string | null | "cancel" | "navigate">(null);
  const [librarySheetOpen, setLibrarySheetOpen] = useState(false);
  const [propsSheetOpen, setPropsSheetOpen] = useState(false);

  // Clean up the retired pin preference (the library is always expanded
  // now — the old collapse-to-rail mode was removed by owner directive).
  useEffect(() => {
    try {
      window.localStorage.removeItem(PIN_PREF_KEY);
    } catch {
      /* storage unavailable — nothing to clean */
    }
  }, []);

  // Detect migration 008 (new field types' server contract) once per
  // builder load; the library and publish gate adapt to the result.
  useEffect(() => {
    void detectFieldCapabilities().then((ok) => setV008(ok));
  }, []);

  const fieldIds = useMemo(() => fields.map((f) => f.id), [fields]);
  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );
  // Capability-gated library groups (migration 008 types appear only
  // after the owner applies it — honest both before and after).
  const gatedLibraryGroups = useMemo(() => libraryGroupsFor(v008), [v008]);
  const savedSubmitLabel =
    typeof form?.settings?.submit_button_label === "string"
      ? (form.settings.submit_button_label as string)
      : "";
  const savedMode: "standard" | "card" =
    form?.settings?.mode === "card" ? "card" : "standard";
  const savedWelcome = readScreenDrafts(form?.settings, "welcome");
  const savedThankyou = readScreenDrafts(form?.settings, "thankyou");
  const formDetailsDirty =
    form !== null &&
    (name !== form.name ||
      (description || "") !== (form.description ?? "") ||
      submitLabel !== savedSubmitLabel ||
      formMode !== savedMode ||
      welcomeOn !== (savedWelcome.enabled === true) ||
      welcomeTitle !== (savedWelcome.title ?? "") ||
      welcomeDescription !== (savedWelcome.description ?? "") ||
      welcomeButton !== (savedWelcome.button ?? "") ||
      thankyouOn !== (savedThankyou.enabled === true) ||
      thankyouTitle !== (savedThankyou.title ?? "") ||
      thankyouDescription !== (savedThankyou.description ?? "") ||
      thankyouButton !== (savedThankyou.button ?? "") ||
      thankyouLink !== (savedThankyou.link ?? ""));
  const hasFileUpload = fields.some((f) => f.field_type === "file_upload");
  /** Field types present in this form that cannot be published yet —
   *  capability-aware (file upload / signature / the 008 types while
   *  migration 008 awaits the owner's apply). */
  const blockedTypes = useMemo(
    () => blockedTypeLabelsFor(fields, v008),
    [fields, v008],
  );

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
      setFormMode(formRes.data.settings?.mode === "card" ? "card" : "standard");
      const savedWelcome = formRes.data.settings?.welcome;
      if (savedWelcome && typeof savedWelcome === "object" && !Array.isArray(savedWelcome)) {
        const w = savedWelcome as Record<string, unknown>;
        setWelcomeOn(w.enabled === true);
        setWelcomeTitle(typeof w.title === "string" ? w.title : "");
        setWelcomeDescription(typeof w.description === "string" ? w.description : "");
        setWelcomeButton(typeof w.button_label === "string" ? w.button_label : "");
      }
      const savedThankyou = formRes.data.settings?.thankyou;
      if (savedThankyou && typeof savedThankyou === "object" && !Array.isArray(savedThankyou)) {
        const t = savedThankyou as Record<string, unknown>;
        setThankyouOn(t.enabled === true);
        setThankyouTitle(typeof t.title === "string" ? t.title : "");
        setThankyouDescription(typeof t.description === "string" ? t.description : "");
        setThankyouButton(typeof t.button_label === "string" ? t.button_label : "");
        setThankyouLink(typeof t.link_url === "string" ? t.link_url : "");
      }

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
    if (pendingSelection === "navigate") {
      // Leaving the builder: drop the unsaved draft deliberately and go.
      setPendingSelection(null);
      setDiscardOpen(false);
      setSelectedFieldId(null);
      setPropsSheetOpen(false);
      router.push("/dashboard/forms/");
      return;
    }
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

  /**
   * Back-link guard: navigating away with unsaved edits (field draft or
   * form settings) is a deliberate choice, never a silent loss. The
   * same discard dialog handles it with a navigation-aware action.
   */
  function requestLeaveBuilder() {
    if (formDetailsDirty || editorDirty) {
      setPendingSelection("navigate");
      setDiscardOpen(true);
      return;
    }
    router.push("/dashboard/forms/");
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
    // Presentation mode — stored only when it is not the default, the
    // same convention as submit_button_label. Flows into the publish
    // snapshot (006 snapshots settings wholesale) and the public form.
    if (formMode === "card") nextSettings.mode = "card";
    else delete nextSettings.mode;

    // Welcome / thank-you screens — same delete-when-default convention.
    if (welcomeOn) {
      const w: Record<string, unknown> = { enabled: true };
      if (welcomeTitle.trim()) w.title = welcomeTitle.trim().slice(0, 200);
      if (welcomeDescription.trim()) w.description = welcomeDescription.trim().slice(0, 1000);
      if (welcomeButton.trim()) w.button_label = welcomeButton.trim().slice(0, 40);
      nextSettings.welcome = w;
    } else delete nextSettings.welcome;
    if (thankyouOn) {
      const t: Record<string, unknown> = { enabled: true };
      if (thankyouTitle.trim()) t.title = thankyouTitle.trim().slice(0, 200);
      if (thankyouDescription.trim()) t.description = thankyouDescription.trim().slice(0, 1000);
      if (thankyouButton.trim()) t.button_label = thankyouButton.trim().slice(0, 40);
      if (/^https:\/\//.test(thankyouLink.trim())) t.link_url = thankyouLink.trim().slice(0, 2048);
      nextSettings.thankyou = t;
    } else delete nextSettings.thankyou;

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

  async function addField(entry: LibraryEntry) {
    if (!form) return;
    if (fields.length >= MAX_FIELDS_PER_FORM) {
      toast.error("Field limit reached.", {
        description: `A form supports at most ${MAX_FIELDS_PER_FORM} fields (matching the publish limit).`,
      });
      return;
    }
    const label = entry.defaultLabel;
    const type = entry.type;
    setAddingField(type);
    try {
      const existingKeys = fields.map((f) => f.field_key);
      const key = uniqueKey(label, existingKeys);
      const nextOrder =
        fields.length > 0 ? Math.max(...fields.map((f) => f.sort_order)) + 1 : 0;

      // Entry-appropriate default config (presets like NPS/Slider/Ranking
      // carry their tuned defaults; selects start with valid options).
      const defaultConfig = entry.defaultConfig();

      const { data, error } = await supabaseBrowser
        .from("form_fields")
        .insert({
          form_id: form.id,
          field_key: key,
          field_type: type,
          label,
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
      toast.success(`${entry.label} field added.`);
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

  async function saveField(fieldId: string, draft: FieldDraft): Promise<boolean> {
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
          // Deep copy — the duplicate shares NO object identity with
          // the original's config (option labels maps included).
          config: cloneConfig(field.config),
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
  const libraryDisabled = addingField !== null || deletingForm || savingForm;
  // Draft form header for the preview — built from the CURRENT editor
  // state (name, description, submit label, mode), never the stale
  // saved row, so "exactly what respondents will see" is honest while
  // there are unsaved edits.
  const previewForm: RenderableFormHeader = {
    name,
    description: description || null,
    settings: previewSettingsFor(form.settings, submitLabel, formMode, {
      welcomeOn,
      welcomeTitle,
      welcomeDescription,
      welcomeButton,
      thankyouOn,
      thankyouTitle,
      thankyouDescription,
      thankyouButton,
      thankyouLink,
    }),
  };

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:p-5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selectedFieldId && e.target === e.currentTarget) {
          closeProperties();
        }
      }}
    >
      {/* ================= Toolbar (never scrolls away) ================= */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border-2 border-foreground/10 bg-surface p-2.5 sm:gap-3 sm:p-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to forms"
          onClick={requestLeaveBuilder}
        >
          <ArrowLeft className="h-4 w-4" />
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

      {/* ================= Fixed-height workspace ================= */}
      <div className="flex min-h-0 flex-1 gap-3 sm:gap-4">
        {/* ── Left: field library (lg+) — ALWAYS EXPANDED (owner
            directive: no shrink/collapse option) ── */}
        <LibraryPane
          onAdd={addField}
          disabled={libraryDisabled}
          fieldCount={fields.length}
          groups={gatedLibraryGroups}
        />

        {/* ── Center: live canvas (own scroll context) ── */}
        {/* Clicking unused canvas space deselects the field so the right
            panel returns to Form Settings (field cards stop propagation). */}
        <main
          className="min-w-0 flex-1 overflow-y-auto rounded-2xl border-2 border-foreground/10 bg-[color:var(--surface)]/60 p-3 sm:p-4 lg:p-5"
          aria-label="Form canvas"
          onClick={() => {
            if (selectedFieldId) selectField(null);
          }}
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
                  {name}
                </h2>
                {description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                )}
                <p className="mt-2.5 text-xs text-muted-foreground/80">
                  {fields.length} field{fields.length === 1 ? "" : "s"}
                  {submitLabel.trim() ? ` · button “${submitLabel.trim()}”` : ""}
                  {formMode === "card" ? " · card mode" : ""}
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
              <EmptyCanvas
                onAdd={addField}
                disabled={libraryDisabled}
                isDesktop={isDesktop}
                onOpenLibrary={() => setLibrarySheetOpen(true)}
              />
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

        {/* ── Right: properties (lg+, own scroll context) ── */}
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
            formMode={formMode}
            screens={{
              welcomeOn, welcomeTitle, welcomeDescription, welcomeButton,
              thankyouOn, thankyouTitle, thankyouDescription, thankyouButton, thankyouLink,
            }}
            onScreens={{
              setWelcomeOn, setWelcomeTitle, setWelcomeDescription, setWelcomeButton,
              setThankyouOn, setThankyouTitle, setThankyouDescription, setThankyouButton, setThankyouLink,
            }}
            onName={setName}
            onDescription={setDescription}
            onSubmitLabel={setSubmitLabel}
            onFormMode={setFormMode}
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
                groups={gatedLibraryGroups}
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
                <FieldPropertyEditor
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
        form={previewForm}
        fields={fields.map(toRenderableField)}
      />

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        formId={form.id}
        formName={form.name}
        fieldCount={fields.length}
        blockedTypes={blockedTypes}
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
            <AlertDialogTitle>
              {pendingSelection === "navigate" ? "Leave with unsaved edits?" : "Discard unsaved edits?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSelection === "navigate"
                ? "You have changes that were never saved to the database. Leaving now discards them — this cannot be undone."
                : "This field has changes that were never saved to the database. Discarding them cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              {pendingSelection === "navigate" ? "Discard and leave" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Library pane — fixed, ALWAYS-EXPANDED panel                         */
/*                                                                      */
/* Owner directive (2026-09-05): the Add Fields section never shrinks. */
/* The previous 56px icon-rail + hover-overlay + pin/collapse modes    */
/* were removed. Desktop lg+ always shows the full 256px library with */
/* search, groups and descriptions; tablet/mobile keep the Sheet.     */
/* ------------------------------------------------------------------ */

function LibraryPane({
  onAdd,
  disabled,
  fieldCount,
  groups,
}: {
  onAdd: (entry: LibraryEntry) => void;
  disabled: boolean;
  fieldCount: number;
  groups: { key: FieldGroup; label: string; items: LibraryEntry[] }[];
}) {
  return (
    <aside
      className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface lg:flex"
      aria-label="Field library"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-foreground/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-display text-sm font-bold">Add fields</p>
          <p className="text-[11px] text-muted-foreground">Click to append</p>
        </div>
        <span
          className="ml-auto shrink-0 rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
          aria-label={`${fieldCount} fields in this form`}
        >
          {fieldCount}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <FieldLibrary onAdd={onAdd} disabled={disabled} fieldCount={fieldCount} groups={groups} />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Empty canvas — "add your first field" experience                    */
/* ------------------------------------------------------------------ */

function EmptyCanvas({
  onAdd,
  disabled,
  isDesktop,
  onOpenLibrary,
}: {
  onAdd: (entry: LibraryEntry) => void;
  disabled: boolean;
  isDesktop: boolean;
  onOpenLibrary: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-foreground/25 p-6 text-center sm:p-8">
      <GeometricTriangle
        color="violet"
        size={20}
        rotate={-12}
        className="relative mx-auto mb-3 opacity-60"
      />
      <p className="font-display text-lg font-bold">Add your first field</p>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Pick a common field below, or open the full library
        {isDesktop ? " in the rail on the left" : ""}. Every field is a real database
        row the moment you add it.
      </p>

      <div className="mx-auto mt-5 grid max-w-xs grid-cols-2 gap-2">
        {QUICK_START_ENTRIES.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onAdd(entry)}
              disabled={disabled}
              className="flex items-center gap-2 rounded-xl border-2 border-foreground/10 bg-surface px-3 py-2.5 text-left text-sm font-semibold text-foreground transition-all hover:border-[color:var(--memphis-coral)]/50 hover:bg-[color:var(--memphis-coral)]/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Add ${entry.label} field`}
            >
              <Icon className="h-4 w-4 shrink-0 text-[color:var(--memphis-coral)]" aria-hidden />
              {entry.label}
            </button>
          );
        })}
      </div>

      <Button
        variant="memphis-outline"
        size="sm"
        className="mt-5 lg:hidden"
        onClick={onOpenLibrary}
        aria-label="Browse all field types"
      >
        <Plus className="h-4 w-4" />
        Browse all fields
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Save state chip                                                     */
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
/* Properties panel (desktop right pane)                               */
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
  formMode,
  screens,
  onScreens,
  onName,
  onDescription,
  onSubmitLabel,
  onFormMode,
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
  formMode: "standard" | "card";
  screens: ScreenDrafts;
  onScreens: ScreenDraftSetters;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmitLabel: (v: string) => void;
  onFormMode: (v: "standard" | "card") => void;
  onSaveForm: () => void;
  formDetailsDirty: boolean;
  onOpenShare: () => void;
  onSelectField: (id: string | null) => void;
  onClose: () => void;
  onEditorDirty: (dirty: boolean) => void;
  onSaveField: (fieldId: string, draft: FieldDraft) => Promise<boolean>;
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
          <FieldPropertyEditor
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
            formMode={formMode}
            screens={screens}
            onScreens={onScreens}
            onName={onName}
            onDescription={onDescription}
            onSubmitLabel={onSubmitLabel}
            onFormMode={onFormMode}
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
  formMode,
  screens,
  onScreens,
  onName,
  onDescription,
  onSubmitLabel,
  onFormMode,
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
  formMode: "standard" | "card";
  screens: ScreenDrafts;
  onScreens: ScreenDraftSetters;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmitLabel: (v: string) => void;
  onFormMode: (v: "standard" | "card") => void;
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
              const def = fieldDef(f.field_type);
              const Icon = def.icon;
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
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
        <div className="space-y-2">
          <p className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Form mode
          </p>
          <div
            role="radiogroup"
            aria-label="Form mode"
            className="grid grid-cols-1 gap-2"
          >
            {(
              [
                ["standard", "Standard", "All questions on one page"],
                ["card", "Card", "One question at a time"],
              ] as const
            ).map(([value, title, sub]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={formMode === value}
                onClick={() => onFormMode(value)}
                disabled={saving}
                className={cn(
                  "rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  formMode === value
                    ? "border-[color:var(--memphis-coral)] bg-[color:var(--memphis-coral)]/8"
                    : "border-foreground/10 bg-background hover:border-foreground/25",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {formMode === value && (
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-[color:var(--memphis-coral)]"
                      aria-hidden
                    />
                  )}
                  {title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {sub}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            How the form is presented to respondents — save and preview to see it.
          </p>
        </div>

        {/* ── Welcome screen ── */}
        <div className="space-y-2.5 border-t border-foreground/10 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Welcome screen</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                A start screen before the first question — title, description, call to action
              </p>
            </div>
            <Switch
              checked={screens.welcomeOn}
              onCheckedChange={onScreens.setWelcomeOn}
              disabled={saving}
              aria-label="Enable welcome screen"
            />
          </div>
          {screens.welcomeOn && (
            <div className="space-y-2.5 rounded-xl border border-foreground/10 bg-background p-3">
              <div className="space-y-1.5">
                <Label htmlFor="welcome-title">Welcome title</Label>
                <Input
                  id="welcome-title"
                  value={screens.welcomeTitle}
                  onChange={(e) => onScreens.setWelcomeTitle(e.target.value)}
                  disabled={saving}
                  className="h-9"
                  placeholder={name || "Welcome"}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="welcome-description">Welcome description</Label>
                <Textarea
                  id="welcome-description"
                  value={screens.welcomeDescription}
                  onChange={(e) => onScreens.setWelcomeDescription(e.target.value)}
                  disabled={saving}
                  rows={2}
                  placeholder={description || "Shown under the welcome title"}
                  maxLength={1000}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="welcome-button">Start button label</Label>
                <Input
                  id="welcome-button"
                  value={screens.welcomeButton}
                  onChange={(e) => onScreens.setWelcomeButton(e.target.value)}
                  disabled={saving}
                  className="h-9"
                  placeholder="Start"
                  maxLength={40}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Thank-you screen ── */}
        <div className="space-y-2.5 border-t border-foreground/10 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Thank-you screen</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                What respondents see after a successful submit
              </p>
            </div>
            <Switch
              checked={screens.thankyouOn}
              onCheckedChange={onScreens.setThankyouOn}
              disabled={saving}
              aria-label="Enable thank-you screen"
            />
          </div>
          {screens.thankyouOn && (
            <div className="space-y-2.5 rounded-xl border border-foreground/10 bg-background p-3">
              <div className="space-y-1.5">
                <Label htmlFor="thankyou-title">Thank-you title</Label>
                <Input
                  id="thankyou-title"
                  value={screens.thankyouTitle}
                  onChange={(e) => onScreens.setThankyouTitle(e.target.value)}
                  disabled={saving}
                  className="h-9"
                  placeholder="Thank you — response received"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="thankyou-description">Thank-you description</Label>
                <Textarea
                  id="thankyou-description"
                  value={screens.thankyouDescription}
                  onChange={(e) => onScreens.setThankyouDescription(e.target.value)}
                  disabled={saving}
                  rows={2}
                  placeholder="Shown under the title with the reference number"
                  maxLength={1000}
                />
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor="thankyou-link">Follow-up link (https://…)</Label>
                  <Input
                    id="thankyou-link"
                    type="url"
                    value={screens.thankyouLink}
                    onChange={(e) => onScreens.setThankyouLink(e.target.value)}
                    disabled={saving}
                    className="h-9"
                    placeholder="https://example.com"
                    maxLength={2048}
                  />
                </div>
                {/^https:\/\//.test(screens.thankyouLink.trim()) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="thankyou-button">Link label</Label>
                    <Input
                      id="thankyou-button"
                      value={screens.thankyouButton}
                      onChange={(e) => onScreens.setThankyouButton(e.target.value)}
                      disabled={saving}
                      className="h-9"
                      placeholder="Continue"
                      maxLength={40}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
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
/* CanvasFieldCard — selectable/draggable wrapper around the field     */
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

  const def = fieldDef(field.field_type);
  const rf = toRenderableField(field);
  const isSection = field.field_type === "section";
  const isLayout = isSection || field.field_type === "page_break";

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
        onClick={(e) => {
          // Keep the click INSIDE the card: the canvas background handler
          // deselects on clicks that reach it — a card click must not.
          e.stopPropagation();
          onSelect();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-pressed={selected}
        aria-label={`${selected ? "Close" : "Open"} properties for ${field.label} (${def.label})`}
        className={cn(
          "group relative cursor-pointer rounded-2xl border-2 p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSection
            ? "border-dashed border-foreground/25 bg-transparent hover:border-foreground/40"
            : isLayout
              ? "border-dashed border-[color:var(--memphis-violet)]/40 bg-transparent hover:border-[color:var(--memphis-violet)]/70"
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
          <def.icon className="h-3.5 w-3.5 text-[color:var(--memphis-coral)]" aria-hidden />
          <span className="font-semibold">
            {libraryLabelFor(field.field_type, field.config as Record<string, unknown> | null)}
          </span>
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
  if (field.field_type === "embed") {
    return (
      <div>
        <EmbedBlock field={field} mode="builder" />
        {selected && (
          <p className="mt-1.5 text-center text-[11px] font-medium text-[color:var(--memphis-violet)]">
            Presentation block — collects no data
          </p>
        )}
      </div>
    );
  }
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
  if (field.field_type === "page_break") {
    // Same divider the respondent views render (form-renderer.tsx),
    // composed here directly so the canvas stays a flat editing list.
    const showLabel =
      field.label.trim() !== "" && !/^page\s*break$/i.test(field.label.trim());
    return (
      <div>
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-foreground/15" />
          <span className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-[color:var(--memphis-violet)]" />
          <span className="h-px flex-1 bg-foreground/15" />
        </div>
        {showLabel && (
          <p className="mt-2.5 text-center font-display text-base font-bold tracking-tight text-foreground">
            {field.label}
          </p>
        )}
        {field.description && (
          <p className="mt-1 text-center text-sm text-muted-foreground">{field.description}</p>
        )}
        {field.help_text && (
          <p className="mt-0.5 text-center text-xs text-muted-foreground/80">{field.help_text}</p>
        )}
        {selected && (
          <p className="mt-1.5 text-center text-[11px] font-medium text-[color:var(--memphis-violet)]">
            Fields after this divider start a new page for respondents
          </p>
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
