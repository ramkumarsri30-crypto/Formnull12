"use client";

/**
 * FormNull — Field Property Editor (Field System 2.0)
 * =====================================================================
 * THE generic, schema-driven properties panel. It renders EXACTLY the
 * sections and properties declared by the field type's FieldTypeDef —
 * no hand-written per-type if/else chains, no irrelevant controls.
 *
 * State discipline (directive Part 12 — stale-config bleed prevention):
 *   - The draft is derived from the `field` prop at MOUNT.
 *   - The parent renders this editor with key={field.id}, so switching
 *     selection fully remounts it — Field A's draft can never leak
 *     into Field B.
 *   - A belt-and-suspenders effect re-derives the draft if field.id
 *     ever changes without a remount, and reports clean dirty state.
 *   - Unsaved changes are guarded by the parent's discard dialog; this
 *     editor never silently drops them.
 *
 * Config hygiene: declared config keys emptied by the user are removed
 * (never persisted as null); config keys NOT declared for the type are
 * preserved untouched — that is the legacy-compatibility path for
 * pre-rebuild fields (e.g. phone length rules written before this
 * rebuild keep validating server-side).
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/lib/supabase/types";
import {
  fieldDef,
  validateConfig,
  validateWidth,
  validateOptions,
  PROPERTY_SECTION_ORDER,
  SECTION_LABELS,
  MAX_LABEL_LEN,
  MAX_TEXT_LEN,
  type PropertyDefinition,
  type FieldTypeDef,
} from "./field-registry";
import { OptionListEditor, configToRows, rowsToConfig, type OptionRow } from "./option-editor";
import { COUNTRIES, countryByIso } from "./country-data";
import { cn } from "@/lib/utils";

type FormField = Database["public"]["Tables"]["form_fields"]["Row"];

interface EditableDraft {
  label: string;
  description: string;
  placeholder: string;
  help_text: string;
  is_required: boolean;
  width: number;
  config: Record<string, unknown>;
}

/** The save payload — nullable columns, cleaned config. */
export interface FieldDraft {
  label: string;
  description: string | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  width: number;
  config: Record<string, unknown>;
}

/** Deep-copy a JSON-safe config so drafts never share object identity
 *  with saved rows (duplicate/config-copy isolation). */
function cloneConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function draftFromField(field: FormField): EditableDraft {
  return {
    label: field.label,
    description: field.description ?? "",
    placeholder: field.placeholder ?? "",
    help_text: field.help_text ?? "",
    is_required: field.is_required,
    width: field.width,
    config: cloneConfig(field.config),
  };
}

const WIDTH_CHOICES: { value: string; label: string }[] = [
  { value: "12", label: "Full width" },
  { value: "9", label: "Three quarters" },
  { value: "8", label: "Two thirds" },
  { value: "6", label: "Half" },
  { value: "4", label: "One third" },
  { value: "3", label: "One quarter" },
];

