/**
 * Phase 2A E2E — form + fields DB state (READ-ONLY helper).
 * Usage: bun scripts/phase2a-e2e-form.ts <formId>
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("Missing env vars.");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });
const formId = process.argv[2];
if (!formId) {
  console.error("Usage: bun scripts/phase2a-e2e-form.ts <formId>");
  process.exit(1);
}

const { data: form } = await admin
  .from("forms")
  .select("id,workspace_id,name,description,status,created_by,updated_by,created_at,updated_at")
  .eq("id", formId)
  .maybeSingle();
if (!form) {
  console.error("FORM NOT FOUND");
  process.exit(1);
}
console.log(
  `FORM "${form.name}" | ws=${form.workspace_id} | status=${form.status} | created_by=${form.created_by} | updated_by=${form.updated_by ?? "null"} | desc="${form.description ?? ""}"`,
);

const { data: fields, error } = await admin
  .from("form_fields")
  .select("id,field_key,field_type,label,is_required,sort_order,width,config,placeholder,description,help_text")
  .eq("form_id", formId)
  .order("sort_order", { ascending: true });
if (error) {
  console.error("FIELDS ERROR:", error.message);
  process.exit(1);
}
console.log(`FIELDS (${fields?.length ?? 0}):`);
for (const f of fields ?? []) {
  console.log(
    `  [${f.sort_order}] ${f.field_key} (${f.field_type}) label="${f.label}" req=${f.is_required} w=${f.width} config=${JSON.stringify(f.config)}`,
  );
}
const orders = (fields ?? []).map((f) => f.sort_order);
const dupes = orders.filter((o, i) => orders.indexOf(o) !== i);
console.log(
  `sort_orders=[${orders.join(",")}] duplicates=${dupes.length === 0 ? "NONE" : JSON.stringify(dupes)}`,
);
