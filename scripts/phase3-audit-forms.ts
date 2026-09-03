/**
 * Read-only probe: list forms + field counts for a workspace (audit aid).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const wsId = process.argv[2] ?? "36637313-e30f-4e0e-944d-779e1ec9c504";

async function main() {
  const f = await fetch(
    `${url}/rest/v1/forms?select=id,name,status,public_key,published_version,created_at&workspace_id=eq.${wsId}&order=created_at.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const forms = (await f.json()) as Array<Record<string, unknown>>;
  console.log(`Forms in workspace ${wsId}: ${forms.length}`);
  for (const form of forms) {
    const ff = await fetch(
      `${url}/rest/v1/form_fields?select=id,field_key,field_type,sort_order&form_id=eq.${form.id}&order=sort_order.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    const fields = (await ff.json()) as Array<Record<string, unknown>>;
    console.log(
      `  - ${form.name} | status=${form.status} | pk=${String(form.public_key).slice(0, 8)}… | pv=${form.published_version} | fields=${fields.length}`,
    );
    if (fields.length > 0) {
      console.log(
        `      types: ${fields.map((x) => `${x.field_type}`).join(", ")}`,
      );
    }
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
