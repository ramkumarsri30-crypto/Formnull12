"use client";

/**
 * FormNull — Shared Form Renderer
 * =====================================================================
 * THE single rendering path for FormNull forms. One component, three
 * consumers:
 *
 *   1. Builder canvas  (mode="builder")  — inputs inert, canvas cards
 *      manage selection/reordering around them.
 *   2. Preview dialog  (mode="preview")  — fully interactive with the
 *      same validation the public form runs; submit shows a preview
 *      notice instead of persisting anything.
 *   3. Public form     (mode="public")   — /f/[key] renders the
 *      published snapshot through this exact component and submits via
 *      submit_public_form (migration 006).
 *
 * The renderer input model (`RenderableFormField`) mirrors migration
 * 006's snapshot contract 1:1 — fields are `{key, type, label,
 * description, placeholder, help_text, required, config, sort_order,
 * width}` — so builder rows and published snapshots feed the same
 * component with zero translation drift.
 *
 * ── CLIENT VALIDATION CONTRACT (mirrors 006 exactly) ─────────────────
 * `validateFieldValue` reproduces submit_public_form's per-field rules
 * (lengths, formats, ranges, option membership, step alignment, strict
 * dates). It is a UX convenience, NOT the security boundary — the
 * server re-validates everything and stores only clean, non-empty
 * answers. One deliberate client-side extension: a REQUIRED boolean
 * must be checked (006 accepts `false` as a real answer; "must be
 * checked" is the documented client UX concern). And short_text
 * `pattern` — a JavaScript regex — is enforced here by design: 006
 * documents it as client-enforced because PostgreSQL cannot evaluate
 * JS regex semantics.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Star, Heart, ThumbsUp, Circle, Upload, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database, FieldType } from "@/lib/supabase/types";
import { PhoneControl } from "./phone-control";

/* ------------------------------------------------------------------ */
/* Option labels (Field System 2.0) — config.optionLabels maps a      */
/* stable option VALUE to its display label. Values live in the      */
/* 006-validated `options` array; labels are presentation-only and   */
/* flow through the publish snapshot to the public form. Missing or  */
/* empty labels fall back to the value itself, so pre-rebuild fields */
/* (label === value) render identically.                              */
/* ------------------------------------------------------------------ */

export function optionLabelFor(
  config: Record<string, unknown>,
  value: string,
): string {
  const labels = config.optionLabels;
  if (labels && typeof labels === "object" && !Array.isArray(labels)) {
    const l = (labels as Record<string, unknown>)[value];
    if (typeof l === "string" && l.trim() !== "") return l;
  }
  return value;
}

/** Rating symbols — presentation-only config (config.symbol). */
const RATING_SYMBOLS = {
  star: Star,
  heart: Heart,
  thumb: ThumbsUp,
  circle: Circle,
} as const;

export type RatingSymbol = keyof typeof RATING_SYMBOLS;

export function ratingSymbolOf(config: Record<string, unknown>): RatingSymbol {
  const s = config.symbol;
  return typeof s === "string" && s in RATING_SYMBOLS ? (s as RatingSymbol) : "star";
}

/** Decimal places in a JS number, robust to exponential notation. */
function countDecimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  if (s.includes("e-") || s.includes("E-")) {
    const [m, e] = s.toLowerCase().split("e-");
    const mantissa = m.includes(".") ? m.split(".")[1].length : 0;
    return mantissa + Number(e);
  }
  if (s.includes(".")) return s.split(".")[1].length;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Renderable model (006 snapshot contract)                            */
/* ------------------------------------------------------------------ */

export interface RenderableFormField {
  field_key: string;
  field_type: FieldType;
  label: string;
  description?: string | null;
  placeholder?: string | null;
  help_text?: string | null;
  is_required: boolean;
  width: number;
  config: Record<string, unknown>;
  sort_order: number;
}

export interface RenderableFormHeader {
  name: string;
  description?: string | null;
  settings?: Record<string, unknown> | null;
}

export type FormRendererMode = "builder" | "preview" | "public";

type FormFieldRow = Database["public"]["Tables"]["form_fields"]["Row"];

