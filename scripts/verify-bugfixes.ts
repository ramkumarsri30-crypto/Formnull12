/**
 * verify-bugfixes.ts — targeted checks for the form-builder passes.
 *
 * Run: bun scripts/verify-bugfixes.ts
 *
 * Verifies (no DB, no network — pure registry logic):
 *   1. FIELD_REGISTRY covers every legal field_type enum value
 *      (002's 21 values + 008's 4 additions = 25) so fieldDef() can
 *      never throw "Unknown field type" and crash the builder.
 *   2. Registry flags stay aligned with the live server contract:
 *      006 (14) + 007 (3) + 008 (4: file_upload, signature,
 *      contact_info, scheduler) = 21 submittable types. payment and
 *      embed carry no answer values (gated/presentation types).
 *   3. validateConfig("matrix", …) REJECTS non-string rows/columns
 *      (parity with 007 + selects).
 *   4. Balance-field-type activation (2026-09-05): datetime / matrix /
 *      address / section / page_break are ACTIVE + in the library.
 *   5. buildPages partitions page-break forms the way the paged
 *      renderer expects (leading/trailing/consecutive break rules).
 *   6. Field Expansion (008): the six new capabilities — gating flags,
 *      config validation parity with migration 008's publish branch,
 *      and the video-embed allowlist parser.
 */
import {
  FIELD_REGISTRY,
  ADDABLE_FIELD_TYPES,
  LIBRARY_ENTRIES,
  FIELD_GROUPS,
  fieldDef,
  fieldDefSafe,
  isSubmittableType,
  validateConfig,
  defIsPublishable,
  libraryEntriesFor,
  libraryGroupsFor,
  blockedTypeLabelsFor,
  parseVideoEmbed,
} from "../src/features/forms/field-registry";
import { buildPages } from "../src/features/forms/form-renderer";
import type { RenderableFormField } from "../src/features/forms/form-renderer";
import type { FieldType } from "../src/lib/supabase/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("1) Registry covers the full enum (002 + 008)");
const ALL_TYPES: FieldType[] = [
  "short_text", "long_text", "email", "url", "phone",
  "number", "decimal", "boolean", "single_select", "multi_select",
  "date", "datetime", "time", "rating", "scale", "file_upload",
  "section", "page_break", "signature", "address", "matrix",
  // 008 additions
  "contact_info", "payment", "scheduler", "embed",
];
for (const t of ALL_TYPES) {
  check(`fieldDef("${t}") resolves`, fieldDefSafe(t) !== undefined);
}
check(
  "fieldDef() never throws on any enum value",
  ALL_TYPES.every((t) => {
    try {
      fieldDef(t);
      return true;
    } catch {
      return false;
    }
  }),
);
check(
  "registry has 25 defs (full enum incl. 008)",
  FIELD_REGISTRY.length === ALL_TYPES.length,
  `got ${FIELD_REGISTRY.length}`,
);

console.log("2) Submittable set mirrors 006 (14) + 007 (3) + 008 (4) = 21 types");
const SUBMITTABLE_LIVE: FieldType[] = [
  "short_text", "long_text", "email", "url", "phone",
  "number", "decimal", "boolean", "date", "time",
  "single_select", "multi_select", "rating", "scale",
  // 007 additions (migration verified applied 2026-09-05):
  "datetime", "address", "matrix",
  // 008 additions (server contract = migration 008's c_submittable):
  "file_upload", "signature", "contact_info", "scheduler",
];
for (const t of ALL_TYPES) {
  const expected = SUBMITTABLE_LIVE.includes(t);
  check(
    `isSubmittableType("${t}") === ${expected}`,
    isSubmittableType(t) === expected,
  );
}

console.log("3) validateConfig matrix rejects non-string entries");
check(
  'matrix rows:[123,"Row 1"] rejected',
  !validateConfig("matrix", {
    rows: [123, "Row 1"],
    columns: ["A"],
  } as never).ok,
);
check(
  'matrix columns:["A",null] rejected',
  !validateConfig("matrix", {
    rows: ["Row 1"],
    columns: ["A", null],
  } as never).ok,
);
check(
  "matrix valid rows+columns accepted",
  validateConfig("matrix", {
    rows: ["Row 1", "Row 2"],
    columns: ["A", "B", "C"],
  }).ok,
);

