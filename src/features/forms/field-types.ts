/**
 * FormNull — Field Type Registry
 * =====================================================================
 * The manual form builder's source of truth for field types.
 *
 * Every type here maps 1:1 to a `field_type` enum value in the database
 * (migration 002). No type exists in the UI that the DB cannot represent,
 * and no fake types are offered.
 *
 * Each field's type-specific settings live in `form_fields.config` (jsonb)
 * using the typed config model below. Config is validated in the editor
 * before saving so we never write inconsistent structures.
 *
 * ── HONEST-CONFIG PRINCIPLE (Phase 3) ────────────────────────────────
 * A configuration option is only offered when the FULL stack honors it:
 * the builder editor writes it, publish_form() snapshots it (migration
 * 006 passes `config` through), and the public renderer / submit
 * validator in 006 either enforces it (validation) or renders it
 * (presentation). Options 006's submit validator does NOT enforce —
 * e.g. default values, email domain whitelists, select "allow other",
 * multi-select min/max selections, date/time ranges, boolean defaults,
 * multi-file uploads — are deliberately ABSENT rather than fake.
 * Deferred field types (datetime, page_break, signature, address,
 * matrix) are absent from this registry by the same rule.
 */
import type { FieldType } from "@/lib/supabase/types";
import type { LucideIcon } from "lucide-react";
export type { FieldType };
import {
  Type,
  AlignLeft,
  Mail,
  Phone,
  Link2,
  Hash,
  Sigma,
  SquareCheck,
  Calendar,
  Clock,
  ChevronDown,
  ListChecks,
  Star,
  SlidersHorizontal,
  Upload,
  Heading2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Typed config model                                                  */
/* ------------------------------------------------------------------ */

export interface TextConfig {
  minLength?: number;
  maxLength?: number;
  /** Regex source string (only for short_text — enforced at submission). */
  pattern?: string;
  /** Textarea rows (only for long_text — presentation only). */
  rows?: number;
}

export interface NumberConfig {
  min?: number;
  max?: number;
  step?: number;
}

export interface RatingConfig {
  /** Maximum stars/steps. Default 5. Enforced 2–10 at publish + submit. */
  max?: number;
}

export interface ScaleConfig {
  min?: number;
  max?: number;
  step?: number;
  /** Label left of the scale (presentation only, snapshotted + rendered). */
  leftLabel?: string;
  /** Label right of the scale (presentation only, snapshotted + rendered). */
  rightLabel?: string;
}

export interface SelectConfig {
  /** Option values are also the labels (simple model, enforced in 006). */
  options: string[];
}

export interface FileUploadConfig {
  allowedTypes?: string[];
  maxSizeMb?: number;
}

/** Layout fields (section) need no config. */
export type NoConfig = Record<string, never>;

export type FieldConfig =
  | TextConfig
  | NumberConfig
  | RatingConfig
  | ScaleConfig
  | SelectConfig
  | FileUploadConfig
  | NoConfig;

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Library grouping — mirrors the product's mental model. */
export type FieldGroup = "basic" | "choice" | "datetime" | "content" | "advanced";

export interface FieldTypeMeta {
  value: FieldType;
  label: string;
  /** Icon shown in the field library and canvas badges. */
  icon: LucideIcon;
  /** One-line explanation shown in the field library. */
  description: string;
  /** Grouping in the field library. */
  group: FieldGroup;
  /** Which typed config shape this field uses. */
  configKind: "text" | "number" | "rating" | "scale" | "select" | "file" | "none";
  /** Default label applied when the field is first added. */
  defaultLabel: string;
  /**
   * True when the field collects respondent data (participates in
   * submissions). Section is a layout-only field — 006 excludes it
   * from both the submittable set and the "usable fields" count.
   */
  collectsData: boolean;
  /**
   * True when the field can be part of a PUBLISHED form. file_upload
   * is implementable in the builder but blocked at publish time by
   * migration 006 (FILE_UPLOAD_NOT_SUPPORTED) until anonymous upload
   * storage exists — surfaced honestly in the UI, never silently.
   */
  publishable: boolean;
}

export const FIELD_TYPE_REGISTRY: FieldTypeMeta[] = [
  {
    value: "short_text",
    label: "Short text",
    icon: Type,
    description: "Single-line answer for names, titles, short facts.",
    group: "basic",
    configKind: "text",
    defaultLabel: "Short text",
    collectsData: true,
    publishable: true,
  },
  {
    value: "long_text",
    label: "Long text",
    icon: AlignLeft,
    description: "Multi-line answer for open feedback and comments.",
    group: "basic",
    configKind: "text",
    defaultLabel: "Long text",
    collectsData: true,
    publishable: true,
  },
  {
    value: "email",
    label: "Email",
    icon: Mail,
    description: "Email address with built-in format validation.",
    group: "basic",
    configKind: "text",
    defaultLabel: "Email",
    collectsData: true,
    publishable: true,
  },
  {
    value: "phone",
    label: "Phone",
    icon: Phone,
    description: "Phone number, validated as a phone-like string.",
    group: "basic",
    configKind: "text",
    defaultLabel: "Phone",
    collectsData: true,
    publishable: true,
  },
  {
    value: "url",
    label: "Website",
    icon: Link2,
    description: "URL with built-in format validation.",
    group: "basic",
    configKind: "text",
    defaultLabel: "Website",
    collectsData: true,
    publishable: true,
  },
  {
    value: "number",
    label: "Number",
    icon: Hash,
    description: "Whole-number answer with optional min/max/step.",
    group: "basic",
    configKind: "number",
    defaultLabel: "Number",
    collectsData: true,
    publishable: true,
  },
  {
    value: "decimal",
    label: "Decimal",
    icon: Sigma,
    description: "Decimal answer (prices, measurements) with range control.",
    group: "basic",
    configKind: "number",
    defaultLabel: "Decimal",
    collectsData: true,
    publishable: true,
  },
  {
    value: "single_select",
    label: "Dropdown",
    icon: ChevronDown,
    description: "One choice from a list you define.",
    group: "choice",
    configKind: "select",
    defaultLabel: "Dropdown",
    collectsData: true,
    publishable: true,
  },
  {
    value: "multi_select",
    label: "Multi-select",
    icon: ListChecks,
    description: "Any number of choices from a list you define.",
    group: "choice",
    configKind: "select",
    defaultLabel: "Multi-select",
    collectsData: true,
    publishable: true,
  },
  {
    value: "boolean",
    label: "Checkbox",
    icon: SquareCheck,
    description: "A single yes/no style checkbox.",
    group: "choice",
    configKind: "none",
    defaultLabel: "Checkbox",
    collectsData: true,
    publishable: true,
  },
  {
    value: "rating",
    label: "Rating",
    icon: Star,
    description: "Star rating, 2–10 steps, one tap per star.",
    group: "choice",
    configKind: "rating",
    defaultLabel: "Rating",
    collectsData: true,
    publishable: true,
  },
  {
    value: "scale",
    label: "Scale",
    icon: SlidersHorizontal,
    description: "Numbered scale (e.g. 1–10) with optional end labels.",
    group: "choice",
    configKind: "scale",
    defaultLabel: "Scale",
    collectsData: true,
    publishable: true,
  },
  {
    value: "date",
    label: "Date",
    icon: Calendar,
    description: "A calendar date picker.",
    group: "datetime",
    configKind: "none",
    defaultLabel: "Date",
    collectsData: true,
    publishable: true,
  },
  {
    value: "time",
    label: "Time",
    icon: Clock,
    description: "A time of day picker.",
    group: "datetime",
    configKind: "none",
    defaultLabel: "Time",
    collectsData: true,
    publishable: true,
  },
  {
    value: "section",
    label: "Section",
    icon: Heading2,
    description: "A heading + description that organizes your form. Collects no data.",
    group: "content",
    configKind: "none",
    defaultLabel: "Section",
    collectsData: false,
    publishable: true,
  },
  {
    value: "file_upload",
    label: "File upload",
    icon: Upload,
    description: "File picker with type/size limits. Cannot be published yet.",
    group: "advanced",
    configKind: "file",
    defaultLabel: "File upload",
    collectsData: true,
    publishable: false,
  },
];

export const FIELD_GROUPS: { key: FieldGroup; label: string }[] = [
  { key: "basic", label: "Basic" },
  { key: "choice", label: "Choice" },
  { key: "datetime", label: "Date & time" },
  { key: "content", label: "Content" },
  { key: "advanced", label: "Advanced" },
];

export const FIELD_TYPES_BY_GROUP: Record<FieldGroup, FieldTypeMeta[]> =
  FIELD_GROUPS.reduce(
    (acc, g) => {
      acc[g.key] = FIELD_TYPE_REGISTRY.filter((t) => t.group === g.key);
      return acc;
    },
    {} as Record<FieldGroup, FieldTypeMeta[]>,
  );

export function fieldMeta(type: FieldType): FieldTypeMeta | undefined {
  return FIELD_TYPE_REGISTRY.find((t) => t.value === type);
}

export function fieldLabel(type: FieldType): string {
  return fieldMeta(type)?.label ?? type;
}

/* ------------------------------------------------------------------ */
/* Product limits (aligned with migration 006 — documented, not invented) */
/* ------------------------------------------------------------------ */

/**
 * Maximum number of fields on a form. Mirrors publish_form()'s
 * c_max_fields (migration 006, 300). Enforced in the builder UI so the
 * limit is hit while building (with a clear message) rather than as a
 * surprise at publish time.
 */
export const MAX_FIELDS_PER_FORM = 300;

/** Soft warning threshold while building. */
export const FIELD_LIMIT_WARN_AT = 280;

/**
 * Default config for a newly created field of this type.
 *
 * Centralized so EVERY creation path (new-form initial fields, the
 * builder's field library, duplicate) writes the same config shape —
 * no duplicated per-callsite defaults. Select-like types MUST start
 * with a valid options array: validateConfig() rejects an empty/
 * missing options list, and submission rendering depends on it.
 */
export function defaultConfigForType(type: FieldType): Record<string, unknown> {
  switch (type) {
    case "single_select":
    case "multi_select":
      return { options: ["Option 1", "Option 2"] };
    case "rating":
      return { max: 5 };
    case "long_text":
      return { rows: 4 };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ConfigValidation {
  ok: boolean;
  message?: string;
}

/** Bound for presentation-only label configs (scale end labels). */
const MAX_END_LABEL_LEN = 60;

/**
 * Validate a config object against its configKind before writing to the
 * database. Prevents inconsistent structures between field types.
 */
export function validateConfig(
  kind: FieldTypeMeta["configKind"],
  type: FieldType,
  config: Record<string, unknown>,
): ConfigValidation {
  if (kind === "none") return { ok: true };

  if (kind === "select") {
    const options = config.options;
    if (!Array.isArray(options) || options.length === 0) {
      return { ok: false, message: "Add at least one option." };
    }
    const nonEmpty = options.filter(
      (o) => typeof o === "string" && o.trim().length > 0,
    );
    if (nonEmpty.length !== options.length) {
      return { ok: false, message: "Options cannot be empty." };
    }
    const unique = new Set(nonEmpty.map((o) => (o as string).trim()));
    if (unique.size !== nonEmpty.length) {
      return { ok: false, message: "Options must be unique." };
    }
    return { ok: true };
  }

  if (kind === "text") {
    const minL = config.minLength;
    const maxL = config.maxLength;
    if (minL != null && (!Number.isFinite(Number(minL)) || Number(minL) < 0)) {
      return { ok: false, message: "Min length must be 0 or more." };
    }
    if (maxL != null && (!Number.isFinite(Number(maxL)) || Number(maxL) < 1)) {
      return { ok: false, message: "Max length must be 1 or more." };
    }
    if (
      minL != null &&
      maxL != null &&
      Number(minL) > Number(maxL)
    ) {
      return { ok: false, message: "Min length cannot exceed max length." };
    }
    if (type === "short_text" && typeof config.pattern === "string" && config.pattern) {
      try {
        new RegExp(config.pattern as string);
      } catch {
        return { ok: false, message: "Pattern is not a valid regular expression." };
      }
    }
    if (type === "long_text") {
      const rows = config.rows;
      if (
        rows != null &&
        rows !== ("" as unknown) &&
        (!Number.isInteger(Number(rows)) || Number(rows) < 2 || Number(rows) > 10)
      ) {
        return { ok: false, message: "Rows must be a whole number between 2 and 10." };
      }
    }
    return { ok: true };
  }

  if (kind === "number" || kind === "scale") {
    const min = config.min;
    const max = config.max;
    const step = config.step;
    if (min != null && !Number.isFinite(Number(min))) {
      return { ok: false, message: "Min must be a number." };
    }
    if (max != null && !Number.isFinite(Number(max))) {
      return { ok: false, message: "Max must be a number." };
    }
    if (step != null && (!Number.isFinite(Number(step)) || Number(step) <= 0)) {
      return { ok: false, message: "Step must be greater than 0." };
    }
    if (min != null && max != null && Number(min) >= Number(max)) {
      return { ok: false, message: "Min must be less than max." };
    }
    if (kind === "scale") {
      for (const k of ["leftLabel", "rightLabel"] as const) {
        const v = config[k];
        if (typeof v === "string" && v.length > MAX_END_LABEL_LEN) {
          return {
            ok: false,
            message: `${k === "leftLabel" ? "Left" : "Right"} label must be at most ${MAX_END_LABEL_LEN} characters.`,
          };
        }
      }
    }
    return { ok: true };
  }

  if (kind === "rating") {
    const max = config.max;
    if (max != null && (!Number.isInteger(Number(max)) || Number(max) < 2 || Number(max) > 10)) {
      return { ok: false, message: "Rating max must be an integer between 2 and 10." };
    }
    return { ok: true };
  }

  if (kind === "file") {
    const maxSizeMb = config.maxSizeMb;
    if (
      maxSizeMb != null &&
      (!Number.isFinite(Number(maxSizeMb)) || Number(maxSizeMb) <= 0 || Number(maxSizeMb) > 100)
    ) {
      return { ok: false, message: "Max size must be between 0 and 100 MB." };
    }
    const allowedTypes = config.allowedTypes;
    if (
      allowedTypes != null &&
      (!Array.isArray(allowedTypes) ||
        allowedTypes.some((t) => typeof t !== "string"))
    ) {
      return { ok: false, message: "Allowed types must be a list of strings." };
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Width is validated separately — the DB CHECK is width BETWEEN 1 AND 12.
 */
export function validateWidth(width: number): ConfigValidation {
  if (!Number.isInteger(width) || width < 1 || width > 12) {
    return { ok: false, message: "Width must be between 1 and 12." };
  }
  return { ok: true };
}
