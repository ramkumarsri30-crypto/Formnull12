/**
 * FormNull — Field System 2.0 Registry
 * =====================================================================
 * THE single source of truth for what a field type IS and what it can
 * be configured to do. Consumers:
 *
 *   - field-library.tsx       which types can be ADDED (status=active)
 *   - field-property-editor   which properties exist per type (schema)
 *   - form-renderer.tsx       renders every type, incl. legacy
 *   - publish/public submit   enforced by migration 006 (server side)
 *
 * ── STATUS MODEL ─────────────────────────────────────────────────────
 *   active : offered in the field library, full Field System 2.0
 *            property depth (first 10 types of the rebuild).
 *   legacy : NOT offered for new fields, but existing forms keep
 *            rendering / editing / publishing / submitting them
 *            through this same registry (compatibility layer — no
 *            destructive migration, no data loss).
 *
 * ── HONEST-PROPERTY PRINCIPLE (extends the Phase 3 rule) ────────────
 * Every PropertyDefinition declares where it lives and who enforces it:
 *
 *   target: "column"  → a real form_fields column (002/006 snapshot)
 *   target: "config"  → a key inside form_fields.config (jsonb)
 *
 *   enforcement:
 *     "server"       → submit_public_form (006) validates it on every
 *                      public submission. Fully honest validation.
 *     "client"       → enforced by the shared renderer only (e.g. the
 *                      short_text JS `pattern`, decimal `precision`).
 *                      Documented as a browser-side check; the server
 *                      still applies its own type/length backstop.
 *     "presentation" → changes rendering only (labels, symbols,
 *                      rows). Flows through the 006 snapshot to the
 *                      public form unchanged.
 *
 * No property is declared unless at least one of those is true. No UI
 * control ships without a real consumer.
 *
 * ── EXTENSION CONTRACT (Logic / Calculations / Themes / Integrations) ──
 * Future systems must be able to reason about fields WITHOUT touching
 * the field model. They consume, they do not rewrite:
 *   - `answerType`  : the JSON shape a submitted answer takes — Logic
 *                     conditions and Calculations branch on this.
 *   - `collectsData`: whether the field participates in submissions.
 *   - `publishable` : whether it can enter a published snapshot.
 * A "card / one-question-at-a-time" form mode consumes the exact same
 * field rows — presentation mode is a renderer concern, never a field
 * definition concern.
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
  CalendarClock,
  Clock,
  ChevronDown,
  ListChecks,
  Star,
  SlidersHorizontal,
  Upload,
  Heading2,
  Gauge,
  ListOrdered,
  MoveHorizontal,
  Table2,
  MapPin,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Property system types                                               */
/* ------------------------------------------------------------------ */

/** Sections render in this order in the property editor. */
export const PROPERTY_SECTION_ORDER = [
  "general",
  "content",
  "options",
  "validation",
  "appearance",
  "behavior",
] as const;

export type PropertySection = (typeof PROPERTY_SECTION_ORDER)[number];

export const SECTION_LABELS: Record<PropertySection, string> = {
  general: "General",
  content: "Content",
  options: "Options",
  validation: "Validation",
  appearance: "Appearance",
  behavior: "Behavior",
};

/** Who guarantees a validation-ish property actually works. */
export type Enforcement = "server" | "client" | "presentation";

/** Widget used by the generic property editor. */
export type PropertyControl =
  | "text"
  | "textarea"
  | "number"
  | "switch"
  | "width"
  | "select"
  | "options-editor"
  | "default-country"
  | "date"
  | "datetime"
  | "config-switch";

export interface PropertyDefinition {
  /** config key (target=config) or column name (target=column). */
  key: string;
  label: string;
  section: PropertySection;
  target: "column" | "config";
  control: PropertyControl;
  enforcement?: Enforcement;
  /** One-line hint under the control. */
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Span both grid columns (labels, long inputs). */
  fullWidth?: boolean;
  /** Only render when the existing config already carries the key —
   *  used to keep managing legacy settings honestly instead of
   *  hiding them (e.g. phone minLength from pre-rebuild fields). */
  visibleWhenPresent?: boolean;
  /** Choices for control="select". */
  choices?: { value: string; label: string }[];
  /** For control="options-editor": which config pair the list edits.
   *  Defaults to options/optionLabels; matrix rows use rows/rowLabels
   *  and columns use columns/columnLabels. */
  optionKeys?: { values: string; labels: string };
  /** For control="config-switch": value used when the key is absent. */
  defaultOn?: boolean;
}

/* ------------------------------------------------------------------ */
/* Field type definition                                               */
/* ------------------------------------------------------------------ */

/** Library grouping for ACTIVE types (the mental model of the rail). */
export type FieldGroup = "text" | "contact" | "numbers" | "choice" | "datetime";

export const FIELD_GROUPS: { key: FieldGroup; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "contact", label: "Contact" },
  { key: "numbers", label: "Numbers" },
  { key: "choice", label: "Choice" },
  { key: "datetime", label: "Date & time" },
];

/**
 * The JSON shape one submitted answer takes. The axis every future
 * Logic / Calculation / Integration ruleset branches on. `"record"` is
 * a map of stable keys to values (matrix: row→column; address: part
 * name→text).
 */
export type AnswerType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "record"
  | "none";