console.log("4) Balance field types: activation state");
for (const t of ["datetime", "matrix", "address", "section", "page_break"] as FieldType[]) {
  check(
    `${t} is status=active`,
    fieldDef(t).status === "active",
    `got ${fieldDef(t).status}`,
  );
  check(
    `${t} offered in ADDABLE_FIELD_TYPES`,
    ADDABLE_FIELD_TYPES.some((d) => d.value === t),
  );
  check(
    `${t} offered in LIBRARY_ENTRIES`,
    LIBRARY_ENTRIES.some((e) => e.type === t),
  );
}
check(
  "section + page_break are publishable layout types (006 census)",
  fieldDef("section").publishable === true &&
    fieldDef("page_break").publishable === true,
);
check(
  "section + page_break collect nothing (submittable=false)",
  !isSubmittableType("section") && !isSubmittableType("page_break"),
);
check(
  "datetime/matrix/address publishable + submittable (007)",
  fieldDef("datetime").publishable &&
    fieldDef("matrix").publishable &&
    fieldDef("address").publishable &&
    isSubmittableType("datetime") &&
    isSubmittableType("matrix") &&
    isSubmittableType("address"),
);
check(
  "signature is a real 008-gated def (active, requiresV008)",
  fieldDef("signature").status === "active" &&
    fieldDef("signature").requiresV008 === true,
);
check(
  "file_upload is a real 008-gated def (active, requiresV008)",
  fieldDef("file_upload").status === "active" &&
    fieldDef("file_upload").requiresV008 === true,
);
check(
  'layout group exists in FIELD_GROUPS',
  FIELD_GROUPS.some((g) => g.key === "layout" && g.label === "Layout"),
);
check(
  "section + page_break live in the layout group",
  fieldDef("section").group === "layout" && fieldDef("page_break").group === "layout",
);

console.log("5) buildPages partitioning rules");
function f(key: string, type: FieldType): RenderableFormField {
  return {
    id: key,
    field_key: key,
    field_type: type,
    label: key,
    description: null,
    placeholder: null,
    help_text: null,
    is_required: false,
    config: {},
    sort_order: 0,
    width: 12,
  };
}
const flat = buildPages([f("a", "short_text"), f("b", "email")]);
check("no page breaks → 1 page", flat.length === 1 && flat[0].length === 2);

const two = buildPages([
  f("a", "short_text"),
  f("pb", "page_break"),
  f("b", "email"),
]);
check(
  "one break mid-form → 2 pages, break leads page 2",
  two.length === 2 &&
    two[0].map((x) => x.field_key).join() === "a" &&
    two[1].map((x) => x.field_key).join() === "pb,b",
);

const leading = buildPages([f("pb", "page_break"), f("a", "short_text")]);
check(
  "leading break stays on page 1 as header",
  leading.length === 1 && leading[0].map((x) => x.field_key).join() === "pb,a",
);

const trailing = buildPages([
  f("a", "short_text"),
  f("pb", "page_break"),
]);
check("trailing break is dropped", trailing.length === 1 && trailing[0].length === 1);

const consecutive = buildPages([
  f("a", "short_text"),
  f("pb1", "page_break"),
  f("pb2", "page_break"),
  f("b", "email"),
]);
check(
  "consecutive breaks collapse into one new page",
  consecutive.length === 2 &&
    consecutive[1].map((x) => x.field_key).join() === "pb1,pb2,b",
);

const onlyBreaks = buildPages([f("pb", "page_break")]);
check(
  "only a page break → single empty page (no crash)",
  onlyBreaks.length === 1 && onlyBreaks[0].length === 0,
);

const empty = buildPages([]);
check("empty form → single empty page", empty.length === 1 && empty[0].length === 0);

console.log("6) Field Expansion (008): gating + config parity + embed parser");

// Capability gating: pre-008 the six new capabilities are hidden and
// publish-blocked; post-008 they are live. Both directions verified.
const V008_TYPES: FieldType[] = [
  "file_upload", "signature", "contact_info", "payment", "scheduler", "embed",
];
for (const t of V008_TYPES) {
  check(`${t} requiresV008`, fieldDef(t).requiresV008 === true);
  check(
    `${t} hidden from library pre-008 (v008=false)`,
    !libraryEntriesFor(false).some((e) => e.type === t),
  );
  check(
    `${t} hidden from library unknown-008 (v008=null)`,
    !libraryEntriesFor(null).some((e) => e.type === t),
  );
  check(
    `${t} visible in library post-008 (v008=true)`,
    libraryEntriesFor(true).some((e) => e.type === t),
  );
  check(
    `${t} publish-blocked pre-008`,
    !defIsPublishable(fieldDef(t), false),
  );
  check(
    `${t} publishable post-008`,
    defIsPublishable(fieldDef(t), true),
  );
}
check(
  "blockedTypeLabelsFor: file_upload blocks a mixed form pre-008",
  blockedTypeLabelsFor(
    [{ field_type: "short_text" }, { field_type: "file_upload" }],
    false,
  ).join() === "File upload",
);
check(
  "blockedTypeLabelsFor: empty post-008",
  blockedTypeLabelsFor(
    [{ field_type: "short_text" }, { field_type: "file_upload" }],
    true,
  ).length === 0,
);
check(
  "groups with entries only (pre-008): files+advanced absent",
  !libraryGroupsFor(false).some((g) => g.key === "files" || g.key === "advanced"),
);
check(
  "groups post-008: files+advanced present",
  libraryGroupsFor(true).some((g) => g.key === "files" && g.items.length === 2) &&
    libraryGroupsFor(true).some((g) => g.key === "advanced" && g.items.length === 2),
);
check(
  "contact_info lives in the contact group",
  fieldDef("contact_info").group === "contact",
);
check(
  "embed lives in the layout group",
  fieldDef("embed").group === "layout",
);
check(
  "payment carries no answer value (submittable=false)",
  !isSubmittableType("payment") && !isSubmittableType("embed"),
);

