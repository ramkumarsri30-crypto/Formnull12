/**
 * Phase 3 pre-flight: verify migration 006 functions exist in the live DB
 * WITHOUT side effects.
 *
 *   publish_form(nonexistent-uuid) with service key:
 *     - auth.uid() IS NULL → AUTH_REQUIRED raised, nothing written
 *     - function missing  → PGRST202 (function not found)
 *
 *   get_public_form(random-key):
 *     - function exists   → NOT_FOUND
 *     - function missing  → PGRST202
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function probe(fn: string, body: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 200) };
}

async function main() {
  console.log("=== 006 existence probes (read-only semantics) ===");
  const p1 = await probe("publish_form", {
    p_form_id: "00000000-0000-0000-0000-000000000000",
  });
  console.log("publish_form:", p1.status, p1.body);
  const p2 = await probe("get_public_form", {
    p_public_key: "nonexistent-key-probe",
  });
  console.log("get_public_form:", p2.status, p2.body);
  const p3 = await probe("submit_public_form", {
    p_public_key: "nonexistent-key-probe",
    p_values: {},
  });
  console.log("submit_public_form:", p3.status, p3.body);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
