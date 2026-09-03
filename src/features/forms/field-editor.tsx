"use client";

/**
 * FormNull — Field Editor (Phase 3)
 * =====================================================================
 * Field properties panel used inside the form builder's right pane
 * (desktop) / properties Sheet (tablet & mobile).
 *
 * Edits label, description, placeholder, help text, required, width
 * (1-12, matching the DB CHECK constraint) and the typed config model
 * for the field's type (options for selects, min/max/step for numbers
 * and scales, end labels for scales, rows for long text, allowed types
 * for uploads).
 *
 * Saving is EXPLICIT: the Save button performs a real Supabase UPDATE.
 * While saving, controls are disabled. On failure the editor stays
 * open with the user's values preserved and a real error is shown.
 * `onDirtyChange` reports draft-vs-saved state to the builder so it can
 * guard selection changes and navigation (no accidental data loss).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { Database } from "@/lib/supabase/types";
import { fieldMeta, validateConfig, validateWidth } from "./field-types";

type FormField = Database["public"]["Tables"]["form_fields"]["Row"];

interface Draft {
  label: string;
  description: string | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  width: number;
  config: Record<string, unknown>;
}

/** Internal editable state — plain strings, converted to null on save. */
interface EditableDraft {
  label: string;
  description: string;
  placeholder: string;
  help_text: string;
  is_required: boolean;
  width: number;
  config: Record<string, unknown>;
}

export function FieldEditor({
  field,
  saving,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  field: FormField;
  saving: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const meta = fieldMeta(field.field_type);
  const kind = meta?.configKind ?? "none";

  const [draft, setDraft] = useState<EditableDraft>({
    label: field.label,
    description: field.description ?? "",
    placeholder: field.placeholder ?? "",
    help_text: field.help_text ?? "",
    is_required: field.is_required,
    width: field.width,
    config: { ...(field.config ?? {}) },
  });
  const [validationError, setValidationError] = useState<string | null>(null);

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
    if (!draft.label.trim()) {
      setValidationError("Label is required.");
      return;
    }
    const widthCheck = validateWidth(draft.width);
    if (!widthCheck.ok) {
      setValidationError(widthCheck.message ?? "Invalid width.");
      return;
    }
    const configCheck = validateConfig(kind, field.field_type, draft.config);
    if (!configCheck.ok) {
      setValidationError(configCheck.message ?? "Invalid configuration.");
      return;
    }
    const ok = await onSave({
      label: draft.label.trim(),
      description: draft.description.trim() || null,
      placeholder: draft.placeholder.trim() || null,
      help_text: draft.help_text.trim() || null,
      is_required: draft.is_required,
      width: draft.width,
      config: cleanConfig(kind, field.field_type, draft.config),
    });
    if (ok) onDirtyChange?.(false);
  }

  // Report clean state on mount/field switch.
  useEffect(() => {
    onDirtyChange?.(false);
  }, [field.id, onDirtyChange]);

  const showPlaceholder =
    field.field_type === "short_text" ||
    field.field_type === "long_text" ||
    field.field_type === "email" ||
    field.field_type === "url" ||
    field.field_type === "phone" ||
    field.field_type === "number" ||
    field.field_type === "decimal";

  return (
    <div className="space-y-4">
      {/* Type header — what the user is configuring */}
      <div className="flex items-center gap-2.5 rounded-xl bg-surface p-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--memphis-coral)]/12 text-[color:var(--memphis-coral)]"
          aria-hidden
        >
          {meta?.icon ? <meta.icon className="h-4 w-4" /> : null}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{meta?.label ?? field.field_type}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{field.field_key}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Label */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`label-${field.id}`}>Label</Label>
          <Input
            id={`label-${field.id}`}
            value={draft.label}
            onChange={(e) => patch({ label: e.target.value })}
            disabled={saving}
            className="h-10"
            placeholder="Question shown to respondents"
            aria-invalid={!!validationError && !draft.label.trim()}
          />
        </div>

        {/* field_key — machine-readable, immutable (used by submission_values) */}
        <div className="sm:col-span-2">
          <p className="text-[11px] text-muted-foreground">
            <span className="opacity-80">machine key · immutable — links saved answers</span>
          </p>
        </div>

        {/* Description */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`desc-${field.id}`} className="text-xs">
            Description (optional)
          </Label>
          <Textarea
            id={`desc-${field.id}`}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            disabled={saving}
            rows={2}
            placeholder="Extra context under the label"
          />
        </div>

        {/* Placeholder */}
        {showPlaceholder && (
          <div className="space-y-2">
            <Label htmlFor={`ph-${field.id}`} className="text-xs">
              Placeholder (optional)
            </Label>
            <Input
              id={`ph-${field.id}`}
              value={draft.placeholder}
              onChange={(e) => patch({ placeholder: e.target.value })}
              disabled={saving}
              className="h-10"
            />
          </div>
        )}

        {/* Help text */}
        <div className="space-y-2">
          <Label htmlFor={`help-${field.id}`} className="text-xs">
            Help text (optional)
          </Label>
          <Input
            id={`help-${field.id}`}
            value={draft.help_text}
            onChange={(e) => patch({ help_text: e.target.value })}
            disabled={saving}
            className="h-10"
            placeholder="Shown below the input"
          />
        </div>

        {/* Width + Required */}
        <div className="space-y-2">
          <Label htmlFor={`width-${field.id}`} className="text-xs">
            Width — grid columns (1–12)
          </Label>
          <Select
            value={String(draft.width)}
            onValueChange={(v) => patch({ width: Number(v) })}
            disabled={saving}
          >
            <SelectTrigger id={`width-${field.id}`} className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w === 12 ? "12 — full width" : w === 6 ? "6 — half" : String(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-foreground/10 p-3">
          <div>
            <Label htmlFor={`req-${field.id}`} className="text-xs">
              Required
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Respondents must fill this in
            </p>
          </div>
          <Switch
            id={`req-${field.id}`}
            checked={draft.is_required}
            onCheckedChange={(v) => patch({ is_required: v })}
            disabled={saving}
          />
        </div>

        {/* Type-specific config */}
        {kind === "select" && (
          <SelectOptionsEditor
            options={(draft.config.options as string[]) ?? []}
            onChange={(options) => patchConfig({ options })}
            saving={saving}
          />
        )}
        {kind === "text" && (
          <TextConfigEditor
            fieldId={field.id}
            config={draft.config}
            showPattern={field.field_type === "short_text"}
            showRows={field.field_type === "long_text"}
            onChange={patchConfig}
            saving={saving}
          />
        )}
        {(kind === "number" || kind === "scale") && (
          <RangeConfigEditor
            fieldId={field.id}
            config={draft.config}
            showLabels={field.field_type === "scale"}
            onChange={patchConfig}
            saving={saving}
          />
        )}
        {kind === "rating" && (
          <RatingConfigEditor fieldId={field.id} config={draft.config} onChange={patchConfig} saving={saving} />
        )}
        {kind === "file" && (
          <FileConfigEditor fieldId={field.id} config={draft.config} onChange={patchConfig} saving={saving} />
        )}
    </div>

      {/* Validation error */}
      {validationError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {validationError}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="memphis-coral" size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save field"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Type-specific config editors                                        */
/* ------------------------------------------------------------------ */

function SelectOptionsEditor({
  options,
  onChange,
  saving,
}: {
  options: string[];
  onChange: (options: string[]) => void;
  saving: boolean;
}) {
  const [newOption, setNewOption] = useState("");
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label className="text-xs">Options</Label>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
            <Input
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                onChange(next);
              }}
              disabled={saving}
              className="h-9"
              aria-label={`Option ${i + 1}`}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              disabled={saving}
              aria-label={`Remove option ${opt}`}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newOption.trim()) {
                e.preventDefault();
                onChange([...options, newOption.trim()]);
                setNewOption("");
              }
            }}
            disabled={saving}
            placeholder="New option"
            className="h-9"
            aria-label="New option"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (newOption.trim()) {
                onChange([...options, newOption.trim()]);
                setNewOption("");
              }
            }}
            disabled={saving || !newOption.trim()}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground">
            At least one option is required before saving.
          </p>
        )}
      </div>
    </div>
  );
}

