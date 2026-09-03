"use client";

/**
 * FormNull — Option List Editor (Field System 2.0)
 * =====================================================================
 * The option-management system for select-like fields (dropdown,
 * multi-select). Each option has:
 *
 *   LABEL  — what respondents see (free text, rename any time)
 *   VALUE  — the stable machine string stored in submission_values
 *            (auto-derived when the option is created, editable)
 *
 * The option's IDENTITY is its value, never its array index: reorder,
 * rename and delete operate on values, so submissions recorded against
 * old values stay meaningful. Backed by the 006 contract:
 *
 *   config.options      string[]  — the values (publish-validated:
 *                                   unique, non-empty, 1-200 chars)
 *   config.optionLabels {value→label} — presentation-only, flows
 *                                   through the publish snapshot to
 *                                   the public form
 *
 * Reordering uses per-row buttons (always keyboard accessible); the
 * same operations power future drag handles without changing identity
 * semantics.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_OPTION_LEN } from "./field-registry";

export interface OptionRow {
  value: string;
  label: string;
  /** Value has been hand-edited (never auto-derive again). */
  valueEdited: boolean;
}

/* ------------------------------------------------------------------ */
/* Option helpers                                                      */
/* ------------------------------------------------------------------ */

/** Slug for a suggested option value — readable, unique-ified later. */
function suggestValue(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "option";
}

/** rows → { options, optionLabels } (labels kept only when ≠ value). */
export function rowsToConfig(rows: OptionRow[]): {
  options: string[];
  optionLabels: Record<string, string>;
} {
  const options: string[] = [];
  const labels: Record<string, string> = {};
  for (const r of rows) {
    const value = r.value.trim();
    if (!value) continue;
    options.push(value);
    if (r.label.trim() && r.label.trim() !== value) {
      labels[value] = r.label.trim();
    }
  }
  return { options, optionLabels: labels };
}

/** config → rows (missing labels fall back to the value). */
export function configToRows(config: Record<string, unknown>): OptionRow[] {
  const options = Array.isArray(config.options)
    ? (config.options as unknown[]).filter((o): o is string => typeof o === "string")
    : [];
  const rawLabels = config.optionLabels;
  const labels =
    rawLabels && typeof rawLabels === "object" && !Array.isArray(rawLabels)
      ? (rawLabels as Record<string, unknown>)
      : {};
  return options.map((value) => ({
    value,
    label:
      typeof labels[value] === "string" && (labels[value] as string).trim() !== ""
        ? (labels[value] as string)
        : value,
    valueEdited: false,
  }));
}

/** Next unique value for a new option ("blue", "blue_2", …). */
function uniqueValue(base: string, rows: OptionRow[], skipIndex: number): string {
  const taken = new Set(
    rows.filter((_, i) => i !== skipIndex).map((r) => r.value.trim().toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`.toLowerCase())) i += 1;
  return `${base}_${i}`;
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function OptionListEditor({
  rows,
  onChange,
  disabled,
  errors,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
  disabled: boolean;
  /** Field-level validation error surfaced under the list. */
  errors?: string | null;
}) {
  const [nextLabel, setNextLabel] = useState("");

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<string>();
    for (const r of rows) {
      const k = r.value.trim().toLowerCase();
      if (k && seen.has(k)) dups.add(r.value);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return dups;
  }, [rows]);

  function patchRow(i: number, p: Partial<OptionRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  function addOption(label: string) {
    const trimmed = label.trim();
    const display = trimmed || `Option ${rows.length + 1}`;
    const value = uniqueValue(suggestValue(display), rows, -1);
    onChange([...rows, { value, label: display, valueEdited: false }]);
  }

  function removeOption(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  function moveOption(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(j, 0, row);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{rows.length} option{rows.length === 1 ? "" : "s"}</Label>
        <p className="text-[10px] text-muted-foreground/80">reorder · rename · edit value</p>
      </div>

      <ul className="space-y-1.5">
        {rows.map((row, i) => {
          const isDup = duplicates.has(row.value);
          const valueBad = row.value.trim() === "" || row.value.length > MAX_OPTION_LEN;
          return (
            <li
              key={`${i}-${row.value}`}
              className="rounded-xl border border-foreground/10 bg-background p-2"
            >
              <div className="flex items-center gap-1.5">
                {/* Reorder — buttons are the accessible alternative to drag */}
                <div className="flex shrink-0 flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-6"
                    onClick={() => moveOption(i, -1)}
                    disabled={disabled || i === 0}
                    aria-label={`Move option ${row.label || row.value} up`}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-6"
                    onClick={() => moveOption(i, 1)}
                    disabled={disabled || i === rows.length - 1}
                    aria-label={`Move option ${row.label || row.value} down`}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>

                <Input
                  value={row.label}
                  onChange={(e) => {
                    // Auto-derive the value while it was never hand-edited
                    // and still carries a machine-suggested form.
                    const label = e.target.value;
                    if (!row.valueEdited && suggestValue(row.value) === row.value) {
                      const derived = uniqueValue(suggestValue(label), rows, i);
                      patchRow(i, { label, value: derived });
                    } else {
                      patchRow(i, { label });
                    }
                  }}
                  disabled={disabled}
                  className="h-9 min-w-0 flex-1"
                  placeholder={`Option ${i + 1}`}
                  aria-label={`Label for option ${i + 1}`}
                  maxLength={MAX_OPTION_LEN}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOption(i)}
                  disabled={disabled}
                  aria-label={`Delete option ${row.label || row.value}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Stable value — collapsed into a details row per option */}
              <details className="group/details mt-1 pl-11">
                <summary
                  className={cn(
                    "inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground/80",
                    "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <ChevronsUpDown className="h-3 w-3" aria-hidden />
                  value
                </summary>
                <div className="mt-1">
                  <Input
                    value={row.value}
                    onChange={(e) => patchRow(i, { value: e.target.value, valueEdited: true })}
                    disabled={disabled}
                    className={cn(
                      "h-8 font-mono text-[11px]",
                      (isDup || valueBad) && "border-destructive/60 focus-visible:ring-destructive",
                    )}
                    placeholder="stored value"
                    aria-label={`Stored value for option ${i + 1}`}
                    maxLength={MAX_OPTION_LEN}
                  />
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                    Stored in responses. Changing it starts collecting the new value;
                    answers already saved keep the old one.
                    {(isDup || valueBad) && (
                      <span className="ml-1 font-semibold text-destructive">
                        {isDup ? "Values must be unique." : "Value is invalid."}
                      </span>
                    )}
                  </p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      {/* Add option */}
      <div className="flex items-center gap-2">
        <Input
          value={nextLabel}
          onChange={(e) => setNextLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!disabled) {
                addOption(nextLabel);
                setNextLabel("");
              }
            }
          }}
          disabled={disabled}
          placeholder={`Option ${rows.length + 1}`}
          className="h-9"
          aria-label="New option label"
          maxLength={MAX_OPTION_LEN}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            addOption(nextLabel);
            setNextLabel("");
          }}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          At least one option is required before saving.
        </p>
      )}
      {errors && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {errors}
        </p>
      )}
    </div>
  );
}
