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
import { useMemo, useState, type ReactNode } from "react";
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
import { Star, Heart, ThumbsUp, Circle, Upload, Info, CreditCard, ExternalLink, Frame as FrameIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database, FieldType } from "@/lib/supabase/types";
import { PhoneControl } from "./phone-control";
import { COUNTRIES, countryByIso } from "./country-data";
import { FileControl } from "./file-control";
import { SignatureControl } from "./signature-control";
import { readWelcomeSettings, WelcomeScreen } from "./welcome-thankyou";
import { parseVideoEmbed } from "./field-registry";

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
  return labelForPair(config, "optionLabels", value);
}

/** Display label for a stable value from a {value→label} config map. */
export function labelForPair(
  config: Record<string, unknown>,
  labelsKey: string,
  value: string,
): string {
  const labels = config[labelsKey];
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
      // Range bounds — client-declared (006 checks the format + realness
      // server-side; range rules are a builder-side contract).
      const minDate = typeof config.minDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(config.minDate) ? config.minDate : null;
      const maxDate = typeof config.maxDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(config.maxDate) ? config.maxDate : null;
      if (minDate && value < minDate) return `Answer must be on or after ${minDate}.`;
      if (maxDate && value > maxDate) return `Answer must be on or before ${maxDate}.`;
      return null;
    }

    case "datetime": {
      if (typeof value !== "string") return "Answer must be a date and time.";
      if (isBlank(value)) return req ? "This field is required." : null;
      // datetime-local writes "YYYY-MM-DDTHH:MM" — normalized to a space
      // for storage so Postgres can cast it directly.
      const v = value.replace("T", " ");
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) {
        return "Use the YYYY-MM-DD HH:MM format.";
      }
      // ISO-string parsing rejects impossible dates (Feb 30 → NaN),
      // mirroring Postgres's strict ::timestamp cast.
      if (Number.isNaN(new Date(`${v.replace(" ", "T")}:00`).getTime())) {
        return "Enter a real date and time.";
      }
      const min = typeof config.minDate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(config.minDate) ? config.minDate : null;
      const max = typeof config.maxDate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(config.maxDate) ? config.maxDate : null;
      const local = v.replace(" ", "T");
      if (min && local < min) return `Answer must be at or after ${min.replace("T", " ")}.`;
      if (max && local > max) return `Answer must be at or before ${max.replace("T", " ")}.`;
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
      // Ranked multi-select: every option must be placed (client-side
      // ordering contract — the server validates membership + dupes).
      if (config.ranked === true && options.every((o) => typeof o === "string")) {
        const optStrings = options as string[];
        if (value.length !== optStrings.length) {
          return "Rank every option to continue.";
        }
      }
      return null;
    }

    case "matrix": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "Pick one column for each row.";
      }
      const rows = Array.isArray(config.rows) ? (config.rows as unknown[]).filter((r): r is string => typeof r === "string") : [];
      const columns = Array.isArray(config.columns) ? (config.columns as unknown[]).filter((c): c is string => typeof c === "string") : [];
      const answer = value as Record<string, unknown>;
      const answered = Object.keys(answer).filter((k) => answer[k] !== undefined && answer[k] !== null && answer[k] !== "");
      if (answered.length === 0) return req ? "This field is required." : null;
      for (const k of answered) {
        if (!rows.includes(k)) return "One of the rows is no longer offered.";
        if (typeof answer[k] !== "string" || !columns.includes(answer[k] as string)) {
          return "Pick one of the offered columns.";
        }
      }
      if (req) {
        const missing = rows.filter((r) => !answered.includes(r));
        if (missing.length > 0) return "Answer every row to continue.";
      }
      return null;
    }

    case "address": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "Answer must be an address.";
      }
      const answer = value as Record<string, unknown>;
      const part = (k: string): string =>
        typeof answer[k] === "string" ? (answer[k] as string) : "";
      const filled = Object.keys(answer).some((k) => part(k).trim() !== "");
      if (!filled) return req ? "This field is required." : null;
      if (req) {
        if (!part("line1").trim() || !part("city").trim() || !part("country").trim()) {
          return "A required address needs the street, city and country.";
        }
      }
      const caps: Record<string, number> = { line1: 200, line2: 200, city: 200, state: 200, postal_code: 20, country: 60 };
      for (const [k, cap] of Object.entries(caps)) {
        if (part(k).length > cap) {
          return `The ${k.replace("_", " ")} part is too long (at most ${cap} characters).`;
        }
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

    /* ── Field Expansion types (server contract = migration 008) ── */

    case "file_upload": {
      if (!Array.isArray(value)) return "Upload at least one file.";
      if (value.length === 0) return req ? "This field is required." : null;
      const maxFiles = intIn(config.maxFiles, 1, 10) ?? 5;
      if (value.length > maxFiles) {
        return `At most ${maxFiles} file${maxFiles === 1 ? "" : "s"} allowed.`;
      }
      for (const v of value) {
        if (typeof v !== "object" || v === null || typeof (v as { token?: unknown }).token !== "string") {
          return "One of the uploads is still in progress.";
        }
      }
      return null;
    }

    case "signature": {
      if (typeof value !== "string" || value === "") {
        return req ? "Please draw your signature." : null;
      }
      if (!value.startsWith("data:image/png")) {
        return "The signature could not be read — clear it and draw again.";
      }
      return null;
    }

    case "contact_info": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "Fill in your contact details.";
      }
      const answer = value as Record<string, unknown>;
      const part = (k: string): string =>
        typeof answer[k] === "string" ? (answer[k] as string) : "";
      const filled = Object.keys(answer).some((k) => part(k).trim() !== "");
      if (!filled) return req ? "This field is required." : null;
      const parts = strArray(config.parts);
      const requiredParts = strArray(config.requiredParts);
      for (const k of Object.keys(answer)) {
        if (!["first_name", "last_name", "email", "phone"].includes(k)) {
          return "Unknown contact part.";
        }
        if (part(k).length > 200) return `The ${k.replace("_", " ")} part is too long.`;
      }
      for (const rp of requiredParts) {
        if (!part(rp).trim()) {
          return `The ${rp.replace("_", " ")} part is required.`;
        }
      }
      if (part("email").trim() && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$/.test(part("email").trim())) {
        return "Enter a valid email address.";
      }
      if (part("phone").trim()) {
        const digits = (part("phone").match(/\d/g) ?? []).length;
        if (!/^[+]?[0-9(). -]{5,25}$/.test(part("phone").trim()) || digits < 4 || digits > 15) {
          return "Enter a valid phone number.";
        }
      }
      // Only enabled parts may appear.
      if (parts.length > 0 && Object.keys(answer).some((k) => !parts.includes(k))) {
        return "One of the contact parts is no longer offered.";
      }
      return null;
    }

    case "scheduler": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "Pick an available time slot.";
      }
      const answer = value as Record<string, unknown>;
      if (typeof answer.start_at !== "string" || answer.start_at === "") {
        return req ? "Pick an available time slot." : null;
      }
      if (Number.isNaN(new Date(answer.start_at).getTime())) {
        return "The selected slot is not a valid time.";
      }
      return null;
    }

    default:
      return null;
  }
}