/**
 * Field System 2.0 statuses:
 *   active  : offered in the field library — full end-to-end support
 *             (builder, publish, public form, submission) TODAY.
 *   staged  : fully implemented in the app but NOT offered yet. Their
 *             server contract lands in migration 007 (extending
 *             submit_public_form's submittable-type whitelist). Flip to
 *             active only after 007 is applied and verified — exposing
 *             them before that would ship fields that cannot collect.
 *   legacy  : NOT offered for new fields; existing forms keep working
 *             through this same registry (compatibility layer).
 */
export type FieldStatus = "active" | "staged" | "legacy";

export interface FieldTypeDef {
  value: FieldType;
  label: string;
  icon: LucideIcon;
  /** One-line explanation (library + canvas badges). */
  description: string;
  group?: FieldGroup;
  status: FieldStatus;
  answerType: AnswerType;
  collectsData: boolean;
  publishable: boolean;
  /** submit_public_form (006) accepts answers for this type. Mirrors
   *  006's c_submittable — the public form only sends submittable keys. */
  submittable: boolean;
  defaultLabel: string;
  /** Config written on field creation (selects need valid options). */
  defaultConfig: () => Record<string, unknown>;
  /** The complete property set — exactly what this type supports. */
  properties: PropertyDefinition[];
  /**
   * Static note shown at the top of the Validation section when the
   * type has built-in (non-configurable) server validation.
   */
  validationNote?: string;
}

/* ------------------------------------------------------------------ */
/* Shared limits — mirror migration 006 (documented, never invented)   */
/* ------------------------------------------------------------------ */

export const MAX_FIELDS_PER_FORM = 300;
export const FIELD_LIMIT_WARN_AT = 280;
/** 006 c_max_options — options per select field. */
export const MAX_OPTIONS_PER_FIELD = 100;
/** 006 c_max_option_len — characters per option value. */
export const MAX_OPTION_LEN = 200;
/** 006 c_max_label_len. */
export const MAX_LABEL_LEN = 500;
/** 006 c_max_text_len — description/placeholder/help_text columns. */
export const MAX_TEXT_LEN = 2000;
/** 006 c_max_pattern_len. */
export const MAX_PATTERN_LEN = 512;
/** 006 c_max_cfg_value_len — bound for minLength/maxLength values. */
export const MAX_LENGTH_CFG = 10000;
/** Presentation-only end labels (scale/rating) — kept at the Phase 3
 *  value so old and new fields behave identically. */
export const MAX_END_LABEL_LEN = 60;
/** Cap for presentation-only config values (symbols, labels map). */
export const MAX_PRESENTATION_LEN = 200;

/* ------------------------------------------------------------------ */
/* Reusable property fragments                                         */
/* ------------------------------------------------------------------ */

const P_LABEL: PropertyDefinition = {
  key: "label",
  label: "Label",
  section: "general",
  target: "column",
  control: "text",
  placeholder: "Question shown to respondents",
  fullWidth: true,
};

const P_DESCRIPTION: PropertyDefinition = {
  key: "description",
  label: "Description",
  section: "general",
  target: "column",
  control: "textarea",
  hint: "Extra context under the label",
  placeholder: "Optional",
  fullWidth: true,
};

const P_REQUIRED: PropertyDefinition = {
  key: "is_required",
  label: "Required",
  section: "general",
  target: "column",
  control: "switch",
  hint: "Respondents must fill this in",
};

const P_WIDTH: PropertyDefinition = {
  key: "width",
  label: "Width",
  section: "general",
  target: "column",
  control: "width",
  hint: "How much of a row this field takes",
};

const P_PLACEHOLDER: PropertyDefinition = {
  key: "placeholder",
  label: "Placeholder",
  section: "content",
  target: "column",
  control: "text",
  hint: "Faded example text inside the input",
  placeholder: "Optional",
};

const P_HELP: PropertyDefinition = {
  key: "help_text",
  label: "Help text",
  section: "content",
  target: "column",
  control: "text",
  hint: "Shown under the input",
  placeholder: "Optional",
};

const P_MIN_LENGTH: PropertyDefinition = {
  key: "minLength",
  label: "Min length",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  min: 0,
  max: MAX_LENGTH_CFG,
  hint: "Fewest characters accepted",
};

const P_MAX_LENGTH: PropertyDefinition = {
  key: "maxLength",
  label: "Max length",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  min: 1,
  max: MAX_LENGTH_CFG,
  hint: "Most characters accepted",
};

const P_MIN: PropertyDefinition = {
  key: "min",
  label: "Min",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  hint: "Smallest accepted answer",
};

const P_MAX: PropertyDefinition = {
  key: "max",
  label: "Max",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  hint: "Largest accepted answer",
};

const P_STEP: PropertyDefinition = {
  key: "step",
  label: "Step",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  hint: "Answers must align to steps counting from Min",
  min: 0.000001,
};

/** Rating scale steps (config.max — server-enforced 2..10 by 006). */
const P_RATING_SCALE: PropertyDefinition = {
  key: "max",
  label: "Scale",
  section: "validation",
  target: "config",
  control: "number",
  enforcement: "server",
  min: 2,
  max: 10,
  step: 1,
  hint: "Number of steps — e.g. 5 gives five stars",
};

/* ------------------------------------------------------------------ */
/* THE REGISTRY                                                        */
/* ------------------------------------------------------------------ */

