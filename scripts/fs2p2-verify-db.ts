/**
 * Verify Phase 2 field persistence directly in the DB (read-only probe).
 * Usage: bun run scripts/fs2p2-verify-db.ts [formName]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const formName = process.argv[2] ?? "FS2 Phase 2 Field Types";

const { data: forms, error: fe } = await admin
  .from("forms")
  .select("id, name, status, settings")
  .ilike("name", `%${formName.slice(0, 20)}%`);
if (fe) {
  console.error("form query failed:", fe.message);
  process.exit(1);
}
if (!forms || forms.length === 0) {
  console.error("no matching form");
  process.exit(1);
}
const form = forms[0];
console.log("FORM:", form.id, form.name, "status:", form.status, "settings:", JSON.stringify(form.settings));

const { data: fields, error: fldErr } = await admin
  .from("form_fields")
  .select("id, field_key, field_type, label, is_required, sort_order, width, config")
  .eq("form_id", form.id)
  .order("sort_order");
if (fldErr) {
  console.error("fields query failed:", fldErr.message);
  process.exit(1);
}
console.log(`\nFIELDS (${fields?.length ?? 0}):`);
for (const f of fields ?? []) {
  console.log(
    `  [${f.sort_order}] ${f.field_type.padEnd(14)} key=${f.field_key.padEnd(24)} label="${f.label}" req=${f.is_required} w=${f.width} config=${JSON.stringify(f.config)}`,
  );
}