/** int config guard shared by the new validation branches. */
function intIn(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** string[] config guard (never throws on malformed snapshots). */
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
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
  mode = "builder",
  formPublicKey = "",
  paymentRef,
}: {
  field: RenderableFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  /** Unique input id — derived from idPrefix by FieldRenderer so the
      canvas, preview and public page never collide on the same DOM id. */
  id?: string;
  /** Rendering context — upload/signature/payment controls behave
   *  differently per surface (builder inert, preview no side effects,
   *  public fully live). */
  mode?: FormRendererMode;
  /** The public form's key (upload-intent RPC needs it). */
  formPublicKey?: string;
  /** Set once a payment for THIS form succeeded (public page only). */
  paymentRef?: string | null;
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
          min={typeof cfg.minDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.minDate) ? cfg.minDate : undefined}
          max={typeof cfg.maxDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.maxDate) ? cfg.maxDate : undefined}
        />
      );

    case "datetime": {
      // Storage form is "YYYY-MM-DD HH:MM" (007's contract); the input
      // works in "YYYY-MM-DDTHH:MM" and the conversion is symmetric.
      const stored = typeof value === "string" ? value.replace(" ", "T") : "";
      return (
        <Input
          id={id}
          type="datetime-local"
          value={/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stored) ? stored : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value.replace("T", " "))}
          disabled={disabled}
          min={typeof cfg.minDate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cfg.minDate) ? cfg.minDate : undefined}
          max={typeof cfg.maxDate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cfg.maxDate) ? cfg.maxDate : undefined}
        />
      );
    }

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
      if (cfg.ranked === true) {
        return (
          <RankedControl
            field={field}
            options={options as string[]}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
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
      const current = typeof value === "number" ? value : undefined;

      // Count steps BEFORE building any array: publish-side rules allow
      // extreme-but-legal ranges (e.g. 0..1e9 step 1e-6), and iterating
      // those out would freeze the tab. Beyond the cap the native range
      // input renders the exact same answer shape with no loop — a
      // presentation-only degradation, validation is unchanged.
      const MAX_BUTTON_STEPS = 200;
      const stepCount =
        step > 0 && max > min ? Math.floor((max - min) / step + 1e-9) + 1 : 1;

      // Presentation style: config.style forces buttons or a slider;
      // unset ("Auto") picks buttons for short scales and a slider for
      // long ones. Same answer shape either way.
      const style =
        stepCount > MAX_BUTTON_STEPS
          ? "slider"
          : cfg.style === "buttons" || cfg.style === "slider"
            ? cfg.style
            : stepCount > 12
              ? "slider"
              : "buttons";

      const steps: number[] = [];
      if (style === "buttons") {
        for (let v = min; v <= max + 1e-9; v += step) {
          steps.push(Number(v.toFixed(6)));
          if (steps.length > MAX_BUTTON_STEPS) break; // hard bound
        }
      }

      if (style === "buttons") {
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

    case "matrix":
      return (
        <MatrixControl
          field={field}
          cfg={cfg}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "address":
      return (
        <AddressControl
          id={id}
          field={field}
          cfg={cfg}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "file_upload":
      return (
        <FileControl
          id={id}
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          mode={mode}
          publicKey={formPublicKey}
        />
      );

    case "signature":
      return (
        <SignatureControl
          id={id}
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          mode={mode}
        />
      );

    case "contact_info":
      return (
        <ContactInfoControl
          id={id}
          field={field}
          cfg={cfg}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "payment":
      return (
        <PaymentDisplay
          field={field}
          cfg={cfg}
          paymentRef={paymentRef}
        />
      );

    case "scheduler":
      return (
        <SchedulerControl
          id={id}
          field={field}
          cfg={cfg}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case "section":
      return null; // layout-only — rendered by FieldRenderer itself

    case "embed":
      return null; // layout-only — rendered by FieldRenderer itself

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* RankedControl — multi_select with ranked=true                       */
/*                                                                      */
/* The answer is an ORDERED string[] (the rank). Clicking an option    */
/* appends it at the next position; up/down reorders; clicking a       */
/* ranked item removes it. Every control is a real button (keyboard    */
/* accessible); the server-side contract is the same multi_select      */
/* validation (membership + no duplicates) with order preserved in     */
/* storage.                                                            */
/* ------------------------------------------------------------------ */

function RankedControl({
  field,
  options,
  value,
  onChange,
  disabled,
}: {
  field: RenderableFormField;
  options: string[];
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const cfg = field.config ?? {};
  const ranked = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const unranked = options.filter((o) => !ranked.includes(o));

  function add(opt: string) {
    if (disabled) return;
    onChange([...ranked, opt]);
  }

  function remove(opt: string) {
    if (disabled) return;
    const next = ranked.filter((r) => r !== opt);
    onChange(next.length === 0 ? undefined : next);
  }

  function move(i: number, dir: -1 | 1) {
    if (disabled) return;
    const j = i + dir;
    if (j < 0 || j >= ranked.length) return;
    const next = [...ranked];
    const [row] = next.splice(i, 1);
    next.splice(j, 0, row);
    onChange(next);
  }

  const labelFor = (opt: string) => optionLabelFor(cfg, opt);

  return (
    <div className="space-y-3" role="group" aria-label={field.label}>
      {ranked.length > 0 && (
        <ul className="space-y-1.5">
          {ranked.map((opt, i) => (
            <li
              key={opt}
              className="flex items-center gap-2 rounded-lg border-2 border-foreground/15 bg-background px-3 py-2"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{labelFor(opt)}</span>
              <span className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`Reorder ${labelFor(opt)}`}>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={disabled || i === 0}
                  aria-label={`Move ${labelFor(opt)} up in ranking`}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                >
                  <span aria-hidden>↑</span>
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={disabled || i === ranked.length - 1}
                  aria-label={`Move ${labelFor(opt)} down in ranking`}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                >
                  <span aria-hidden>↓</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(opt)}
                  disabled={disabled}
                  aria-label={`Remove ${labelFor(opt)} from ranking`}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden>✕</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {unranked.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {ranked.length === 0 ? "Pick in order of preference" : "Still unranked"}
          </p>
          <ul className="space-y-1.5">
            {unranked.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => add(opt)}
                  disabled={disabled}
                  aria-label={`Rank ${labelFor(opt)} ${ranked.length + 1}${ranked.length === 0 ? "st" : ranked.length === 1 ? "nd" : ranked.length === 2 ? "rd" : "th"}`}
                  className="flex w-full items-center gap-2 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-left text-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-foreground/25 text-[11px] font-bold text-muted-foreground"
                    aria-hidden
                  >
                    +
                  </span>
                  <span className="min-w-0 flex-1 truncate">{labelFor(opt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MatrixControl — rows × columns, one column picked per row           */
/*                                                                      */
/* The answer is a { rowValue: columnValue } record. Each row is an    */
/* accessible radiogroup (fieldset + legend) of the column choices.    */
/* ------------------------------------------------------------------ */

function MatrixControl({
  field,
  cfg,
  value,
  onChange,
  disabled,
}: {
  field: RenderableFormField;
  cfg: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const rows = Array.isArray(cfg.rows) ? (cfg.rows as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const columns = Array.isArray(cfg.columns) ? (cfg.columns as unknown[]).filter((c): c is string => typeof c === "string") : [];
  const rawLabels = cfg.rowLabels;
  const rowLabels =
    rawLabels && typeof rawLabels === "object" && !Array.isArray(rawLabels)
      ? (rawLabels as Record<string, string>)
      : {};
  const answer =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};

  function pick(row: string, column: string | undefined) {
    if (disabled) return;
    const next: Record<string, string> = { ...answer };
    if (column === undefined) delete next[row];
    else next[row] = column;
    onChange(Object.keys(next).length === 0 ? undefined : next);
  }

  const rowLabel = (r: string) =>
    typeof rowLabels[r] === "string" && rowLabels[r].trim() !== "" ? rowLabels[r] : r;

  return (
    <div className="space-y-3 overflow-x-auto" role="group" aria-label={field.label}>
      {rows.map((row) => (
        <fieldset key={row} className="min-w-0" disabled={disabled}>
          <legend className="mb-1.5 text-sm font-semibold text-foreground">
            {rowLabel(row)}
          </legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={rowLabel(row)}>
            {columns.map((col) => {
              const selected = answer[row] === col;
              return (
                <label
                  key={col}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-sm transition-colors",
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/15 bg-background text-foreground/80 hover:border-foreground/40",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name={`${field.field_key}-${row}`}
                    checked={selected}
                    onChange={() => pick(row, col)}
                    disabled={disabled}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full border-2",
                      selected ? "border-background" : "border-foreground/40",
                    )}
                    aria-hidden
                  />
                  {labelForPair(cfg, "columnLabels", col)}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AddressControl — structured street / city / postal / country        */
/*                                                                      */
/* The answer is a { part: text } record. Country uses the ISO-code    */
/* selector (same country data as PhoneControl). Line 1 and city are   */
/* always shown; line 2 / state / postal / country follow config.      */
/* ------------------------------------------------------------------ */

function AddressControl({
  id,
  field,
  cfg,
  value,
  onChange,
  disabled,
}: {
  id: string;
  field: RenderableFormField;
  cfg: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const answer =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const part = (k: string): string => (typeof answer[k] === "string" ? (answer[k] as string) : "");
  const show = (k: string, def: boolean): boolean =>
    typeof cfg[k] === "boolean" ? (cfg[k] as boolean) : def;

  function setPart(k: string, v: string) {
    if (disabled) return;
    const next: Record<string, string> = {};
    for (const key of ["line1", "line2", "city", "state", "postal_code", "country"]) {
      const current = part(key);
      if (current.trim() !== "") next[key] = current;
    }
    if (v.trim() !== "") next[k] = v;
    else delete next[k];
    onChange(Object.keys(next).length === 0 ? undefined : next);
  }

  const countryValue = part("country");
  const countryName = countryByIso(countryValue)?.name ?? "";

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-line1`} className="text-xs">
          Address line 1
        </Label>
        <Input
          id={`${id}-line1`}
          value={part("line1")}
          onChange={(e) => setPart("line1", e.target.value)}
          disabled={disabled}
          maxLength={200}
          placeholder="123 Main Street"
          autoComplete="address-line1"
        />
      </div>
      {show("showLine2", false) && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-line2`} className="text-xs">
            Address line 2 <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${id}-line2`}
            value={part("line2")}
            onChange={(e) => setPart("line2", e.target.value)}
            disabled={disabled}
            maxLength={200}
            placeholder="Apartment, suite…"
            autoComplete="address-line2"
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-city`} className="text-xs">
            City
          </Label>
          <Input
            id={`${id}-city`}
            value={part("city")}
            onChange={(e) => setPart("city", e.target.value)}
            disabled={disabled}
            maxLength={200}
            autoComplete="address-level2"
          />
        </div>
        {show("showState", true) && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-state`} className="text-xs">
              State / region
            </Label>
            <Input
              id={`${id}-state`}
              value={part("state")}
              onChange={(e) => setPart("state", e.target.value)}
              disabled={disabled}
              maxLength={200}
              autoComplete="address-level1"
            />
          </div>
        )}
        {show("showPostal", true) && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-postal`} className="text-xs">
              Postal code
            </Label>
            <Input
              id={`${id}-postal`}
              value={part("postal_code")}
              onChange={(e) => setPart("postal_code", e.target.value)}
              disabled={disabled}
              maxLength={20}
              autoComplete="postal-code"
            />
          </div>
        )}
        {show("showCountry", true) && (
          <div className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
              Country
            </Label>
            <Select
              value={countryByIso(countryValue) ? countryValue : undefined}
              onValueChange={(v) => setPart("country", v)}
              disabled={disabled}
            >
              <SelectTrigger id={id} aria-required={field.is_required}>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.iso} value={c.iso}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {countryName && <p className="sr-only">Selected country: {countryName}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ContactInfoControl — composite first/last/email/phone               */
/*                                                                      */
/* The answer is a { part: text } record with only the ENABLED parts   */
/* (config.parts) present. Phone reuses PhoneControl (country select   */
/* + composed international number); email keeps the shared format     */
/* validation. Mirrors 008's server branch exactly.                    */
/* ------------------------------------------------------------------ */

const CONTACT_PART_META: Record<string, { label: string; placeholder: string; autoComplete: string }> = {
  first_name: { label: "First name", placeholder: "Ada", autoComplete: "given-name" },
  last_name: { label: "Last name", placeholder: "Lovelace", autoComplete: "family-name" },
  email: { label: "Email", placeholder: "ada@example.com", autoComplete: "email" },
  phone: { label: "Phone", placeholder: "", autoComplete: "tel" },
};

function ContactInfoControl({
  id,
  field,
  cfg,
  value,
  onChange,
  disabled,
}: {
  id: string;
  field: RenderableFormField;
  cfg: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const parts = strArray(cfg.parts).filter((p) => p in CONTACT_PART_META);
  const requiredParts = strArray(cfg.requiredParts);
  const labels = cfg.partLabels && typeof cfg.partLabels === "object" && !Array.isArray(cfg.partLabels)
    ? (cfg.partLabels as Record<string, string>)
    : {};
  const placeholders = cfg.partPlaceholders && typeof cfg.partPlaceholders === "object" && !Array.isArray(cfg.partPlaceholders)
    ? (cfg.partPlaceholders as Record<string, string>)
    : {};

  const answer =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  function setPart(k: string, v: string) {
    if (disabled) return;
    const next: Record<string, string> = {};
    for (const key of parts) {
      const current = typeof answer[key] === "string" ? (answer[key] as string) : "";
      if (current.trim() !== "") next[key] = current;
    }
    if (v.trim() !== "") next[k] = v;
    else delete next[k];
    onChange(Object.keys(next).length === 0 ? undefined : next);
  }

  const partValue = (k: string): string =>
    typeof answer[k] === "string" ? (answer[k] as string) : "";

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {parts.map((p) => {
          const meta = CONTACT_PART_META[p];
          const label = typeof labels[p] === "string" && labels[p].trim() !== "" ? labels[p] : meta.label;
          const ph =
            typeof placeholders[p] === "string" && placeholders[p].trim() !== ""
              ? placeholders[p]
              : meta.placeholder;
          const required = requiredParts.includes(p);
          const partId = `${id}-${p}`;
          return (
            <div key={p} className={cn("space-y-1.5", (p === "first_name" || p === "email") && parts.length > 1 ? "" : "")}>
              {p === "phone" ? (
                <>
                  <Label htmlFor={partId} className="text-xs">
                    {label}
                    {required && <span className="ml-0.5 text-[color:var(--memphis-coral)]" aria-label="required">*</span>}
                  </Label>
                  <PhoneControl
                    id={partId}
                    value={partValue(p) || undefined}
                    onChange={(v) => setPart(p, typeof v === "string" ? v : "")}
                    disabled={disabled}
                    placeholder={ph || undefined}
                    defaultCountry={cfg.defaultCountry}
                  />
                </>
              ) : (
                <>
                  <Label htmlFor={partId} className="text-xs">
                    {label}
                    {required && <span className="ml-0.5 text-[color:var(--memphis-coral)]" aria-label="required">*</span>}
                  </Label>
                  <Input
                    id={partId}
                    type={p === "email" ? "email" : "text"}
                    value={partValue(p)}
                    onChange={(e) => setPart(p, e.target.value)}
                    disabled={disabled}
                    placeholder={ph || undefined}
                    maxLength={p === "email" ? 320 : 200}
                    autoComplete={meta.autoComplete}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PaymentDisplay — the amount a respondent will be charged            */
/*                                                                      */
/* Display-only by design: charging runs through Stripe Checkout from  */
/* the app's /api/payments/checkout route BEFORE the submission is     */
/* stored, and submit_public_form verifies the succeeded payment row   */
/* server-side. The control never claims a charge happened.            */
/* ------------------------------------------------------------------ */

function PaymentDisplay({
  field,
  cfg,
  paymentRef,
}: {
  field: RenderableFormField;
  cfg: Record<string, unknown>;
  paymentRef?: string | null;
}) {
  const cents = intIn(cfg.amountCents, 50, 10_000_000) ?? 1000;
  const currency = typeof cfg.currency === "string" ? cfg.currency : "USD";
  const amountMode = cfg.amountMode === "minimum" ? "minimum" : "fixed";
  const note = typeof cfg.paymentNote === "string" ? cfg.paymentNote : null;
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
  const paid = typeof paymentRef === "string" && paymentRef !== "";

  return (
    <div
      className="rounded-xl border-2 border-foreground/15 bg-background p-4"
      role="group"
      aria-label={`Payment ${field.label}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--memphis-violet)]/12 text-[color:var(--memphis-violet)]"
            aria-hidden
          >
            <CreditCard className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="font-display text-lg font-bold tabular-nums text-foreground">{amount}</p>
            {amountMode === "minimum" && (
              <p className="text-[11px] text-muted-foreground">minimum amount</p>
            )}
          </div>
        </div>
        {paid ? (
          <span className="rounded-full bg-[color:var(--memphis-mint)]/15 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--memphis-mint)]">
            Payment received
          </span>
        ) : (
          <span className="rounded-full bg-[color:var(--memphis-sun)]/15 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--memphis-sun)]">
            {field.is_required ? "Due at submit" : "Optional"}
          </span>
        )}
      </div>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      {!paid && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
          Secure checkout opens when you submit{field.is_required ? " — the payment must complete before your answers are stored" : ""}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SchedulerControl — date chips + slot grid                           */
/*                                                                      */
/* Slots are computed CLIENT-side in the field's configured timezone   */
/* from config {days, windows, slotMinutes, minNoticeHours,            */
/* maxBookingDays}; the answer is {start_at: ISO instant}. The server  */
/* (008) re-derives and re-validates everything — this is UX only.     */
/* ------------------------------------------------------------------ */

/** Wall-clock parts of an instant, read in a given IANA timezone. */
function wallPartsInZone(date: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hh: Number(parts.hour === "24" ? "0" : parts.hour), mm: Number(parts.minute),
    dow: DOW[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** Minutes a timezone is offset from UTC AT a given instant. */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = wallPartsInZone(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Epoch ms for a wall-clock time in a timezone (two-pass offset). */
function instantFromWall(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMinutes(new Date(guess), tz);
  const candidate = guess - off * 60000;
  // Verify (DST edges can shift the wall time back); accept ±1 min slop.
  const p = wallPartsInZone(new Date(candidate), tz);
  const rebuilt = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  if (Math.abs(rebuilt - candidate) <= 60000) return candidate;
  return guess; // ambiguous wall time — fall back to the naive guess
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function SchedulerControl({
  id,
  field,
  cfg,
  value,
  onChange,
  disabled,
}: {
  id: string;
  field: RenderableFormField;
  cfg: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const tz = typeof cfg.timezone === "string" && cfg.timezone ? cfg.timezone : "UTC";
  const days = cfg.days && Array.isArray(cfg.days)
    ? (cfg.days as unknown[]).filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5];
  const windowsRaw = cfg.windows && Array.isArray(cfg.windows)
    ? (cfg.windows as unknown[]).filter(
        (w): w is { start: string; end: string } =>
          typeof w === "object" && w !== null &&
          typeof (w as { start?: unknown }).start === "string" &&
          typeof (w as { end?: unknown }).end === "string",
      )
    : [];
  const slotMinutes = intIn(cfg.slotMinutes, 5, 240) ?? 30;
  const minNoticeHours = intIn(cfg.minNoticeHours, 0, 720) ?? 0;
  const maxBookingDays = intIn(cfg.maxBookingDays, 1, 365) ?? 30;

  const answer =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { start_at?: unknown })
      : {};
  const selected = typeof answer.start_at === "string" ? answer.start_at : null;

  // Build the bookable day list (wall-clock dates in the field's tz).
  const now = new Date();
  const today = wallPartsInZone(now, tz);
  const daysAhead: { y: number; m: number; d: number; dow: number; key: string; label: string; sub: string }[] = [];
  for (let i = 0; i < Math.min(maxBookingDays, 60); i += 1) {
    const dt = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    const p = wallPartsInZone(dt, tz);
    if (!days.includes(p.dow)) continue;
    daysAhead.push({
      y: p.y, m: p.m, d: p.d, dow: p.dow,
      key: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      label: DOW_LABELS[p.dow],
      sub: new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    });
  }

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const active = daysAhead.find((d) => d.key === activeDay) ?? daysAhead[0] ?? null;

  // Slots for the active day.
  const slots: { iso: string; label: string }[] = [];
  if (active) {
    const earliest = now.getTime() + minNoticeHours * 3600_000;
    for (const w of windowsRaw) {
      const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      const from = toMin(w.start);
      const to = toMin(w.end);
      for (let m = from; m + slotMinutes <= to; m += slotMinutes) {
        const hh = Math.floor(m / 60);
        const mm = m % 60;
        const epoch = instantFromWall(active.y, active.m, active.d, hh, mm, tz);
        if (epoch < earliest) continue;
        slots.push({
          iso: new Date(epoch).toISOString(),
          label: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
        });
      }
    }
    slots.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  }

  return (
    <div className="space-y-3" role="group" aria-label={field.label}>
      {/* Day picker */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Choose a day">
        {daysAhead.map((d) => {
          const isActive = active?.key === d.key;
          return (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setActiveDay(d.key)}
              disabled={disabled}
              className={cn(
                "flex min-w-[3.4rem] shrink-0 flex-col items-center rounded-xl border-2 px-2 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 bg-background text-foreground/80 hover:border-foreground/40",
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide">{d.label}</span>
              <span className="text-xs font-medium">{d.sub}</span>
            </button>
          );
        })}
        {daysAhead.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No bookable days in the next {maxBookingDays} days.
          </p>
        )}
      </div>

      {/* Slot grid */}
      {active && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Times on ${active.key}`}>
          {slots.map((s) => {
            const isSelected = selected === s.iso;
            return (
              <button
                key={s.iso}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(isSelected ? undefined : { start_at: s.iso })}
                disabled={disabled}
                className={cn(
                  "h-9 rounded-lg border-2 px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  isSelected
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/15 bg-background text-foreground/80 hover:border-foreground/40",
                )}
              >
                {s.label}
              </button>
            );
          })}
          {slots.length === 0 && (
            <p className="px-1 py-1.5 text-xs text-muted-foreground">
              No available times on this day — try another.
            </p>
          )}
        </div>
      )}

      {selected && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Selected:{" "}
          <span className="font-semibold text-foreground">
            {new Date(selected).toLocaleString(undefined, { timeZoneName: "short" })}
          </span>
        </p>
      )}
      <p className="sr-only" id={`${id}-hint`}>
        Slots are shown in the schedule timezone {tz}.
      </p>
      <p className="text-[11px] text-muted-foreground/80">
        Times in {tz.replace("_", " ")}
      </p>
    </div>
  );
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
  formPublicKey = "",
  paymentRef,
}: {
  field: RenderableFormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  mode: FormRendererMode;
  /** Prepended to every input id — keeps canvas/preview/public DOM ids unique. */
  idPrefix?: string;
  /** The public form key — threaded to the upload control. */
  formPublicKey?: string;
  /** Succeeded payment reference (public page only). */
  paymentRef?: string | null;
}) {
  // Section: a layout divider, never a data field. Always full width.
  if (field.field_type === "section") {
    const align = field.config?.alignment === "center" ? "center" : "left";
    const showDivider = field.config?.showDivider === true;
    return (
      <div className="form-field-cell py-2" style={{ "--field-w": 12 } as React.CSSProperties}>
        <div className={cn("flex items-center gap-2.5", align === "center" && "justify-center")}>
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-[color:var(--memphis-coral)]" aria-hidden />
          <h3 className="font-display text-lg font-bold text-foreground">{field.label}</h3>
        </div>
        {field.description && (
          <p className={cn("mt-1 text-sm text-muted-foreground", align === "center" && "text-center")}>{field.description}</p>
        )}
        {field.help_text && (
          <p className={cn("mt-0.5 text-xs text-muted-foreground/80", align === "center" && "text-center")}>{field.help_text}</p>
        )}
        {showDivider && <hr className="mt-3 border-0 border-t border-foreground/15" />}
      </div>
    );
  }

  // Embed: a safe presentation block, never a data field. Videos from
  // the YouTube/Vimeo allowlist render a sandboxed privacy player; any
  // other URL renders as a link card. Never arbitrary HTML.
  if (field.field_type === "embed") {
    return <EmbedBlock field={field} mode={mode} />;
  }

  // Page break: a layout divider, never a data field. Always full width.
  // In paged views it renders at the TOP of the page it starts; on the
  // builder canvas it renders inline where it sits in the field order.
  // The default "Page break" label would be noise for respondents, so
  // it renders as a bare divider — any custom label shows as the new
  // page's heading.
  if (field.field_type === "page_break") {
    const showLabel =
      field.label.trim() !== "" && !/^page\s*break$/i.test(field.label.trim());
    return (
      <div className="form-field-cell py-3" style={{ "--field-w": 12 } as React.CSSProperties}>
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
          mode={mode}
          formPublicKey={formPublicKey}
          paymentRef={paymentRef}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmbedBlock — allowlisted video player or safe link card             */
/* ------------------------------------------------------------------ */

const EMBED_ASPECT: Record<string, string> = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
};

export function EmbedBlock({
  field,
  mode,
}: {
  field: RenderableFormField;
  mode: FormRendererMode;
}) {
  const cfg = field.config ?? {};
  const embedType = cfg.embedType === "link" ? "link" : "video";
  const url = typeof cfg.url === "string" ? cfg.url : "";
  const aspect = EMBED_ASPECT[typeof cfg.aspectRatio === "string" ? cfg.aspectRatio : "16:9"] ?? "16 / 9";
  const linkText =
    typeof cfg.linkText === "string" && cfg.linkText.trim() !== "" ? cfg.linkText : "Open link";
  const video = embedType === "video" && url ? parseVideoEmbed(url) : null;
  const title = field.label || "Embedded content";

  if (!url) {
    return (
      <div className="form-field-cell py-2" style={{ "--field-w": 12 } as React.CSSProperties}>
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-dashed border-foreground/20 bg-background/60 p-4">
          <FrameIcon className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground/80">{title}</p>
            <p className="text-xs text-muted-foreground">
              {embedType === "video" ? "Add a YouTube or Vimeo link" : "Add a link"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (video) {
    return (
      <div className="form-field-cell py-2" style={{ "--field-w": 12 } as React.CSSProperties}>
        <div
          className="overflow-hidden rounded-xl border-2 border-foreground/10 bg-background"
          style={{ aspectRatio: aspect }}
        >
          <iframe
            src={video.src}
            title={title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            className="h-full w-full border-0"
          />
        </div>
        {field.description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{field.description}</p>
        )}
      </div>
    );
  }

  // Link card (also the fallback for non-allowlisted "video" URLs).
  return (
    <div className="form-field-cell py-2" style={{ "--field-w": 12 } as React.CSSProperties}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border-2 border-foreground/10 bg-background p-4 transition-colors hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${linkText}: ${title}`}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--memphis-violet)]/12 text-[color:var(--memphis-violet)]"
          aria-hidden
        >
          <ExternalLink className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{url}</span>
        </span>
        {mode !== "builder" && (
          <span className="shrink-0 text-xs font-semibold text-[color:var(--memphis-violet)]">
            {linkText}
          </span>
        )}
      </a>
      {field.description && (
        <p className="mt-1.5 text-sm text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page partitioning — standard mode with page breaks                  */
/*                                                                      */
/* A page break STARTS a new page and renders as that page's           */
/* divider/header. A LEADING page break (nothing before it) stays on    */
/* page one as its header; consecutive page breaks collapse (a page    */
/* whose only content is dividers cannot be split further); a          */
/* TRAILING page break (nothing after it) is dropped from respondent   */
/* views — it would only render an empty final page. Forms without     */
/* page breaks produce ONE page → the exact single-page presentation   */
/* as before (no progress chrome, no Back/Next). The builder canvas    */
/* is always the flat editing list — it never pages.                   */
/* ------------------------------------------------------------------ */

export function buildPages(sortedFields: RenderableFormField[]): RenderableFormField[][] {
  const pages: RenderableFormField[][] = [[]];
  for (const f of sortedFields) {
    const current = pages[pages.length - 1];
    if (
      f.field_type === "page_break" &&
      current.length > 0 &&
      current.some((x) => x.field_type !== "page_break")
    ) {
      pages.push([f]);
    } else {
      current.push(f);
    }
  }
  const last = pages[pages.length - 1];
  if (last.length === 1 && last[0].field_type === "page_break") {
    pages.pop();
  }
  if (pages.length === 0) pages.push([]);
  return pages;
}

/* ------------------------------------------------------------------ */
/* FormRenderer — the whole form                                       */
/*                                                                      */
/* Three PRESENTATION modes share this one renderer, the same field    */
/* definitions, the same validation and the same value model:          */
/*                                                                      */
/*   standard (default) — every field on a single scrolling page       */
/*   paged (standard +  — page breaks split the form into Back/Next    */
/*   page breaks)         pages with a progress bar; per-page          */
/*                         validation on advance                       */
/*   card (settings.mode — one question at a time with Next/Back,      */
/*   === "card")          a progress bar and per-step validation.      */
/*                                                                      */
/* Only the chrome differs; the FieldControl, FieldLabelBlock and      */
/* validateFieldValue are identical everywhere.                        */
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
  serverErrors,
  formPublicKey = "",
  paymentRef,
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
  /** The public form's key — threaded to the file-upload control. */
  formPublicKey?: string;
  /** A succeeded payment reference (public page only). */
  paymentRef?: string | null;
  /**
   * Server-side validation results from submit_public_form's
   * structured failure path (HTTP 200 + ok:false, per-field messages —
   * 006/007's documented contract: "the client renders the per-field
   * messages"). Rendered through the exact same per-field error chrome
   * as client validation so respondents see ONE validation vocabulary.
   * Re-submitting replaces them; editing a field re-validates it.
   */
  serverErrors?: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);

  // Card presentation: respondent-facing only (the builder canvas is the
  // editing surface and always shows the standard list).
  const isCard = mode !== "builder" && form.settings?.mode === "card";
  /** 0 = welcome card, 1..N = field cards (sorted order). */
  const [step, setStep] = useState(0);

  // Welcome screen (settings.welcome — presentation-only config that
  // flows through the publish snapshot wholesale): respondent-facing
  // surfaces start on the welcome; the builder canvas never does.
  const welcome = mode !== "builder" ? readWelcomeSettings(form.settings) : null;
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  // Surface server-rejected answers (submit_public_form's structured
  // ok:false per-field messages) exactly like client-side errors; in
  // card mode also jump back to the first failing question; in paged
  // standard mode also jump to the page holding it. Uses the
  // documented "adjust state when a prop changes" render pattern — the
  // same approach FieldPropertyEditor uses for field switches — so no
  // effect is needed and no extra render is committed.
  const [appliedServerErrors, setAppliedServerErrors] = useState<
    Record<string, string> | null
  >(null);

  const sorted = useMemo(() => [...fields].sort((a, b) => a.sort_order - b.sort_order), [fields]);
  // Card-mode steps: page breaks are MEANINGLESS in card mode (cards are
  // already one-field-per-step — a page break would render as an empty
  // divider card, which the user explicitly rejected). They are filtered
  // OUT here; standard/paged mode keeps splitting at every break. The
  // builder canvas always shows them (flat editing list).
  const cardFields = useMemo(
    () => sorted.filter((f) => f.field_type !== "page_break"),
    [sorted],
  );
  const total = cardFields.length;
  const currentField = step >= 1 && step <= total ? cardFields[step - 1] : null;

  // Paged standard presentation: page breaks split respondent views
  // into Back/Next pages (builder canvas stays the flat editing list;
  // card mode already steps per field — a page break renders as a
  // divider step there). Zero page breaks → ONE page → the exact
  // single-page presentation as before.
  const pages = useMemo(() => buildPages(sorted), [sorted]);
  const isPaged = mode !== "builder" && !isCard && pages.length > 1;
  const [page, setPage] = useState(0);

  if (serverErrors && serverErrors !== appliedServerErrors) {
    setAppliedServerErrors(serverErrors);
    setErrors(serverErrors);
    setShowErrors(true);
    const firstKey = Object.keys(serverErrors)[0];
    if (isCard) {
      // page_breaks are not card steps — index against cardFields.
      const idx = cardFields.findIndex((f) => f.field_key === firstKey);
      if (idx >= 0) setStep(idx + 1);
    } else if (isPaged) {
      const pIdx = pages.findIndex((p) => p.some((f) => f.field_key === firstKey));
      if (pIdx >= 0) setPage(pIdx);
    }
  }

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

    // Card mode: advance one step at a time, validating only the field
    // the respondent is leaving. The final step runs the full submit.
    if (isCard) {
      if (step < total) {
        const f = cardFields[step - 1];
        if (f) {
          const err = validateFieldValue(f, values[f.field_key]);
          setErrors(err ? { [f.field_key]: err } : {});
          setShowErrors(true);
          if (err) {
            const el = document.getElementById(`${idPrefix}fld-${f.field_key}`);
            el?.focus?.();
            return;
          }
        }
        setStep(step + 1);
        return;
      }
      // step === total → fall through to the real submit below.
    }

    // Paged standard mode: advance one page at a time, validating only
    // the fields on the page being left (layout dividers on the page
    // validate as null — they collect nothing). The final page runs the
    // full submit below.
    if (isPaged && page < pages.length - 1) {
      const errs: Record<string, string> = {};
      for (const f of pages[page]) {
        const err = validateFieldValue(f, values[f.field_key]);
        if (err) errs[f.field_key] = err;
      }
      setShowErrors(true);
      setErrors(errs);
      const errorKeys = Object.keys(errs);
      if (errorKeys.length > 0) {
        const el = document.getElementById(`${idPrefix}fld-${errorKeys[0]}`);
        el?.focus?.();
        return;
      }
      setPage(page + 1);
      return;
    }

    const errs = validateAllValues(fields, values);
    setShowErrors(true);
    setErrors(errs);
    const errorKeys = Object.keys(errs);
    if (errorKeys.length > 0) {
      // Focus the first failing field for keyboard/screen-reader users.
      const el = document.getElementById(`${idPrefix}fld-${errorKeys[0]}`);
      el?.focus?.();
      if (isCard) {
        // Jump back to the first card that has a problem.
        const idx = cardFields.findIndex((f) => f.field_key === errorKeys[0]);
        if (idx >= 0) setStep(idx + 1);
      }
      return;
    }
    await onSubmit(values);
  }

  const errorCount = Object.keys(errors).length;

  /* ---------------- Card presentation ---------------- */
  if (isCard) {
    const pct = total > 0 ? Math.round((step / total) * 100) : 100;
    const onLast = step >= total;
    return (
      <form onSubmit={handleSubmit} className={cn("w-full", className)} noValidate>
        {step === 0 ? (
          /* Welcome card — form title, description, Start (or the
             configured welcome screen when settings.welcome is on) */
          welcome ? (
            <WelcomeScreen
              fallbackTitle={form.name}
              fallbackDescription={form.description}
              welcome={welcome}
              onStart={() => setStep(1)}
            />
          ) : (
          <div className="flex min-h-[16rem] flex-col justify-center">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {form.name}
            </h2>
            {form.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {form.description}
              </p>
            )}
            <div className="mt-8">
              {total === 0 && onSubmit ? (
                <Button type="submit" variant="memphis-coral" size="lg" disabled={submitting}>
                  {submitting ? "Submitting…" : submitLabel}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="memphis-coral"
                  size="lg"
                  onClick={() => setStep(1)}
                  autoFocus
                >
                  Start
                </Button>
              )}
              {total === 0 && submitNotice}
            </div>
          </div>
          )
        ) : (
          <div className="flex min-h-[16rem] flex-col">
            {/* Progress */}
            <div className="mb-6">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span aria-live="polite">
                  {step} / {total}
                </span>
                {onLast && <span>Final step</span>}
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={step}
                aria-label={`Question ${step} of ${total}`}
                className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className="h-full rounded-full bg-[color:var(--memphis-coral)] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* The one field (sections/embeds render as statement cards;
                page breaks never reach card mode) */}
            {currentField && (
              <div key={currentField.field_key} className="flex-1">
                <FieldRenderer
                  field={currentField}
                  value={values[currentField.field_key]}
                  error={showErrors ? errors[currentField.field_key] : undefined}
                  onChange={(v) => setValue(currentField.field_key, v)}
                  mode={mode}
                  idPrefix={idPrefix}
                  formPublicKey={formPublicKey}
                  paymentRef={paymentRef}
                />
              </div>
            )}

            {/* Navigation */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={submitting}
              >
                Back
              </Button>
              <Button type="submit" variant="memphis-coral" size="lg" disabled={submitting}>
                {submitting
                  ? "Submitting…"
                  : onLast
                    ? submitLabel
                    : currentField?.field_type === "section" || currentField?.field_type === "embed"
                      ? "Continue"
                      : "Next"}
              </Button>
            </div>

            {children}
            {onLast && submitNotice && (
              <div className="mt-3">{submitNotice}</div>
            )}
            {onLast && showErrors && errorCount > 0 && (
              <p className="mt-3 text-sm font-medium text-destructive" role="alert">
                {errorCount} answer{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention.
              </p>
            )}
          </div>
        )}
      </form>
    );
  }

  /* ---------------- Paged standard presentation ---------------- */
  if (isPaged) {
    const safePage = Math.min(page, pages.length - 1);
    const pageFields = pages[safePage];
    const onLastPage = safePage >= pages.length - 1;
    const pct = Math.round(((safePage + 1) / pages.length) * 100);
    return (
      <form onSubmit={handleSubmit} className={cn("w-full", className)} noValidate>
        {welcome && !welcomeDismissed && safePage === 0 ? (
          <WelcomeScreen
            fallbackTitle={form.name}
            fallbackDescription={form.description}
            welcome={welcome}
            onStart={() => setWelcomeDismissed(true)}
          />
        ) : (
        <>
        {/* Form header — what respondents see */}
        <header className="mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {form.name}
          </h2>
          {form.description && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{form.description}</p>
          )}
        </header>

        {/* Page progress */}
        <div className="mb-6">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span aria-live="polite">
              Page {safePage + 1} of {pages.length}
            </span>
            {onLastPage && <span>Final page</span>}
          </div>
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={pages.length}
            aria-valuenow={safePage + 1}
            aria-label={`Page ${safePage + 1} of ${pages.length}`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
          >
            <div
              className="h-full rounded-full bg-[color:var(--memphis-coral)] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* This page's fields (a page break leads its own page) */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-12">
          {pageFields.map((field) => (
            <FieldRenderer
              key={field.field_key}
              field={field}
              value={values[field.field_key]}
              error={showErrors ? errors[field.field_key] : undefined}
              onChange={(v) => setValue(field.field_key, v)}
              mode={mode}
              idPrefix={idPrefix}
              formPublicKey={formPublicKey}
              paymentRef={paymentRef}
            />
          ))}
        </div>

        {children}

        {onSubmit && (
          <div className="mt-8 space-y-3">
            {showErrors && errorCount > 0 && (
              <p className="text-sm font-medium text-destructive" role="alert">
                {errorCount} answer{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={submitting || safePage === 0}
              >
                Back
              </Button>
              <Button type="submit" variant="memphis-coral" size="lg" disabled={submitting}>
                {submitting ? "Submitting…" : onLastPage ? submitLabel : "Next"}
              </Button>
            </div>
            {submitNotice}
          </div>
        )}
        </>
        )}
      </form>
    );
  }

  /* ---------------- Standard presentation ---------------- */
  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)} noValidate>
      {welcome && !welcomeDismissed ? (
        <WelcomeScreen
          fallbackTitle={form.name}
          fallbackDescription={form.description}
          welcome={welcome}
          onStart={() => setWelcomeDismissed(true)}
        />
      ) : (
      <>
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
            formPublicKey={formPublicKey}
            paymentRef={paymentRef}
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
      </>
      )}
    </form>
  );
}
