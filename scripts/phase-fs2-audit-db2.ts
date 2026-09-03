/** Read-only probe: form_versions count + the published form's row. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const { data, error, count } = await db.from("form_versions").select("id", { count: "exact" });
  console.log("form_versions count:", count, "error:", JSON.stringify(error), "rows:", data?.length);

  const { data: forms, error: ferr } = await db.from("forms").select("id, name, status, published_version, public_key");
  if (ferr) console.log("forms err:", ferr.message);
  for (const f of forms ?? []) {
    if (f.status === "published") {
      console.log("published:", f.name, f.public_key, "v", f.published_version);
      const { data: vs, error: verr } = await db.from("form_versions")
        .select("version, form_id, created_at")
        .eq("form_id", f.id);
      console.log("  versions:", JSON.stringify(vs), verr?.message);
    }
  }
}
main();
