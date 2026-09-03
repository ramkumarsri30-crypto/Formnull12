/**
 * FormNull — Field Type Registry (Phase 2)
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
 */
import type { FieldType } from "@/lib/supabase/types";

/* ------------------------------------------------------------------ */
/* Typed config model                                                  */
/* ------------------------------------------------------------------ */

export interface TextConfig {
  minLength?: number;
  maxLength?: number;
  /** Regex source string (only for short_text). */
  pattern?: string;
}

export interface NumberConfig {
  min?: number;
  max?: number;
  step?: number;
}

export interface RatingConfig {
  /** Maximum stars/steps. Default 5. */
  max?: number;
}

export interface ScaleConfig {
  min?: number;
  max?: number;
  step?: number;
}

export interface SelectConfig {
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

export interface FieldTypeMeta {
  value: FieldType;
  label: string;
  /** Short glyph used in the palette button. */
  icon: string;
  /** Grouping in the "Add field" palette. */
  group: "basic" | "choice" | "advanced";
  /** Which typed config shape this field uses. */
  configKind: "text" | "number" | "rating" | "scale" | "select" | "file" | "none";
  /** Default label applied when the field is first added. */
  defaultLabel: string;
}

export const FIELD_TYPE_REGISTRY: FieldTypeMeta[] = [
  { value: "short_text", label: "Short text", icon: "T", group: "basic", configKind: "text", defaultLabel: "Short text" },
  { value: "long_text", label: "Long text", icon: "¶", group: "basic", configKind: "text", defaultLabel: "Long text" },
  { value: "email", label: "Email", icon: "@", group: "basic", configKind: "text", defaultLabel: "Email" },
  { value: "url", label: "Website", icon: "🔗", group: "basic", configKind: "text", defaultLabel: "Website" },
  { value: "phone", label: "Phone", icon: "☏", group: "basic", configKind: "text", defaultLabel: "Phone" },
  { value: "number", label: "Number", icon: "#", group: "basic", configKind: "number", defaultLabel: "Number" },
  { value: "decimal", label: "Decimal", icon: "𝑥", group: "basic", configKind: "number", defaultLabel: "Decimal" },
  { value: "boolean", label: "Checkbox", icon: "✓", group: "basic", configKind: "none", defaultLabel: "Checkbox" },
  { value: "date", label: "Date", icon: "▦", group: "basic", configKind: "none", defaultLabel: "Date" },
  { value: "time", label: "Time", icon: "◔", group: "basic", configKind: "none", defaultLabel: "Time" },
  { value: "single_select", label: "Dropdown", icon: "▾", group: "choice", configKind: "select", defaultLabel: "Dropdown" },
  { value: "multi_select", label: "Multi-select", icon: "☑", group: "choice", configKind: "select", defaultLabel: "Multi-select" },
  { value: "rating", label: "Rating", icon: "★", group: "choice", configKind: "rating", defaultLabel: "Rating" },
  { value: "scale", label: "Scale", icon: "↔", group: "choice", configKind: "scale", defaultLabel: "Scale" },
  { value: "file_upload", label: "File upload", icon: "↥", group: "advanced", configKind: "file", defaultLabel: "File upload" },
  { value: "section", label: "Section", icon: "▤", group: "advanced", configKind: "none", defaultLabel: "Section" },
];

export const FIELD_TYPES_BY_GROUP = {
  basic: FIELD_TYPE_REGISTRY.filter((t) => t.group === "basic"),
  choice: FIELD_TYPE_REGISTRY.filter((t) => t.group === "choice"),
  advanced: FIELD_TYPE_REGISTRY.filter((t) => t.group === "advanced"),
} as const;

export function fieldMeta(type: FieldType): FieldTypeMeta | undefined {
  return FIELD_TYPE_REGISTRY.find((t) => t.value === type);
}

export function fieldLabel(type: FieldType): string {
  return fieldMeta(type)?.label ?? type;
}

/**
 * Default config for a newly created field of this type.
 *
 * Centralized so EVERY creation path (new-form initial fields, the
 * builder's "Add field" palette) writes the same config shape — no
 * duplicated per-callsite defaults. Select-like types MUST start with a
 * valid options array: validateConfig() rejects an empty/missing options
 * list, and submission rendering depends on it.
 */
export function defaultConfigForType(type: FieldType): Record<string, unknown> {
  switch (type) {
    case "single_select":
    case "multi_select":
      return { options: ["Option 1", "Option 2"] };
    case "rating":
      return { max: 5 };
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
