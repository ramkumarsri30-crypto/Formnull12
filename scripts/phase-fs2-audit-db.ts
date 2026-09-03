/**
 * Field System 2.0 — read-only DB audit.
 * Checks: existing field types in use, config shapes in the wild,
 * published snapshots, submission_values value shapes. NO writes.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const service = env("SUPABASE_SERVICE_ROLE_KEY");

// Service role for READ-ONLY audit across tenants (no RLS filter).
const db = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const { data: fields, error } = await db.from("form_fields").select(
    "id, form_id, field_key, field_type, label, is_required, width, sort_order, config, placeholder, help_text, description"
  ).order("sort_order");
  if (error) throw error;

  console.log(`=== form_fields rows: ${fields?.length ?? 0} ===`);
  const byType = new Map<string, number>();
  for (const f of fields ?? []) byType.set(f.field_type, (byType.get(f.field_type) ?? 0) + 1);
  console.log("Types in use:", Object.fromEntries(byType));

  console.log("\n=== Per-field config shapes ===");
  for (const f of fields ?? []) {
    console.log(
      `[${f.field_type}] key=${f.field_key} label="${String(f.label).slice(0, 30)}" w=${f.width} req=${f.is_required} config=${JSON.stringify(f.config)} ph=${JSON.stringify(f.placeholder)} help=${JSON.stringify(f.help_text)}`
    );
  }

  const { data: versions } = await db.from("form_versions").select("version, form_id, snapshot").order("version");
  console.log(`\n=== form_versions: ${versions?.length ?? 0} ===`);
  for (const v of versions ?? []) {
    const snap = v.snapshot as { fields?: { key: string; type: string; config: unknown }[] } | null;
    console.log(`v${v.version} form=${v.form_id} fields=${snap?.fields?.length ?? 0} types=${JSON.stringify((snap?.fields ?? []).map((f) => f.type))}`);
  }

  const { data: values } = await db.from("submission_values").select("field_id, field_key, value");
  console.log(`\n=== submission_values: ${values?.length ?? 0} ===`);
  for (const s of values ?? []) {
    console.log(`key=${s.field_key} value=${JSON.stringify(s.value)}`);
  }

  const { data: forms } = await db.from("forms").select("id, name, status, published_version");
  console.log(`\n=== forms: ${forms?.length ?? 0} ===`);
  for (const f of forms ?? []) console.log(`${f.name} [${f.status}] v=${f.published_version}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
