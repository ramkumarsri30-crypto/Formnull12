/**
 * verify-bugfixes.ts — targeted checks for the form-builder passes.
 *
 * Run: bun scripts/verify-bugfixes.ts
 *
 * Verifies (no DB, no network — pure registry logic):
 *   1. FIELD_REGISTRY covers every legal field_type enum value (002)
 *      so fieldDef() can never throw "Unknown field type" and crash
 *      the builder.
 *   2. Registry flags stay aligned with the live server contract:
 *      006's c_submittable (14 types) + 007's additions (datetime,
 *      address, matrix) = 17 submittable types. Layout types
 *      (section, page_break) and deferred types (file_upload,
 *      signature) are NOT submittable.
 *   3. validateConfig("matrix", …) REJECTS non-string rows/columns
 *      (parity with 007 + selects).
 *   4. Balance-field-type activation (2026-09-05): datetime / matrix /
 *      address / section / page_break are ACTIVE + in the library;
 *      signature stays deferred (compat-only).
 *   5. buildPages partitions page-break forms the way the paged
 *      renderer expects (leading/trailing/consecutive break rules).
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

console.log("1) Registry covers the full 002 field_type enum");
const ALL_TYPES: FieldType[] = [
  "short_text", "long_text", "email", "url", "phone",
  "number", "decimal", "boolean", "single_select", "multi_select",
  "date", "datetime", "time", "rating", "scale", "file_upload",
  "section", "page_break", "signature", "address", "matrix",
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
  "registry has 21 defs (full enum)",
  FIELD_REGISTRY.length === ALL_TYPES.length,
  `got ${FIELD_REGISTRY.length}`,
);

console.log("2) Submittable set mirrors 006 (14) + 007 (3) = 17 types");
const SUBMITTABLE_LIVE: FieldType[] = [
  "short_text", "long_text", "email", "url", "phone",
  "number", "decimal", "boolean", "date", "time",
  "single_select", "multi_select", "rating", "scale",
  // 007 additions (migration verified applied 2026-09-05):
  "datetime", "address", "matrix",
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
  "signature stays deferred (status=legacy, not in library)",
  fieldDef("signature").status === "legacy" &&
    !ADDABLE_FIELD_TYPES.some((d) => d.value === "signature") &&
    !LIBRARY_ENTRIES.some((e) => e.type === "signature"),
);
check(
  "file_upload stays deferred (publishable=false — 006 block)",
  !fieldDef("file_upload").publishable &&
    !ADDABLE_FIELD_TYPES.some((d) => d.value === "file_upload"),
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

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