/** DB row → renderable field (builder + preview path). */
export function toRenderableField(row: FormFieldRow): RenderableFormField {
  return {
    field_key: row.field_key,
    field_type: row.field_type,
    label: row.label,
    description: row.description,
    placeholder: row.placeholder,
    help_text: row.help_text,
    is_required: row.is_required,
    width: row.width,
    config: (row.config ?? {}) as Record<string, unknown>,
    sort_order: row.sort_order,
  };
}

/**
 * 006 snapshot JSON → renderable model (public form path).
 * Returns null when the snapshot is structurally unusable.
 */
export function snapshotToModel(
  snapshot: Record<string, unknown> | null | undefined,
): { form: RenderableFormHeader; fields: RenderableFormField[] } | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const rawFields = snapshot.fields;
  if (!Array.isArray(rawFields)) return null;
  const fields: RenderableFormField[] = [];
  for (const f of rawFields) {
    if (!f || typeof f !== "object") return null;
    const o = f as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.type !== "string" || typeof o.label !== "string") {
      return null;
    }
    fields.push({
      field_key: o.key,
      field_type: o.type as FieldType,
      label: o.label,
      description: typeof o.description === "string" ? o.description : null,
      placeholder: typeof o.placeholder === "string" ? o.placeholder : null,
      help_text: typeof o.help_text === "string" ? o.help_text : null,
      is_required: o.required === true,
      width: typeof o.width === "number" && o.width >= 1 && o.width <= 12 ? o.width : 12,
      config: (o.config && typeof o.config === "object" ? o.config : {}) as Record<string, unknown>,
      sort_order: typeof o.sort_order === "number" ? o.sort_order : 0,
    });
  }
  fields.sort((a, b) => a.sort_order - b.sort_order);
  return {
    form: {
      name: typeof snapshot.name === "string" ? snapshot.name : "",
      description: typeof snapshot.description === "string" ? snapshot.description : null,
      settings: (snapshot.settings && typeof snapshot.settings === "object"
        ? snapshot.settings
        : {}) as Record<string, unknown>,
    },
    fields,
  };
}

/* ------------------------------------------------------------------ */
/* Client-side validation — mirrors submit_public_form (006)            */
/* ------------------------------------------------------------------ */

/** Length caps from 006's constants. */
const CAPS = { email: 320, url: 2048, phone: 25, text: 10000 };

