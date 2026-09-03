/**
 * Phase 2A — Env & live DB verification (STRICTLY READ-ONLY)
 * =====================================================================
 * - Verifies the restored .env.local (values masked — never printed).
 * - Pings auth health + REST root with the publishable (anon) key.
 * - Uses the secret (service-role) key for SELECT-only row counts and
 *   workspace/membership/profile/form row inspection (RLS bypass, read-only).
 * - Prints NO secrets, performs NO writes.
 *
 * Run: bun scripts/phase2a-env-check.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mask(k?: string): string {
  if (!k) return "MISSING";
  // Show only the format prefix + length — enough to verify presence/format.
  const prefix = k.slice(0, 13);
  return `set (${prefix}…, ${k.length} chars)`;
}

console.log("— env check —");
console.log("NEXT_PUBLIC_SUPABASE_URL:", url ?? "MISSING");
console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY:", mask(anon));
console.log("SUPABASE_SERVICE_ROLE_KEY:", mask(secret));

if (!url || !anon || !secret) {
  console.error("ENV INCOMPLETE — aborting.");
  process.exit(1);
}

// 1) Auth health (publishable key)
try {
  const h = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
  console.log("auth /health (anon key):", h.status, h.ok ? "OK" : "NOT OK");
} catch (e) {
  console.error("auth /health FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}

// 2) REST root reachability (publishable key)
try {
  const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: anon } });
  console.log("rest root (anon key):", r.status);
} catch (e) {
  console.error("rest root FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}

// 3) Read-only counts via secret key (bypasses RLS)
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("\n— row counts (service key, read-only) —");
const tables = [
  "profiles",
  "workspaces",
  "workspace_members",
  "forms",
  "form_fields",
  "form_versions",
  "submissions",
  "submission_values",
  "assets",
] as const;

for (const t of tables) {
  const { count, error } = await admin
    .from(t)
    .select("id", { count: "exact", head: true });
  if (error) console.log(`count ${t}: ERROR ${error.message}`);
  else console.log(`count ${t}: ${count}`);
}

// 4) Workspace / membership / profile / form rows (for audit cross-check)
console.log("\n— workspaces —");
const { data: wss } = await admin
  .from("workspaces")
  .select("id,slug,name,owner_id,plan,created_at")
  .order("created_at", { ascending: true });
for (const w of wss ?? []) {
  console.log(
    `WS ${w.slug} | name="${w.name}" | id=${w.id} | owner=${w.owner_id} | plan=${w.plan} | created=${w.created_at}`,
  );
}

console.log("\n— workspace_members —");
const { data: members } = await admin
  .from("workspace_members")
  .select("workspace_id,user_id,role,joined_at")
  .order("joined_at", { ascending: true });
for (const m of members ?? []) {
  console.log(
    `MEMBER ws=${m.workspace_id} user=${m.user_id} role=${m.role} joined=${m.joined_at}`,
  );
}

console.log("\n— profiles —");
const { data: profiles } = await admin
  .from("profiles")
  .select("id,email,display_name,default_workspace_id,created_at")
  .order("created_at", { ascending: true });
for (const p of profiles ?? []) {
  console.log(
    `PROFILE ${p.email} | id=${p.id} | display="${p.display_name}" | default_ws=${p.default_workspace_id} | created=${p.created_at}`,
  );
}

console.log("\n— forms —");
const { data: forms } = await admin
  .from("forms")
  .select("id,workspace_id,name,status,created_by,created_at");
for (const f of forms ?? []) {
  console.log(
    `FORM "${f.name}" | id=${f.id} | ws=${f.workspace_id} | status=${f.status} | created_by=${f.created_by} | created=${f.created_at}`,
  );
}

console.log("\nDone (read-only).");