export const FIELD_REGISTRY: FieldTypeDef[] = [
  /* ── ACTIVE (first 10 of the Field System 2.0 rebuild) ─────────── */

  {
    value: "short_text",
    label: "Short text",
    icon: Type,
    description: "Single-line answer for names, titles, short facts.",
    group: "text",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Short text",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_PLACEHOLDER,
      P_HELP,
      P_MIN_LENGTH,
      P_MAX_LENGTH,
      {
        key: "pattern",
        label: "Pattern",
        section: "validation",
        target: "config",
        control: "text",
        enforcement: "client",
        hint: "JavaScript regex checked while respondents type. The server always checks length.",
        placeholder: "^[A-Z]{3}-\\d{4}$",
        fullWidth: true,
      },
    ],
    validationNote:
      "Length rules are enforced on every public submission (server-side).",
  },

  {
    value: "long_text",
    label: "Long text",
    icon: AlignLeft,
    description: "Multi-line answer for open feedback and comments.",
    group: "text",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Long text",
    defaultConfig: () => ({ rows: 4 }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_PLACEHOLDER,
      P_HELP,
      {
        key: "rows",
        label: "Rows",
        section: "appearance",
        target: "config",
        control: "number",
        enforcement: "presentation",
        min: 2,
        max: 10,
        step: 1,
        hint: "Visible height of the answer box (2–10)",
      },
      P_MIN_LENGTH,
      P_MAX_LENGTH,
    ],
    validationNote:
      "Length rules are enforced on every public submission (server-side).",
  },

  {
    value: "email",
    label: "Email",
    icon: Mail,
    description: "Email address with built-in format validation.",
    group: "contact",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Email",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_PLACEHOLDER,
      P_HELP,
    ],
    validationNote:
      "Answers must be a valid email address — checked on every public submission (server-side).",
  },

  {
    value: "phone",
    label: "Phone number",
    icon: Phone,
    description: "International phone number with country selector.",
    group: "contact",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Phone number",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      {
        ...P_PLACEHOLDER,
        hint: "Faded example text inside the number box",
      },
      P_HELP,
      {
        key: "defaultCountry",
        label: "Default country",
        section: "behavior",
        target: "config",
        control: "default-country",
        enforcement: "presentation",
        hint: "Pre-selects the calling code respondents start with",
        fullWidth: true,
      },
      // Pre-rebuild phone fields may carry string length rules (both
      // are server-enforced on the stored international string). Keep
      // them manageable instead of hiding them.
      {
        ...P_MIN_LENGTH,
        hint: "Applies to the full stored number, country code included",
        visibleWhenPresent: true,
      },
      {
        ...P_MAX_LENGTH,
        hint: "Applies to the full stored number, country code included",
        visibleWhenPresent: true,
      },
    ],
    validationNote:
      "Answers are stored as international strings like +91 98765 43210. The format is validated on every public submission (server-side).",
  },

  {
    value: "number",
    label: "Number",
    icon: Hash,
    description: "Whole-number answer with min/max/step control.",
    group: "numbers",
    status: "active",
    answerType: "number",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Number",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_PLACEHOLDER,
      P_HELP,
      P_MIN,
      P_MAX,
      P_STEP,
    ],
    validationNote:
      "Whole-number, range and step rules are enforced on every public submission (server-side).",
  },

  {
    value: "decimal",
    label: "Decimal",
    icon: Sigma,
    description: "Decimal answer (prices, measurements) with range control.",
    group: "numbers",
    status: "active",
    answerType: "number",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Decimal",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_PLACEHOLDER,
      P_HELP,
      P_MIN,
      P_MAX,
      P_STEP,
      {
        key: "precision",
        label: "Precision",
        section: "appearance",
        target: "config",
        control: "number",
        enforcement: "client",
        min: 0,
        max: 6,
        step: 1,
        hint: "Most decimal places respondents can enter (0–6)",
      },
    ],
    validationNote:
      "Range and step rules are enforced on every public submission (server-side). Precision is enforced in the browser.",
  },

  {
    value: "single_select",
    label: "Dropdown",
    icon: ChevronDown,
    description: "One choice from a list you define.",
    group: "choice",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Dropdown",
    defaultConfig: () => ({ options: ["Option 1", "Option 2"] }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      {
        ...P_PLACEHOLDER,
        hint: "Text shown before a choice is made",
      },
      P_HELP,
      {
        key: "options",
        label: "Options",
        section: "options",
        target: "config",
        control: "options-editor",
        enforcement: "server",
        hint: "Each option has a display label and a stable value that is stored in responses",
        fullWidth: true,
      },
    ],
    validationNote:
      "Answers must exactly match one option value — enforced on every public submission (server-side).",
  },

  {
    value: "multi_select",
    label: "Multi-select",
    icon: ListChecks,
    description: "Any number of choices from a list you define.",
    group: "choice",
    status: "active",
    answerType: "string[]",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Multi-select",
    defaultConfig: () => ({ options: ["Option 1", "Option 2"] }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "options",
        label: "Options",
        section: "options",
        target: "config",
        control: "options-editor",
        enforcement: "server",
        hint: "Each option has a display label and a stable value that is stored in responses",
        fullWidth: true,
      },
      {
        key: "ranked",
        label: "Ranking mode",
        section: "behavior",
        target: "config",
        control: "config-switch",
        defaultOn: false,
        hint: "Respondents put every option in order — the answer is stored as an ordered list",
      },
    ],
    validationNote:
      "Answers must match option values, with no duplicates — enforced on every public submission (server-side).",
  },

  {
    value: "boolean",
    label: "Checkbox",
    icon: SquareCheck,
    description: "A single yes/no style checkbox.",
    group: "choice",
    status: "active",
    answerType: "boolean",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Checkbox",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      {
        ...P_REQUIRED,
        hint: "Respondents must check the box to submit",
      },
      P_WIDTH,
      {
        key: "help_text",
        label: "Checkbox text",
        section: "content",
        target: "column",
        control: "text",
        hint: "Shown beside the checkbox — e.g. “I agree”",
        placeholder: "I agree",
      },
    ],
    validationNote:
      "Stored as a real true/false. A required checkbox must be checked in the browser; the server accepts an explicit false.",
  },

  {
    value: "rating",
    label: "Rating",
    icon: Star,
    description: "Tap-a-symbol rating, 2–10 steps.",
    group: "choice",
    status: "active",
    answerType: "number",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Rating",
    defaultConfig: () => ({ max: 5 }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      P_RATING_SCALE,
      {
        key: "symbol",
        label: "Symbol",
        section: "appearance",
        target: "config",
        control: "select",
        enforcement: "presentation",
        choices: [
          { value: "star", label: "Star" },
          { value: "heart", label: "Heart" },
          { value: "thumb", label: "Thumbs up" },
          { value: "circle", label: "Circle" },
        ],
        placeholder: "Star",
        hint: "What respondents tap",
      },
      {
        key: "leftLabel",
        label: "Left label",
        section: "appearance",
        target: "config",
        control: "text",
        enforcement: "presentation",
        placeholder: "Not at all",
      },
      {
        key: "rightLabel",
        label: "Right label",
        section: "appearance",
        target: "config",
        control: "text",
        enforcement: "presentation",
        placeholder: "Absolutely",
      },
    ],
    validationNote:
      "Answers are whole numbers from 1 to the scale — enforced on every public submission (server-side).",
  },

  /* ── PHASE 2 — upgraded legacy types (now active) + staged types ── */

  {
    value: "url",
    label: "Website",
    icon: Link2,
    description: "Web address (https://…) with format validation.",
    group: "text",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Website",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      {
        ...P_PLACEHOLDER,
        placeholder: "https://",
      },
      P_HELP,
      P_MIN_LENGTH,
      P_MAX_LENGTH,
    ],
    validationNote:
      "Answers must be a URL starting with http:// or https:// — enforced on every public submission (server-side).",
  },

  {
    value: "date",
    label: "Date",
    icon: Calendar,
    description: "A calendar date (YYYY-MM-DD) with an optional range.",
    group: "datetime",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Date",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "minDate",
        label: "Earliest date",
        section: "validation",
        target: "config",
        control: "date",
        enforcement: "client",
        hint: "Answers before this date are rejected in the browser",
      },
      {
        key: "maxDate",
        label: "Latest date",
        section: "validation",
        target: "config",
        control: "date",
        enforcement: "client",
        hint: "Answers after this date are rejected in the browser",
      },
    ],
    validationNote:
      "Answers must be real calendar dates in YYYY-MM-DD form — enforced on every public submission (server-side).",
  },

  {
    value: "time",
    label: "Time",
    icon: Clock,
    description: "A time of day picker (24-hour HH:MM).",
    group: "datetime",
    status: "active",
    answerType: "string",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Time",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
    ],
    validationNote:
      "Answers must be 24-hour HH:MM or HH:MM:SS times — enforced on every public submission (server-side).",
  },

  {
    value: "scale",
    label: "Opinion scale",
    icon: SlidersHorizontal,
    description: "Numbered scale respondents tap — 1–5, 0–10, any range.",
    group: "choice",
    status: "active",
    answerType: "number",
    collectsData: true,
    publishable: true,
    submittable: true,
    defaultLabel: "Opinion scale",
    defaultConfig: () => ({ min: 1, max: 5, step: 1 }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      P_MIN,
      P_MAX,
      P_STEP,
      {
        key: "leftLabel",
        label: "Left label",
        section: "appearance",
        target: "config",
        control: "text",
        enforcement: "presentation",
        placeholder: "Not at all",
      },
      {
        key: "rightLabel",
        label: "Right label",
        section: "appearance",
        target: "config",
        control: "text",
        enforcement: "presentation",
        placeholder: "Absolutely",
      },
      {
        key: "style",
        label: "Style",
        section: "appearance",
        target: "config",
        control: "select",
        enforcement: "presentation",
        choices: [
          { value: "buttons", label: "Buttons" },
          { value: "slider", label: "Slider" },
        ],
        placeholder: "Auto",
        hint: "Auto picks buttons for short scales and a slider for long ones",
      },
    ],
    validationNote:
      "Answers must land on a scale step — enforced on every public submission (server-side).",
  },

  /* ── STAGED — implemented, waiting for migration 007 ──────────────
   * These definitions are complete (properties, controls, validation,
   * renderer). They are NOT offered in the field library and publish
   * is blocked for them until 007 (which extends submit_public_form's
   * submittable whitelist) is applied by the owner and verified. Flip
   * status + submittable + publishable to activate after 007.
   * Test rows can be inserted directly via the service key. */

  {
    value: "datetime",
    label: "Date & time",
    icon: CalendarClock,
    description: "A date together with a time of day.",
    group: "datetime",
    status: "staged",
    answerType: "string",
    collectsData: true,
    publishable: false,
    submittable: false,
    defaultLabel: "Date & time",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "minDate",
        label: "Earliest moment",
        section: "validation",
        target: "config",
        control: "datetime",
        enforcement: "client",
        hint: "Answers before this moment are rejected in the browser",
      },
      {
        key: "maxDate",
        label: "Latest moment",
        section: "validation",
        target: "config",
        control: "datetime",
        enforcement: "client",
        hint: "Answers after this moment are rejected in the browser",
      },
    ],
    validationNote:
      "Answers use the YYYY-MM-DD HH:MM local format. Checked in the browser today; server-side enforcement arrives with migration 007 (not yet applied).",
  },

  {
    value: "matrix",
    label: "Matrix",
    icon: Table2,
    description: "A grid of rows and columns — one choice per row.",
    group: "choice",
    status: "staged",
    answerType: "record",
    collectsData: true,
    publishable: false,
    submittable: false,
    defaultLabel: "Matrix",
    defaultConfig: () => ({
      rows: ["Row 1", "Row 2"],
      columns: ["Column 1", "Column 2", "Column 3"],
    }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "rows",
        label: "Rows",
        section: "options",
        target: "config",
        control: "options-editor",
        optionKeys: { values: "rows", labels: "rowLabels" },
        enforcement: "server",
        hint: "Each row has a display label and a stable value stored in responses",
        fullWidth: true,
      },
      {
        key: "columns",
        label: "Columns",
        section: "options",
        target: "config",
        control: "options-editor",
        optionKeys: { values: "columns", labels: "columnLabels" },
        enforcement: "server",
        hint: "Choices offered for every row — one is picked per row",
        fullWidth: true,
      },
    ],
    validationNote:
      "Every row must map to one of the offered columns. Checked in the browser today; server-side enforcement arrives with migration 007 (not yet applied).",
  },

  {
    value: "address",
    label: "Address",
    icon: MapPin,
    description: "Street, city, postal code and country as one answer.",
    group: "contact",
    status: "staged",
    answerType: "record",
    collectsData: true,
    publishable: false,
    submittable: false,
    defaultLabel: "Address",
    defaultConfig: () => ({
      showLine2: false,
      showState: true,
      showPostal: true,
      showCountry: true,
    }),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "showLine2",
        label: "Address line 2",
        section: "appearance",
        target: "config",
        control: "config-switch",
        enforcement: "presentation",
        defaultOn: false,
        hint: "Show the optional second street line",
      },
      {
        key: "showState",
        label: "State / region",
        section: "appearance",
        target: "config",
        control: "config-switch",
        enforcement: "presentation",
        defaultOn: true,
        hint: "Show the state or region input",
      },
      {
        key: "showPostal",
        label: "Postal code",
        section: "appearance",
        target: "config",
        control: "config-switch",
        enforcement: "presentation",
        defaultOn: true,
        hint: "Show the postal code input",
      },
      {
        key: "showCountry",
        label: "Country",
        section: "appearance",
        target: "config",
        control: "config-switch",
        enforcement: "presentation",
        defaultOn: true,
        hint: "Show the country selector",
      },
    ],
    validationNote:
      "A required address needs street, city and country. Checked in the browser today; server-side enforcement arrives with migration 007 (not yet applied).",
  },

  /* ── LEGACY (existing forms only — full compatibility) ─────────── */

  {
    value: "section",
    label: "Section",
    icon: Heading2,
    description: "A heading + description that organizes your form. Collects no data.",
    status: "legacy",
    answerType: "none",
    collectsData: false,
    publishable: true,
    submittable: false,
    defaultLabel: "Section",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      {
        ...P_DESCRIPTION,
        hint: "Shown under the section heading",
      },
      {
        key: "help_text",
        label: "Help text",
        section: "content",
        target: "column",
        control: "text",
        hint: "Smaller note under the description",
        placeholder: "Optional",
      },
    ],
  },

  {
    value: "file_upload",
    label: "File upload",
    icon: Upload,
    description: "File picker with type/size limits. Cannot be published yet.",
    status: "legacy",
    answerType: "string",
    collectsData: true,
    publishable: false,
    submittable: false,
    defaultLabel: "File upload",
    defaultConfig: () => ({}),
    properties: [
      P_LABEL,
      P_DESCRIPTION,
      P_REQUIRED,
      P_WIDTH,
      P_HELP,
      {
        key: "allowedTypes",
        label: "Allowed types",
        section: "options",
        target: "config",
        control: "text",
        enforcement: "presentation",
        hint: "Comma-separated MIME types",
        placeholder: "image/png, application/pdf",
        fullWidth: true,
      },
      {
        key: "maxSizeMb",
        label: "Max size (MB)",
        section: "options",
        target: "config",
        control: "number",
        enforcement: "presentation",
        min: 1,
        max: 100,
      },
    ],
    validationNote:
      "Publishing a form with this field is blocked until anonymous file storage exists (a later phase).",
  },
];

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