function TextConfigEditor({
  fieldId,
  config,
  showPattern,
  showRows,
  onChange,
  saving,
}: {
  fieldId: string;
  config: Record<string, unknown>;
  showPattern: boolean;
  showRows: boolean;
  onChange: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const num = (v: unknown): string => (v == null ? "" : String(v));
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`minlen-${fieldId}`}>Min length</Label>
        <Input
          id={`minlen-${fieldId}`}
          type="number"
          min={0}
          value={num(config.minLength)}
          onChange={(e) =>
            onChange({
              minLength: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`maxlen-${fieldId}`}>Max length</Label>
        <Input
          id={`maxlen-${fieldId}`}
          type="number"
          min={1}
          value={num(config.maxLength)}
          onChange={(e) =>
            onChange({
              maxLength: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
      {showRows && (
        <div className="space-y-2">
          <Label className="text-xs" htmlFor={`rows-${fieldId}`}>Textarea rows (2–10)</Label>
          <Input
            id={`rows-${fieldId}`}
            type="number"
            min={2}
            max={10}
            value={num(config.rows)}
            onChange={(e) => onChange({ rows: e.target.value === "" ? null : Number(e.target.value) })}
            disabled={saving}
            className="h-10"
          />
          <p className="text-[11px] text-muted-foreground">Height of the answer box.</p>
        </div>
      )}
      {showPattern && (
        <div className="space-y-2 sm:col-span-2">
          <Label className="text-xs" htmlFor={`pattern-${fieldId}`}>Pattern (regex, optional)</Label>
          <Input
            id={`pattern-${fieldId}`}
            value={typeof config.pattern === "string" ? config.pattern : ""}
            onChange={(e) => onChange({ pattern: e.target.value || null })}
            disabled={saving}
            className="h-10 font-mono text-xs"
            placeholder="^[A-Z]{3}-\d{4}$"
          />
          <p className="text-[11px] text-muted-foreground">
            Checked as respondents type — JavaScript regex, applied to short answers.
          </p>
        </div>
      )}
    </>
  );
}

function RangeConfigEditor({
  fieldId,
  config,
  showLabels,
  onChange,
  saving,
}: {
  fieldId: string;
  config: Record<string, unknown>;
  showLabels: boolean;
  onChange: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const num = (v: unknown): string => (v == null ? "" : String(v));
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`min-${fieldId}`}>Min</Label>
        <Input
          id={`min-${fieldId}`}
          type="number"
          value={num(config.min)}
          onChange={(e) =>
            onChange({ min: e.target.value === "" ? null : Number(e.target.value) })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`max-${fieldId}`}>Max</Label>
        <Input
          id={`max-${fieldId}`}
          type="number"
          value={num(config.max)}
          onChange={(e) =>
            onChange({ max: e.target.value === "" ? null : Number(e.target.value) })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`step-${fieldId}`}>Step</Label>
        <Input
          id={`step-${fieldId}`}
          type="number"
          min={0.01}
          step="any"
          value={num(config.step)}
          onChange={(e) =>
            onChange({ step: e.target.value === "" ? null : Number(e.target.value) })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
      {showLabels && (
        <>
          <div className="space-y-2">
            <Label className="text-xs" htmlFor={`leftlabel-${fieldId}`}>Left label (optional)</Label>
            <Input
              id={`leftlabel-${fieldId}`}
              value={typeof config.leftLabel === "string" ? config.leftLabel : ""}
              onChange={(e) => onChange({ leftLabel: e.target.value || null })}
              disabled={saving}
              className="h-10"
              placeholder="Not at all"
              maxLength={60}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs" htmlFor={`rightlabel-${fieldId}`}>Right label (optional)</Label>
            <Input
              id={`rightlabel-${fieldId}`}
              value={typeof config.rightLabel === "string" ? config.rightLabel : ""}
              onChange={(e) => onChange({ rightLabel: e.target.value || null })}
              disabled={saving}
              className="h-10"
              placeholder="Absolutely"
              maxLength={60}
            />
          </div>
        </>
      )}
    </>
  );
}

function RatingConfigEditor({
  fieldId,
  config,
  onChange,
  saving,
}: {
  fieldId: string;
  config: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const max = typeof config.max === "number" ? config.max : 5;
  return (
    <div className="space-y-2">
      <Label className="text-xs" htmlFor={`rating-max-${fieldId}`}>Maximum rating (2–10)</Label>
      <Input
        id={`rating-max-${fieldId}`}
        type="number"
        min={2}
        max={10}
        value={max}
        onChange={(e) => onChange({ max: e.target.value === "" ? null : Number(e.target.value) })}
        disabled={saving}
        className="h-10"
      />
      <p className="text-[11px] text-muted-foreground">
        {"★".repeat(Math.min(Math.max(max, 0), 10))}
      </p>
    </div>
  );
}

function FileConfigEditor({
  fieldId,
  config,
  onChange,
  saving,
}: {
  fieldId: string;
  config: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const typesStr = Array.isArray(config.allowedTypes)
    ? (config.allowedTypes as string[]).join(", ")
    : "";
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`types-${fieldId}`}>Allowed types (comma-separated)</Label>
        <Input
          id={`types-${fieldId}`}
          value={typesStr}
          onChange={(e) =>
            onChange({
              allowedTypes: e.target.value
                ? e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                : null,
            })
          }
          disabled={saving}
          className="h-10 font-mono text-xs"
          placeholder="image/png, application/pdf"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs" htmlFor={`maxsize-${fieldId}`}>Max size (MB, ≤ 100)</Label>
        <Input
          id={`maxsize-${fieldId}`}
          type="number"
          min={1}
          max={100}
          value={typeof config.maxSizeMb === "number" ? config.maxSizeMb : ""}
          onChange={(e) =>
            onChange({
              maxSizeMb: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          disabled={saving}
          className="h-10"
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cleanConfig(
  kind: string,
  _fieldType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  // Remove null/undefined values and empty strings so we never persist
  // junk like {"minLength": null}.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0 && kind !== "select") continue;
    out[k] = v;
  }
  // Selects must keep their options array even when empty is invalid —
  // validation already blocks empty option lists.
  if (kind === "select" && Array.isArray(config.options)) {
    out.options = (config.options as unknown[]).filter(
      (o) => typeof o === "string" && (o as string).trim() !== "",
    );
  }
  return out;
}