function isBlank(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Step alignment with float tolerance. PostgreSQL's NUMERIC modulo is
 * exact (19.99 % 0.01 = 0); JavaScript floats are not (0.00999...).
 * Comparing the quotient to its nearest integer keeps the client mirror
 * from being STRICTER than 006's server validation.
 */
function isStepAligned(value: number, min: number, step: number): boolean {
  const quotient = (value - min) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

/**
 * Validate one answer against its field, mirroring 006. Returns an
 * error message or null. `undefined` value = no answer yet.
 */
export function validateFieldValue(
  field: RenderableFormField,
  value: unknown,
): string | null {
  const { field_type: t, is_required: req, config } = field;

  if (value === undefined || value === null) {
    return req ? "This field is required." : null;
  }

  switch (t) {
    case "short_text":
    case "long_text":
    case "email":
    case "url":
    case "phone": {
      if (typeof value !== "string") return "Answer must be text.";
      if (isBlank(value)) return req ? "This field is required." : null;
      const cap = t === "email" ? CAPS.email : t === "url" ? CAPS.url : t === "phone" ? CAPS.phone : CAPS.text;
      if (value.length > cap) return `Answer is too long (maximum ${cap} characters).`;
      const minL = num(config.minLength);
      const maxL = num(config.maxLength);
      if (minL !== undefined && minL >= 0 && value.length < minL) {
        return `Answer must be at least ${minL} characters.`;
      }
      if (maxL !== undefined && maxL >= 1 && value.length > maxL) {
        return `Answer must be at most ${maxL} characters.`;
      }
      if (t === "email" && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$/.test(value)) {
        return "Enter a valid email address.";
      }
      if (t === "url" && (!/^https?:\/\//.test(value) || /\s/.test(value))) {
        return "Enter a valid URL (starting with http:// or https://).";
      }
      if (t === "phone") {
        if (!/^[+]?[0-9(). -]{5,25}$/.test(value)) {
          return "Enter a valid phone number (5-25 characters, digits and + ( ) . -).";
        }
        // Client-side UX tightening (same class as the required-checkbox
        // rule): E.164 bounds — 4 to 15 digits total. The server's regex
        // is the backstop, not the ceiling; documented, not invented.
        const digitCount = (value.match(/\d/g) ?? []).length;
        if (digitCount < 4 || digitCount > 15) {
          return "Enter a valid phone number (4 to 15 digits).";
        }
      }
      if (t === "short_text" && typeof config.pattern === "string" && config.pattern) {
        try {
          if (!new RegExp(config.pattern).test(value)) {
            return "Answer does not match the required pattern.";
          }
        } catch {
          /* invalid pattern is a builder-side concern (validateConfig);
             never crash the respondent's form over it */
        }
      }
      return null;
    }

    case "number":
    case "decimal": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Answer must be a number.";
      if (t === "number" && !Number.isInteger(value)) return "Answer must be a whole number.";
      const min = num(config.min);
      const max = num(config.max);
      const step = num(config.step);
      if (min !== undefined && value < min) return `Answer must be ${min} or more.`;
      if (max !== undefined && value > max) return `Answer must be ${max} or less.`;
      if (step !== undefined && step > 0) {
        if (min !== undefined) {
          if (!isStepAligned(value, min, step)) {
            return `Answer must advance in steps of ${step} from ${min}.`;
          }
        } else if (!isStepAligned(value, 0, step)) {
          return `Answer must be a multiple of ${step}.`;
        }
      }
      // Precision (config.precision) — client-side, declared as such in
      // the registry; limits how many decimals a respondent may enter.
      if (t === "decimal") {
        const p = num(config.precision);
        if (
          p !== undefined && Number.isInteger(p) && p >= 0 && p <= 6 &&
          countDecimals(value) > p
        ) {
          return `Answer can have at most ${p} decimal place${p === 1 ? "" : "s"}.`;
        }
      }
      return null;
    }

    case "boolean": {
      if (typeof value !== "boolean") return "Answer must be true or false.";
      // Required checkbox must be CHECKED (client UX concern — see
      // module docs; the server accepts an explicit false).
      if (req && value !== true) return "This field is required.";
      return null;
    }

    case "date": {
      if (typeof value !== "string") return "Answer must be a date.";
      if (isBlank(value)) return req ? "This field is required." : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Use the YYYY-MM-DD date format.";
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return "Enter a real calendar date.";
      return null;
    }

    case "time": {
      if (typeof value !== "string") return "Answer must be a time.";
      if (isBlank(value)) return req ? "This field is required." : null;
      if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
        return "Use the HH:MM or HH:MM:SS 24-hour format.";
      }
      return null;
    }

    case "single_select": {
      if (typeof value !== "string") return "Choose one of the options.";
      if (isBlank(value)) return req ? "This field is required." : null;
      const options = Array.isArray(config.options) ? (config.options as unknown[]) : [];
      if (!options.some((o) => o === value)) return "Not one of the offered options.";
      return null;
    }

    case "multi_select": {
      if (!Array.isArray(value)) return "Answer must be a list of options.";
      if (value.length === 0) return req ? "This field is required." : null;
      const options = Array.isArray(config.options) ? (config.options as unknown[]) : [];
      const seen = new Set<string>();
      for (const v of value) {
        if (typeof v !== "string" || !options.some((o) => o === v)) {
          return "One or more selections are not offered options.";
        }
        if (seen.has(v)) return "Do not select the same option twice.";
        seen.add(v);
      }
      return null;
    }

    case "rating": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Answer must be a number.";
      const cfgMax = num(config.max);
      const max = cfgMax !== undefined && cfgMax >= 2 && cfgMax <= 10 && Number.isInteger(cfgMax) ? cfgMax : 5;
      if (!Number.isInteger(value) || value < 1 || value > max) {
        return `Answer must be a whole number between 1 and ${max}.`;
      }
      return null;
    }

    case "scale": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Answer must be a number.";
      const cMin = num(config.min);
      const cMax = num(config.max);
      const cStep = num(config.step);
      const min = cMin !== undefined ? cMin : 1;
      const max = cMax !== undefined ? cMax : 10;
      const step = cStep !== undefined && cStep > 0 ? cStep : 1;
      if (value < min || value > max) return `Answer must be between ${min} and ${max}.`;
      if (!isStepAligned(value, min, step)) {
        return `Answer must advance in steps of ${step} from ${min}.`;
      }
      return null;
    }

    default:
      return null;
  }
}