export function fieldDef(type: FieldType): FieldTypeDef {
  const def = FIELD_REGISTRY.find((t) => t.value === type);
  if (def) return def;
  // Unreachable while the registry covers the full DB enum; keep the
  // builder honest instead of crashing on future enum values.
  throw new Error(`Unknown field type: ${type}`);
}

export function fieldDefSafe(type: FieldType): FieldTypeDef | undefined {
  return FIELD_REGISTRY.find((t) => t.value === type);
}

/** Types offered in the field library (active only, in group order). */
export const ADDABLE_FIELD_TYPES: FieldTypeDef[] = FIELD_REGISTRY.filter(
  (t) => t.status === "active",
);

export const FIELD_TYPES_BY_GROUP: Record<FieldGroup, FieldTypeDef[]> =
  FIELD_GROUPS.reduce(
    (acc, g) => {
      acc[g.key] = ADDABLE_FIELD_TYPES.filter((t) => t.group === g.key);
      return acc;
    },
    {} as Record<FieldGroup, FieldTypeDef[]>,
  );

/* ------------------------------------------------------------------ */
/* Library presets                                                     */
/* ------------------------------------------------------------------ */

/**
 * A library preset is a ready-to-use starting point for an EXISTING
 * field type — NPS and Slider are both opinion scales, Ranking is a
 * ranked multi-select. This is deliberately NOT a second field-
 * definition architecture: presets only change the defaults a new
 * field is created with (label + config). The FieldTypeDef remains
 * the single source of truth for properties, validation and
 * rendering; answers validate exactly like the base type.
 */