// Config validation parity with 008's publish branches.
check(
  "file_upload: maxSizeMb 0 rejected (008: 1..100)",
  !validateConfig("file_upload", { maxSizeMb: 0 }).ok,
);
check(
  "file_upload: maxFiles 11 rejected (008: 1..10)",
  !validateConfig("file_upload", { maxFiles: 11 }).ok,
);
check(
  "file_upload: bad MIME entry rejected",
  !validateConfig("file_upload", { allowedTypes: ["not a mime"] }).ok,
);
check(
  "file_upload: 21 types rejected (008: <= 20)",
  !validateConfig("file_upload", { allowedTypes: Array.from({ length: 21 }, () => "a/b") }).ok,
);
check(
  "file_upload: valid config accepted",
  validateConfig("file_upload", { maxSizeMb: 25, maxFiles: 3, multiple: true, allowedTypes: ["image/png", "application/pdf"] }).ok,
);

check(
  "contact_info: empty parts rejected",
  !validateConfig("contact_info", { parts: [] }).ok,
);
check(
  "contact_info: unknown part rejected",
  !validateConfig("contact_info", { parts: ["nickname"] }).ok,
);
check(
  "contact_info: required outside parts rejected",
  !validateConfig("contact_info", { parts: ["email"], requiredParts: ["phone"] }).ok,
);
check(
  "contact_info: valid config accepted",
  validateConfig("contact_info", { parts: ["first_name", "last_name", "email"], requiredParts: ["email"] }).ok,
);

check(
  "payment: amount below 50 cents rejected (008 bounds)",
  !validateConfig("payment", { amountCents: 49, currency: "USD" }).ok,
);
check(
  "payment: unsupported currency rejected",
  !validateConfig("payment", { amountCents: 1000, currency: "XYZ" }).ok,
);
check(
  "payment: valid config accepted",
  validateConfig("payment", { amountCents: 2500, currency: "EUR", amountMode: "minimum" }).ok,
);

check(
  "scheduler: no days rejected",
  !validateConfig("scheduler", { days: [], windows: [{ start: "09:00", end: "17:00" }], slotMinutes: 30, timezone: "UTC" }).ok,
);
check(
  "scheduler: overlapping windows rejected",
  !validateConfig("scheduler", {
    days: [1], windows: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "15:00" }],
    slotMinutes: 30, timezone: "UTC",
  }).ok,
);
check(
  "scheduler: start >= end rejected",
  !validateConfig("scheduler", { days: [1], windows: [{ start: "17:00", end: "09:00" }], slotMinutes: 30, timezone: "UTC" }).ok,
);
check(
  "scheduler: slotMinutes below 5 rejected (008: 5..240)",
  !validateConfig("scheduler", { days: [1], windows: [{ start: "09:00", end: "17:00" }], slotMinutes: 4, timezone: "UTC" }).ok,
);
check(
  "scheduler: valid config accepted",
  validateConfig("scheduler", {
    days: [1, 2, 3, 4, 5], windows: [{ start: "09:00", end: "17:00" }],
    slotMinutes: 30, bufferMinutes: 10, minNoticeHours: 24, maxBookingDays: 60,
    timezone: "Asia/Kolkata",
  }).ok,
);

// Embed parser — the allowlist IS the security boundary.
check(
  "parseVideoEmbed: youtube watch URL",
  parseVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src ===
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
);
check(
  "parseVideoEmbed: youtu.be short URL",
  parseVideoEmbed("https://youtu.be/dQw4w9WgXcQ")?.provider === "youtube",
);
check(
  "parseVideoEmbed: vimeo URL",
  parseVideoEmbed("https://vimeo.com/123456789")?.src === "https://player.vimeo.com/video/123456789",
);
check(
  "parseVideoEmbed: http (not https) rejected",
  parseVideoEmbed("http://www.youtube.com/watch?v=dQw4w9WgXcQ") === null,
);
check(
  "parseVideoEmbed: other host rejected",
  parseVideoEmbed("https://evil.example.com/embed/dQw4w9WgXcQ") === null,
);
check(
  "parseVideoEmbed: query-injected host rejected",
  parseVideoEmbed("https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ") === null,
);
check(
  "embed: non-https url rejected",
  !validateConfig("embed", { embedType: "link", url: "http://example.com" }).ok,
);
check(
  "embed: non-allowlisted video rejected",
  !validateConfig("embed", { embedType: "video", url: "https://example.com/x" }).ok,
);
check(
  "embed: valid youtube video accepted",
  validateConfig("embed", { embedType: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).ok,
);
check(
  "embed: link type accepts any https url",
  validateConfig("embed", { embedType: "link", url: "https://example.com/page" }).ok,
);

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