export function FieldPropertyEditor({
  field,
  saving,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  field: FormField;
  saving: boolean;
  onSave: (draft: FieldDraft) => Promise<boolean>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const def: FieldTypeDef = useMemo(() => fieldDef(field.field_type), [field.field_type]);

  const [draft, setDraft] = useState<EditableDraft>(() => draftFromField(field));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [optionError, setOptionError] = useState<string | null>(null);

  // The parent renders this editor with key={field.id}, so a selection
  // switch fully remounts it (the primary stale-state defense). This
  // render-phase adjustment is the belt-and-suspenders layer for any
  // render path that ever changes the field identity WITHOUT a
  // remount: re-derive the draft during render (React's documented
  // "adjust state when a prop changes" pattern — no cascading effect).
  const [derivedFromId, setDerivedFromId] = useState(field.id);
  if (derivedFromId !== field.id) {
    setDerivedFromId(field.id);
    setDraft(draftFromField(field));
    setValidationError(null);
    setOptionError(null);
  }

  function patch(p: Partial<EditableDraft>) {
    setDraft((d) => ({ ...d, ...p }));
    setValidationError(null);
    onDirtyChange?.(true);
  }

  function patchConfig(p: Record<string, unknown>) {
    setDraft((d) => ({ ...d, config: { ...d.config, ...p } }));
    setValidationError(null);
    onDirtyChange?.(true);
  }

  async function save() {
    const label = draft.label.trim();
    if (!label) {
      setValidationError("Label is required.");
      return;
    }
    if (label.length > MAX_LABEL_LEN) {
      setValidationError(`Label must be at most ${MAX_LABEL_LEN} characters.`);
      return;
    }
    for (const [k, v] of [
      ["Description", draft.description],
      ["Placeholder", draft.placeholder],
      ["Help text", draft.help_text],
    ] as const) {
      if (v && v.length > MAX_TEXT_LEN) {
        setValidationError(`${k} must be at most ${MAX_TEXT_LEN} characters.`);
        return;
      }
    }
    const widthCheck = validateWidth(draft.width);
    if (!widthCheck.ok) {
      setValidationError(widthCheck.message ?? "Invalid width.");
      return;
    }

    // Option invariants first (better message than the generic check).
    if (def.value === "single_select" || def.value === "multi_select") {
      const rows = configToRows(draft.config);
      const optCheck = validateOptions(
        rowsToConfig(rows).options,
        rowsToConfig(rows).optionLabels,
      );
      if (!optCheck.ok) {
        setOptionError(optCheck.message ?? "Invalid options.");
        setValidationError(optCheck.message ?? "Invalid options.");
        return;
      }
      setOptionError(null);
    }

    const cleaned = cleanConfig(def, draft.config);
    const configCheck = validateConfig(field.field_type, cleaned);
    if (!configCheck.ok) {
      setValidationError(configCheck.message ?? "Invalid configuration.");
      return;
    }

    const ok = await onSave({
      label,
      description: draft.description.trim() || null,
      placeholder: draft.placeholder.trim() || null,
      help_text: draft.help_text.trim() || null,
      is_required: draft.is_required,
      width: draft.width,
      config: cleaned,
    });
    if (ok) {
      onDirtyChange?.(false);
      setValidationError(null);
    }
  }

  // Group properties by section, in canonical order.
  const sections = useMemo(() => {
    const map = new Map<string, { title: string; props: PropertyDefinition[] }>();
    for (const s of PROPERTY_SECTION_ORDER) {
      const props = def.properties.filter(
        (p) =>
          p.section === s &&
          !(p.visibleWhenPresent && draft.config[p.key] == null),
      );
      if (props.length > 0) map.set(s, { title: SECTION_LABELS[s], props });
    }
    return [...map.values()];
  }, [def, draft.config]);

  const columnValue = (key: string): string => {
    switch (key) {
      case "label": return draft.label;
      case "description": return draft.description;
      case "placeholder": return draft.placeholder;
      case "help_text": return draft.help_text;
      default: return "";
    }
  };

  function patchDraftColumn(key: string, value: string) {
    patch({ [key]: value } as Partial<EditableDraft>);
  }

  return (
    <div className="space-y-5">
      {/* Type header — what the user is configuring */}
      <div className="flex items-center gap-2.5 rounded-xl bg-surface p-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--memphis-coral)]/12 text-[color:var(--memphis-coral)]"
          aria-hidden
        >
          <def.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{def.label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={field.field_key}>
            {field.field_key}
          </p>
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {section.title}
          </p>

          {section.title === "Validation" && def.validationNote && (
            <p className="rounded-lg bg-background px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {def.validationNote}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {section.props.map((prop) => (
              <PropertyControlShell
                key={prop.key}
                prop={prop}
                draft={draft}
                columnValue={columnValue(prop.key)}
                onColumn={(v) => patchDraftColumn(prop.key, v)}
                onRequired={(v) => patch({ is_required: v })}
                onWidth={(v) => patch({ width: v })}
                onConfigValue={(v) => patchConfig({ [prop.key]: v })}
                onConfigPatch={patchConfig}
                saving={saving}
                optionError={prop.control === "options-editor" ? optionError : null}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Spacer so the sticky action bar never covers the last controls */}
      <div aria-hidden className="h-12" />

      {/* Validation error */}
      {validationError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {validationError}
        </p>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-foreground/10 bg-surface/95 px-4 pt-3 pb-1 backdrop-blur-sm sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} className="flex-1 sm:flex-none">
          Cancel
        </Button>
        <Button variant="memphis-coral" size="sm" onClick={save} disabled={saving} className="flex-1 sm:flex-none">
          {saving ? "Saving…" : "Save field"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Control shell — routes a PropertyDefinition to its widget           */
/* ------------------------------------------------------------------ */

function PropertyControlShell({
  prop,
  draft,
  columnValue,
  onColumn,
  onRequired,
  onWidth,
  onConfigValue,
  onConfigPatch,
  saving,
  optionError,
}: {
  prop: PropertyDefinition;
  draft: EditableDraft;
  columnValue: string;
  onColumn: (v: string) => void;
  onRequired: (v: boolean) => void;
  onWidth: (v: number) => void;
  onConfigValue: (v: unknown) => void;
  onConfigPatch: (p: Record<string, unknown>) => void;
  saving: boolean;
  optionError: string | null;
}) {
  const wrapperClass = cn("space-y-1.5", prop.fullWidth && "col-span-2");
  const cid = `prop-${prop.key}`; // unique per editor instance (panel renders one field)

  switch (prop.control) {
    case "text":
      return (
        <div className={wrapperClass}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <Input
            id={cid}
            value={prop.target === "column" ? columnValue : configStr(draft.config[prop.key])}
            onChange={(e) =>
              prop.target === "column"
                ? onColumn(e.target.value)
                : onConfigValue(e.target.value || null)
            }
            disabled={saving}
            className="h-9"
            placeholder={prop.placeholder}
            maxLength={prop.target === "column" ? MAX_TEXT_LEN : MAX_LABEL_LEN}
          />
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "textarea":
      return (
        <div className={wrapperClass}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <Textarea
            id={cid}
            value={prop.target === "column" ? columnValue : configStr(draft.config[prop.key])}
            onChange={(e) =>
              prop.target === "column"
                ? onColumn(e.target.value)
                : onConfigValue(e.target.value || null)
            }
            disabled={saving}
            rows={2}
            placeholder={prop.placeholder}
            maxLength={MAX_TEXT_LEN}
          />
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "number":
      return (
        <div className={wrapperClass}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <Input
            id={cid}
            type="number"
            value={numStr(draft.config[prop.key])}
            onChange={(e) =>
              onConfigValue(e.target.value === "" ? null : Number(e.target.value))
            }
            disabled={saving}
            className="h-9"
            min={prop.min}
            max={prop.max}
            step={prop.step ?? (prop.key === "step" ? "any" : 1)}
          />
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "switch":
      return (
        <div className={cn("flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-3", prop.fullWidth && "col-span-2")}>
          {asPlain({ prop })}
          <Switch
            checked={draft.is_required}
            onCheckedChange={onRequired}
            disabled={saving}
            aria-label={prop.label}
          />
        </div>
      );

    case "width":
      return (
        <div className={wrapperClass}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <Select
            value={String(draft.width)}
            onValueChange={(v) => onWidth(Number(v))}
            disabled={saving}
          >
            <SelectTrigger id={cid} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WIDTH_CHOICES.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "select":
      return (
        <div className={wrapperClass}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <Select
            value={configStr(draft.config[prop.key])}
            onValueChange={(v) => onConfigValue(v)}
            disabled={saving}
          >
            <SelectTrigger id={cid} className="h-9">
              <SelectValue placeholder={prop.placeholder ?? "Choose"} />
            </SelectTrigger>
            <SelectContent>
              {prop.choices?.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "options-editor":
      return (
        <div className={cn(wrapperClass, "col-span-2")}>
          <OptionsControl
            config={draft.config}
            onConfigPatch={onConfigPatch}
            saving={saving}
            error={optionError}
          />
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    case "default-country":
      return (
        <div className={cn(wrapperClass, "col-span-2")}>
          <ControlLabel prop={prop} htmlFor={cid} />
          <DefaultCountryControl
            value={draft.config.defaultCountry}
            onChange={(v) => onConfigValue(v)}
            disabled={saving}
          />
          {prop.hint && <Hint text={prop.hint} />}
        </div>
      );

    default:
      return null;
  }
}

/*
 * Options control container — keeps option rows in LOCAL state (so
 * per-row flags like valueEdited survive keystrokes) while writing
 * every change back into the draft config immediately. Remounts with
 * the property editor on field switches, re-deriving rows from the
 * saved config.
 */
function OptionsControl({
  config,
  onConfigPatch,
  saving,
  error,
}: {
  config: Record<string, unknown>;
  onConfigPatch: (p: Record<string, unknown>) => void;
  saving: boolean;
  error: string | null;
}) {
  const [rows, setRows] = useState<OptionRow[]>(() => configToRows(config));

  function update(next: OptionRow[]) {
    setRows(next);
    const { options, optionLabels } = rowsToConfig(next);
    onConfigPatch({ options, optionLabels });
  }

  return (
    <OptionListEditor
      rows={rows}
      onChange={update}
      disabled={saving}
      errors={error}
    />
  );
}

function ControlLabel({ prop, htmlFor }: { prop: PropertyDefinition; htmlFor: string }) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {prop.label}
    </Label>
  );
}

function asPlain({ prop }: { prop: PropertyDefinition }) {
  return (
    <div>
      <p className="text-xs font-semibold text-foreground">{prop.label}</p>
      {prop.hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{prop.hint}</p>}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{text}</p>;
}

function configStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numStr(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/* ------------------------------------------------------------------ */
/* Default country control — auto-detect (browser locale) or specific  */
/* ------------------------------------------------------------------ */

function DefaultCountryControl({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const specific = typeof value === "string" && countryByIso(value) ? true : false;
  const mode: "auto" | "specific" = specific ? "specific" : "auto";

  return (
    <div className="space-y-2">
      <div
        className="flex rounded-xl border-2 border-foreground/10 bg-background p-1"
        role="radiogroup"
        aria-label="Default country mode"
      >
        {(
          [
            ["auto", "Auto detect"],
            ["specific", "Specific country"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => onChange(m === "auto" ? null : "US")}
            disabled={disabled}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === m
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "specific" && (
        <Select
          value={typeof value === "string" ? value : "US"}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9" aria-label="Default country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {COUNTRIES.map((c) => (
              <SelectItem key={c.iso} value={c.iso}>
                {c.name} (+{c.dial})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {mode === "auto"
          ? "Uses the respondent's browser locale — no network lookup."
          : "Pre-selects this country's calling code on the public form."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Config cleaning                                                     */
/* ------------------------------------------------------------------ */

/**
 * Remove declared keys the user emptied; preserve everything else.
 * `options`/`optionLabels` keep their working shapes (validated).
 */
function cleanConfig(
  def: FieldTypeDef,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(
    def.properties.filter((p) => p.target === "config").map((p) => p.key),
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === "options" || k === "optionLabels") {
      // Handled wholesale below.
      continue;
    }
    if (!declared.has(k)) {
      out[k] = v; // legacy/unknown keys pass through untouched
      continue;
    }
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  if (declared.has("options")) {
    const rows = configToRows(config);
    const { options, optionLabels } = rowsToConfig(rows);
    if (options.length > 0) {
      out.options = options;
      if (Object.keys(optionLabels).length > 0) out.optionLabels = optionLabels;
    }
  }
  return out;
}