export interface LibraryPreset {
  /** Unique library id (never a FieldType value). */
  id: string;
  type: FieldType;
  label: string;
  icon: LucideIcon;
  description: string;
  group: FieldGroup;
  defaultLabel: string;
  defaultConfig: () => Record<string, unknown>;
}

export const FIELD_PRESETS: LibraryPreset[] = [
  {
    id: "nps",
    type: "scale",
    label: "NPS score",
    icon: Gauge,
    description: "The 0–10 recommendation question with end labels.",
    group: "choice",
    defaultLabel: "How likely are you to recommend us?",
    defaultConfig: () => ({
      min: 0,
      max: 10,
      step: 1,
      leftLabel: "Not likely",
      rightLabel: "Extremely likely",
    }),
  },
  {
    id: "slider",
    type: "scale",
    label: "Slider",
    icon: MoveHorizontal,
    description: "A draggable numeric track instead of tappable buttons.",
    group: "choice",
    defaultLabel: "Slider",
    defaultConfig: () => ({ min: 0, max: 100, step: 1, style: "slider" }),
  },
  {
    id: "ranking",
    type: "multi_select",
    label: "Ranking",
    icon: ListOrdered,
    description: "Respondents put every option in preference order.",
    group: "choice",
    defaultLabel: "Rank your preferences",
    defaultConfig: () => ({
      ranked: true,
      options: ["Option 1", "Option 2", "Option 3"],
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Library entries — what "Add field" actually offers                  */
/* ------------------------------------------------------------------ */

export interface LibraryEntry {
  /** def value or preset id — unique per library. */
  key: string;
  type: FieldType;
  label: string;
  icon: LucideIcon;
  description: string;
  group: FieldGroup;
  defaultLabel: string;
  defaultConfig: () => Record<string, unknown>;
}

function entryFromDef(d: FieldTypeDef): LibraryEntry {
  return {
    key: d.value,
    type: d.value,
    label: d.label,
    icon: d.icon,
    description: d.description,
    group: d.group ?? "text",
    defaultLabel: d.defaultLabel,
    defaultConfig: d.defaultConfig,
  };
}

function entryFromPreset(p: LibraryPreset): LibraryEntry {
  return {
    key: p.id,
    type: p.type,
    label: p.label,
    icon: p.icon,
    description: p.description,
    group: p.group,
    defaultLabel: p.defaultLabel,
    defaultConfig: p.defaultConfig,
  };
}

/** Everything addable in one flat list: active defs + presets. */
export const LIBRARY_ENTRIES: LibraryEntry[] = [
  ...ADDABLE_FIELD_TYPES.map(entryFromDef),
  ...FIELD_PRESETS.map(entryFromPreset),
];

export const LIBRARY_BY_GROUP: Record<FieldGroup, LibraryEntry[]> =
  FIELD_GROUPS.reduce(
    (acc, g) => {
      acc[g.key] = LIBRARY_ENTRIES.filter((e) => e.group === g.key);
      return acc;
    },
    {} as Record<FieldGroup, LibraryEntry[]>,
  );

/** Resolve a library entry back from a saved row's type + config
 *  (used by the builder to describe what a field "is" — e.g. an NPS
 *  preset). Falls back to the base def label. */
export function libraryLabelFor(
  type: FieldType,
  config: Record<string, unknown> | null | undefined,
): string {
  if (type === "scale" && config?.style === "slider") return "Slider";
  if (type === "scale" && config?.min === 0 && config?.max === 10) {
    // NPS-shaped scale (0–10 + likely labels) — only claim NPS when the
    // end labels match the preset, otherwise it is a plain scale.
    const l = typeof config.leftLabel === "string" ? config.leftLabel : "";
    const r = typeof config.rightLabel === "string" ? config.rightLabel : "";
    if (/not.{0,3}likely/i.test(l) && /extremely likely/i.test(r)) return "NPS score";
  }
  if (type === "multi_select" && config?.ranked === true) return "Ranking";
  return fieldDefSafe(type)?.label ?? type;
}

/** Does submit_public_form (006) accept answers for this type? The
 *  public form only sends keys whose type is submittable. */
export function isSubmittableType(type: FieldType): boolean {
  return fieldDefSafe(type)?.submittable ?? false;
}

/* Compatibility aliases (existing call sites). */
export const fieldMeta = fieldDefSafe;
export function fieldLabel(type: FieldType): string {
  return fieldDefSafe(type)?.label ?? type;
}
export function defaultConfigForType(type: FieldType): Record<string, unknown> {
  return fieldDefSafe(type)?.defaultConfig() ?? {};
}

/* ------------------------------------------------------------------ */
/* Config validation — mirrors 006 publish_form's checks so the       */
/* editor blocks invalid configs BEFORE they reach the database       */
/* ------------------------------------------------------------------ */

export interface ConfigValidation {
  ok: boolean;
  message?: string;
}

/**
 * A number 006 can round-trip: its numeric regex is
 * ^-?[0-9]{1,10}([.][0-9]{1,6})?$ — JS floats outside that range
 * (1e21, 1e-8) serialize exponentially and would be rejected at
 * publish time. Catch them here, honestly, up front.
 */
function isRepresentableNumber(v: unknown): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (Math.abs(v) >= 1e10) return false;
  const s = String(v);
  if (s.includes("e") || s.includes("E")) return false;
  const decimals = s.includes(".") ? s.split(".")[1].length : 0;
  return decimals <= 6;
}

function intInRange(v: unknown, min: number, max: number): boolean {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
  );
}

/** Validate an option list (values + labels) for select-like fields. */
export function validateOptions(
  options: string[],
  labels: Record<string, string>,
): ConfigValidation {
  if (!Array.isArray(options) || options.length === 0) {
    return { ok: false, message: "Add at least one option." };
  }
  if (options.length > MAX_OPTIONS_PER_FIELD) {
    return {
      ok: false,
      message: `At most ${MAX_OPTIONS_PER_FIELD} options are allowed.`,
    };
  }
  const seen = new Set<string>();
  for (const v of options) {
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, message: "Option values cannot be empty." };
    }
    if (v.length > MAX_OPTION_LEN) {
      return {
        ok: false,
        message: `Option values must be at most ${MAX_OPTION_LEN} characters.`,
      };
    }
    if (seen.has(v)) {
      return { ok: false, message: "Option values must be unique." };
    }
    seen.add(v);
  }
  for (const [value, label] of Object.entries(labels)) {
    if (typeof label !== "string") continue;
    if (label.length > MAX_PRESENTATION_LEN) {
      return {
        ok: false,
        message: `Option labels must be at most ${MAX_PRESENTATION_LEN} characters.`,
      };
    }
    if (!options.includes(value) && label.trim() !== "") {
      // Stale label entry — harmless at render (never looked up), but
      // keep configs clean.
      return { ok: false, message: "An option label has no matching value." };
    }
  }
  return { ok: true };
}

