/**
 * Insert STAGED test fields (datetime, matrix, address) directly into a
 * draft form via the service key — the same path an activated registry
 * would use through the builder. These types are staged pending
 * migration 007, so the library cannot add them yet; direct rows let us
 * test builder CRUD + preview rendering/validation NOW.
 *
 * Usage: bun run scripts/fs2p2-insert-staged.ts <formId>
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const formId = process.argv[2];
if (!formId) {
  console.error("usage: bun run scripts/fs2p2-insert-staged.ts <formId>");
  process.exit(1);
}

const { data: existing } = await admin
  .from("form_fields")
  .select("sort_order")
  .eq("form_id", formId)
  .order("sort_order", { ascending: false })
  .limit(1);
const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

const rows = [
  {
    form_id: formId,
    field_key: "when_should_we_meet",
    field_type: "datetime" as const,
    label: "When should we meet?",
    is_required: true,
    sort_order: nextOrder,
    width: 12,
    config: {},
  },
  {
    form_id: formId,
    field_key: "rate_each_aspect",
    field_type: "matrix" as const,
    label: "Rate each aspect",
    description: "One column per row",
    is_required: false,
    sort_order: nextOrder + 1,
    width: 12,
    config: {
      rows: ["Speed", "Quality", "Support"],
      rowLabels: { Speed: "Speed", Quality: "Quality", Support: "Support" },
      columns: ["poor", "ok", "great"],
      columnLabels: { poor: "Poor", ok: "OK", great: "Great" },
    },
  },
  {
    form_id: formId,
    field_key: "home_address",
    field_type: "address" as const,
    label: "Home address",
    is_required: false,
    sort_order: nextOrder + 2,
    width: 12,
    config: { showLine2: false, showState: true, showPostal: true, showCountry: true },
  },
];

const { data, error } = await admin.from("form_fields").insert(rows).select();
if (error) {
  console.error("INSERT FAILED:", error.message);
  process.exit(1);
}
console.log(`INSERTED ${data?.length ?? 0} staged fields:`);
for (const r of data ?? []) {
  console.log(`  ${r.field_type.padEnd(10)} ${r.field_key} (order ${r.sort_order})`);
}