/** Validate every field; returns per-key errors (only failing keys). */
export function validateAllValues(
  fields: RenderableFormField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const err = validateFieldValue(f, values[f.field_key]);
    if (err) errors[f.field_key] = err;
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Field control — one visual input per type                           */
/* ------------------------------------------------------------------ */

export function FieldControl({
  field,
  value,
  onChange,
  disabled,
  id: idOverride,
}: {
  field: RenderableFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  /** Unique input id — derived from idPrefix by FieldRenderer so the
      canvas, preview and public page never collide on the same DOM id. */
  id?: string;
}) {
  const t = field.field_type;
  const id = idOverride ?? `fld-${field.field_key}`;
  const cfg = field.config ?? {};

  switch (t) {
    case "short_text":
      return (
        <Input
          id={id}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          disabled={disabled}
          maxLength={CAPS.text}
        />
      );

    case "email":
    case "url":
      return (
        <Input
          id={id}
          type={t === "email" ? "email" : "url"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          disabled={disabled}
          maxLength={t === "email" ? CAPS.email : CAPS.url}
        />
      );

    case "phone":
      return (
        <PhoneControl
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          defaultCountry={cfg.defaultCountry}
        />
      );

    case "long_text": {
      const rows = (() => {
        const r = typeof cfg.rows === "number" ? cfg.rows : 4;
        return r >= 2 && r <= 10 ? Math.round(r) : 4;
      })();
      return (
        <Textarea
          id={id}
          rows={rows}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          disabled={disabled}
          maxLength={CAPS.text}
        />
      );
    }

    case "number":
    case "decimal": {
      const min = typeof cfg.min === "number" ? cfg.min : undefined;
      const max = typeof cfg.max === "number" ? cfg.max : undefined;
      const step =
        typeof cfg.step === "number" && cfg.step > 0 ? cfg.step : t === "decimal" ? "any" : 1;
      return (
        <Input
          id={id}
          type="number"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          placeholder={field.placeholder ?? undefined}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
        />
      );
    }

    case "boolean":
      return (
        <div className="flex items-center gap-2.5 pt-1">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
            disabled={disabled}
            aria-required={field.is_required}
          />
          <Label htmlFor={id} className="cursor-pointer text-sm font-normal text-muted-foreground">
            {field.help_text ?? "Check to agree"}
          </Label>
        </div>
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          disabled={disabled}
        />
      );

    case "time":
      return (
        <Input
          id={id}
          type="time"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          disabled={disabled}
        />
      );

    case "single_select": {
      const options = Array.isArray(cfg.options) ? (cfg.options as unknown[]).filter((o) => typeof o === "string") : [];
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-required={field.is_required}>
            <SelectValue placeholder={field.placeholder ?? "Choose an option"} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => {
              const v = String(o);
              return (
                <SelectItem key={v} value={v}>
                  {optionLabelFor(cfg, v)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }

    case "multi_select": {
      const options = Array.isArray(cfg.options) ? (cfg.options as unknown[]).filter((o) => typeof o === "string") : [];
      const selected = Array.isArray(value) ? (value as unknown[]).filter((v) => typeof v === "string") : [];
      return (
        <div className="space-y-2" role="group" aria-label={field.label}>
          {options.map((o) => {
            const opt = String(o);
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm transition-colors hover:border-foreground/25"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    if (disabled) return;
                    onChange(v === true ? [...selected, opt] : selected.filter((s) => s !== opt));
                  }}
                  disabled={disabled}
                  aria-label={optionLabelFor(cfg, opt)}
                />
                <span>{optionLabelFor(cfg, opt)}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "rating": {
      const max = (() => {
        const m = typeof cfg.max === "number" ? cfg.max : 5;
        return m >= 2 && m <= 10 && Number.isInteger(m) ? Math.round(m) : 5;
      })();
      const SymbolIcon = RATING_SYMBOLS[ratingSymbolOf(cfg)];
      const leftLabel = typeof cfg.leftLabel === "string" ? cfg.leftLabel : null;
      const rightLabel = typeof cfg.rightLabel === "string" ? cfg.rightLabel : null;
      const current = typeof value === "number" ? value : 0;
      return (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1" role="group" aria-label={field.label}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n === current ? undefined : n)}
                disabled={disabled}
                aria-label={`Rate ${n} out of ${max}`}
                aria-pressed={current === n}
                className={cn(
                  "rounded-md p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  n <= current ? "text-[color:var(--memphis-sun)]" : "text-muted-foreground/30",
                )}
              >
                <SymbolIcon className={cn("h-6 w-6", n <= current && "fill-current")} />
              </button>
            ))}
            {current > 0 && (
              <span className="ml-2 text-sm font-semibold text-muted-foreground" aria-live="polite">
                {current}/{max}
              </span>
            )}
          </div>
          {(leftLabel || rightLabel) && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{leftLabel}</span>
              <span>{rightLabel}</span>
            </div>
          )}
        </div>
      );
    }

    case "scale": {
      const min = typeof cfg.min === "number" ? cfg.min : 1;
      const max = typeof cfg.max === "number" ? cfg.max : 10;
      const step = typeof cfg.step === "number" && cfg.step > 0 ? cfg.step : 1;
      const leftLabel = typeof cfg.leftLabel === "string" ? cfg.leftLabel : null;
      const rightLabel = typeof cfg.rightLabel === "string" ? cfg.rightLabel : null;
      const steps: number[] = [];
      for (let v = min; v <= max + 1e-9; v += step) steps.push(Number(v.toFixed(6)));
      const current = typeof value === "number" ? value : undefined;

      // Compact segmented control for small step counts; a slider for
      // large ones (keeps wide scales usable on phones).
      if (steps.length <= 12) {
        return (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
              {steps.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange(current === v ? undefined : v)}
                  disabled={disabled}
                  aria-pressed={current === v}
                  className={cn(
                    "h-9 min-w-9 rounded-lg border-2 px-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                    current === v
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/15 bg-background text-foreground/70 hover:border-foreground/40",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            {(leftLabel || rightLabel) && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{leftLabel}</span>
                <span>{rightLabel}</span>
              </div>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            {leftLabel && <span className="text-xs text-muted-foreground">{leftLabel}</span>}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={current ?? min}
              onChange={(e) => onChange(Number(e.target.value))}
              disabled={disabled}
              aria-label={field.label}
              className="h-2 flex-1 cursor-pointer accent-[color:var(--memphis-coral)]"
            />
            {rightLabel && <span className="text-xs text-muted-foreground">{rightLabel}</span>}
          </div>
          <p className="text-sm font-semibold text-foreground" aria-live="polite">
            {current !== undefined ? current : "—"}
          </p>
        </div>
      );
    }

    case "file_upload": {
      const types = Array.isArray(cfg.allowedTypes) ? (cfg.allowedTypes as string[]).join(", ") : null;
      const maxSize = typeof cfg.maxSizeMb === "number" ? cfg.maxSizeMb : null;
      return (
        <div className="rounded-xl border-2 border-dashed border-foreground/20 bg-background/60 p-4 text-center">
          <Upload className="mx-auto h-5 w-5 text-muted-foreground/60" aria-hidden />
          <p className="mt-1.5 text-sm font-medium text-foreground/80">File upload</p>
          <p className="text-xs text-muted-foreground">
            {types ? `${types} · ` : ""}
            {maxSize ? `up to ${maxSize} MB · ` : ""}
            not available yet
          </p>
        </div>
      );
    }

    case "section":
      return null; // layout-only — rendered by FieldRenderer itself

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* FieldLabelBlock — shared label/description/help/error chrome        */
/* ------------------------------------------------------------------ */

export function FieldLabelBlock({
  field,
  error,
  htmlFor,
}: {
  field: RenderableFormField;
  error?: string;
  htmlFor: string;
}) {
  const showHelp = field.field_type !== "boolean" && field.help_text;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
        {field.label}
        {field.is_required && (
          <span className="ml-0.5 text-[color:var(--memphis-coral)]" aria-label="required">
            *
          </span>
        )}
      </Label>
      {field.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{field.description}</p>
      )}
      {showHelp && <p className="text-xs text-muted-foreground/80">{field.help_text}</p>}
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FieldRenderer — label + control + help + error                      */
/* ------------------------------------------------------------------ */

export function FieldRenderer({
  field,
  value,
  error,
  onChange,
  mode,
  idPrefix = "",
}: {
  field: RenderableFormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  mode: FormRendererMode;
  /** Prepended to every input id — keeps canvas/preview/public DOM ids unique. */
  idPrefix?: string;
}) {
  // Section: a layout divider, never a data field. Always full width.
  if (field.field_type === "section") {
    return (
      <div className="form-field-cell py-2" style={{ "--field-w": 12 } as React.CSSProperties}>
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-[color:var(--memphis-coral)]" aria-hidden />
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

  const id = `${idPrefix}fld-${field.field_key}`;

  return (
    <div
      className="form-field-cell"
      style={{ "--field-w": field.width } as React.CSSProperties}
    >
      <div className="space-y-1.5">
        <FieldLabelBlock field={field} error={error} htmlFor={id} />
        <FieldControl
          field={field}
          value={value}
          onChange={onChange}
          disabled={mode === "builder"}
          id={id}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FormRenderer — the whole form                                       */
/* ------------------------------------------------------------------ */

export function FormRenderer({
  form,
  fields,
  mode,
  onSubmit,
  submitting = false,
  submitNotice,
  className,
  children,
  idPrefix = "",
}: {
  form: RenderableFormHeader;
  fields: RenderableFormField[];
  mode: FormRendererMode;
  /** Called with the validated answers (public: persist; preview: notice). */
  onSubmit?: (values: Record<string, unknown>) => void | Promise<void>;
  submitting?: boolean;
  /** Extra content under the submit button (public page uses it). */
  submitNotice?: ReactNode;
  className?: string;
  children?: ReactNode;
  /** Prepended to every input id — keeps DOM ids unique per context. */
  idPrefix?: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);

  const submitLabel =
    typeof form.settings?.submit_button_label === "string" && form.settings.submit_button_label.trim()
      ? form.settings.submit_button_label.trim().slice(0, 40)
      : "Submit";

  function setValue(key: string, v: unknown) {
    setValues((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[key];
      else next[key] = v;
      return next;
    });
    if (showErrors) {
      const field = fields.find((f) => f.field_key === key);
      if (field) {
        const err = validateFieldValue(field, v);
        setErrors((prev) => {
          const next = { ...prev };
          if (err) next[key] = err;
          else delete next[key];
          return next;
        });
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "builder" || !onSubmit) return;
    const errs = validateAllValues(fields, values);
    setShowErrors(true);
    setErrors(errs);
    const errorKeys = Object.keys(errs);
    if (errorKeys.length > 0) {
      // Focus the first failing field for keyboard/screen-reader users.
      const el = document.getElementById(`${idPrefix}fld-${errorKeys[0]}`);
      el?.focus?.();
      return;
    }
    await onSubmit(values);
  }

  const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);
  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)} noValidate>
      {/* Form header — what respondents see */}
      <header className="mb-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {form.name}
        </h2>
        {form.description && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{form.description}</p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-12">
        {sorted.map((field) => (
          <FieldRenderer
            key={field.field_key}
            field={field}
            value={values[field.field_key]}
            error={showErrors ? errors[field.field_key] : undefined}
            onChange={(v) => setValue(field.field_key, v)}
            mode={mode}
            idPrefix={idPrefix}
          />
        ))}
      </div>

      {children}

      {mode !== "builder" && onSubmit && (
        <div className="mt-8 space-y-3">
          {showErrors && errorCount > 0 && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {errorCount} answer{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention.
            </p>
          )}
          <Button type="submit" variant="memphis-coral" size="lg" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Submitting…" : submitLabel}
          </Button>
          {submitNotice}
        </div>
      )}
    </form>
  );
}