/**
 * Validate a full config object for a type before writing it to the
 * database. Mirrors publish_form() so nothing valid here can fail
 * there, and nothing invalid here can silently pass there.
 */
function labelMap(v: unknown): Record<string, string> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, string>)
    : {};
}

export function validateConfig(
  type: FieldType,
  config: Record<string, unknown>,
): ConfigValidation {
  switch (type) {
    case "short_text":
    case "long_text":
    case "email":
    case "url":
    case "phone": {
      const minL = config.minLength;
      const maxL = config.maxLength;
      if (
        minL != null &&
        (!intInRange(minL, 0, MAX_LENGTH_CFG))
      ) {
        return {
          ok: false,
          message: `Min length must be a whole number between 0 and ${MAX_LENGTH_CFG}.`,
        };
      }
      if (maxL != null && !intInRange(maxL, 1, MAX_LENGTH_CFG)) {
        return {
          ok: false,
          message: `Max length must be a whole number between 1 and ${MAX_LENGTH_CFG}.`,
        };
      }
      if (minL != null && maxL != null && Number(minL) > Number(maxL)) {
        return { ok: false, message: "Min length cannot exceed max length." };
      }
      if (type === "short_text" && typeof config.pattern === "string" && config.pattern) {
        if (config.pattern.length > MAX_PATTERN_LEN) {
          return {
            ok: false,
            message: `Pattern must be at most ${MAX_PATTERN_LEN} characters.`,
          };
        }
        try {
          new RegExp(config.pattern);
        } catch {
          return { ok: false, message: "Pattern is not a valid regular expression." };
        }
      }
      if (type === "phone" && config.defaultCountry != null) {
        if (typeof config.defaultCountry !== "string" || !/^[A-Z]{2}$/.test(config.defaultCountry)) {
          return { ok: false, message: "Default country must be a 2-letter code." };
        }
      }
      return { ok: true };
    }

    case "number":
    case "decimal":
    case "scale": {
      const { min, max, step } = config;
      if (min != null && !isRepresentableNumber(min)) {
        return { ok: false, message: "Min must be a number (up to 10 digits, 6 decimals)." };
      }
      if (max != null && !isRepresentableNumber(max)) {
        return { ok: false, message: "Max must be a number (up to 10 digits, 6 decimals)." };
      }
      if (step != null && (!isRepresentableNumber(step) || Number(step) <= 0)) {
        return { ok: false, message: "Step must be greater than 0 (up to 6 decimals)." };
      }
      if (min != null && max != null && Number(min) >= Number(max)) {
        return { ok: false, message: "Min must be less than max." };
      }
      if (type === "decimal" && config.precision != null) {
        if (!intInRange(config.precision, 0, 6)) {
          return { ok: false, message: "Precision must be a whole number between 0 and 6." };
        }
      }
      if (type === "scale") {
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

    case "date": {
      const iso = (v: unknown) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
      if (config.minDate != null && !iso(config.minDate)) {
        return { ok: false, message: "Earliest date must be a valid YYYY-MM-DD date." };
      }
      if (config.maxDate != null && !iso(config.maxDate)) {
        return { ok: false, message: "Latest date must be a valid YYYY-MM-DD date." };
      }
      if (
        iso(config.minDate) && iso(config.maxDate) &&
        String(config.minDate) > String(config.maxDate)
      ) {
        return { ok: false, message: "Earliest date must be before the latest date." };
      }
      return { ok: true };
    }

    case "datetime": {
      const iso = (v: unknown) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
      if (config.minDate != null && !iso(config.minDate)) {
        return { ok: false, message: "Earliest moment must be YYYY-MM-DD HH:MM (as picked by the date-time control)." };
      }
      if (config.maxDate != null && !iso(config.maxDate)) {
        return { ok: false, message: "Latest moment must be YYYY-MM-DD HH:MM (as picked by the date-time control)." };
      }
      if (
        iso(config.minDate) && iso(config.maxDate) &&
        String(config.minDate) > String(config.maxDate)
      ) {
        return { ok: false, message: "Earliest moment must be before the latest moment." };
      }
      return { ok: true };
    }

    case "matrix": {
      const rows = Array.isArray(config.rows) ? (config.rows as unknown[]) : null;
      const columns = Array.isArray(config.columns) ? (config.columns as unknown[]) : null;
      if (!rows || !columns) {
        return { ok: false, message: "Matrix needs both rows and columns." };
      }
      const rowCheck = validateOptions(rows.filter((r): r is string => typeof r === "string") as string[], labelMap(config.rowLabels));
      if (!rowCheck.ok) {
        return { ok: false, message: rowCheck.message?.replace("option", "row").replace("Option", "Row") ?? "Invalid rows." };
      }
      const colCheck = validateOptions(columns.filter((c): c is string => typeof c === "string") as string[], labelMap(config.columnLabels));
      if (!colCheck.ok) {
        return { ok: false, message: colCheck.message?.replace("option", "column").replace("Option", "Column") ?? "Invalid columns." };
      }
      if (rows.length === 0 || columns.length === 0) {
        return { ok: false, message: "Matrix needs at least one row and one column." };
      }
      return { ok: true };
    }

    case "address": {
      for (const k of ["showLine2", "showState", "showPostal", "showCountry"] as const) {
        if (config[k] != null && typeof config[k] !== "boolean") {
          return { ok: false, message: "Address part visibility must be on or off." };
        }
      }
      return { ok: true };
    }

    case "single_select":
    case "multi_select": {
      const options = Array.isArray(config.options)
        ? (config.options as unknown[])
        : [];
      const labels =
        config.optionLabels && typeof config.optionLabels === "object"
          ? (config.optionLabels as Record<string, string>)
          : {};
      const allStrings = options.every((o) => typeof o === "string");
      if (!allStrings) {
        return { ok: false, message: "Option values must be plain strings." };
      }
      return validateOptions(options as string[], labels);
    }

    case "rating": {
      const max = config.max;
      if (max != null && !intInRange(max, 2, 10)) {
        return { ok: false, message: "Scale must be a whole number between 2 and 10." };
      }
      const symbol = config.symbol;
      if (
        symbol != null &&
        !["star", "heart", "thumb", "circle"].includes(String(symbol))
      ) {
        return { ok: false, message: "Unknown rating symbol." };
      }
      for (const k of ["leftLabel", "rightLabel"] as const) {
        const v = config[k];
        if (typeof v === "string" && v.length > MAX_END_LABEL_LEN) {
          return {
            ok: false,
            message: `${k === "leftLabel" ? "Left" : "Right"} label must be at most ${MAX_END_LABEL_LEN} characters.`,
          };
        }
      }
      return { ok: true };
    }

    case "file_upload": {
      const maxSizeMb = config.maxSizeMb;
      if (
        maxSizeMb != null &&
        (!Number.isFinite(Number(maxSizeMb)) ||
          Number(maxSizeMb) <= 0 ||
          Number(maxSizeMb) > 100)
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

    default:
      return { ok: true };
  }
}

/** Width is validated separately — the DB CHECK is 1..12. */
export function validateWidth(width: number): ConfigValidation {
  if (!Number.isInteger(width) || width < 1 || width > 12) {
    return { ok: false, message: "Width must be between 1 and 12." };
  }
  return { ok: true };
}
