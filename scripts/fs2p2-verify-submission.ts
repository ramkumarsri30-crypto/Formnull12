/**
 * Verify Phase 2 public submission values (read-only probe).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const publicKey = process.argv[2];
if (!publicKey) {
  console.error("usage: bun run scripts/fs2p2-verify-submission.ts <public_key>");
  process.exit(1);
}

const { data: forms, error: fe } = await admin
  .from("forms")
  .select("id, name, published_version")
  .eq("public_key", publicKey)
  .single();
if (fe || !forms) {
  console.error("form lookup failed:", fe?.message);
  process.exit(1);
}
console.log("FORM:", forms.id, `"${forms.name}"`, "v" + forms.published_version);

const { data: subs, error: se } = await admin
  .from("submissions")
  .select("id, submission_seq, status, created_at, metadata")
  .eq("form_id", forms.id)
  .order("created_at", { ascending: true });
if (se) {
  console.error("submissions query failed:", se.message);
  process.exit(1);
}
console.log(`\nSUBMISSIONS (${subs?.length ?? 0}):`);
for (const s of subs ?? []) {
  console.log(`  seq=${s.submission_seq} status=${s.status} at=${s.created_at} meta=${JSON.stringify(s.metadata)}`);
}

const { data: values, error: ve } = await admin
  .from("submission_values")
  .select("field_id, value, value_text, value_number, value_boolean")
  .eq("form_id", forms.id)
  .order("field_id");
if (ve) {
  console.error("values query failed:", ve.message);
  process.exit(1);
}
console.log(`\nVALUES (${values?.length ?? 0}):`);
for (const v of values ?? []) {
  console.log(
    `  field=${(v.field_id ?? "deleted").slice(0, 8)} value=${JSON.stringify(v.value)} text=${JSON.stringify(v.value_text)} num=${v.value_number ?? "-"} bool=${v.value_boolean ?? "-"}`,
  );
}

// Map field_ids to keys for readability
const { data: fields } = await admin
  .from("form_fields")
  .select("id, field_key, field_type")
  .eq("form_id", forms.id);
const byId = new Map((fields ?? []).map((f) => [f.id, f]));
console.log("\nREADABLE:");
for (const v of values ?? []) {
  const f = byId.get(v.field_id);
  if (f) {
    console.log(`  ${f.field_type.padEnd(13)} ${f.field_key.padEnd(32)} → ${JSON.stringify(v.value)}`);
  } else {
    console.log(`  DELETED-FIELD ${v.field_id?.slice(0, 8)} → ${JSON.stringify(v.value)}`);
  }
}
