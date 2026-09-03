/**
 * Phase 2A E2E — DB state verification (READ-ONLY helper).
 * Usage: bun scripts/phase2a-e2e-db.ts [profileEmail]
 * Prints the profile's default_workspace_id + per-workspace form counts.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("Missing env vars.");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });
const email = process.argv[2] ?? "formnull.test@gmail.com";

const { data: profile } = await admin
  .from("profiles")
  .select("id,email,default_workspace_id")
  .eq("email", email)
  .single();
if (!profile) {
  console.error("profile not found");
  process.exit(1);
}
const { data: ws } = await admin
  .from("workspaces")
  .select("id,slug,name")
  .eq("id", profile.default_workspace_id ?? "00000000-0000-0000-0000-000000000000")
  .maybeSingle();
console.log(
  `PROFILE ${email} default_workspace_id=${profile.default_workspace_id} (${ws?.name ?? "none"})`,
);

const { count: formsCount } = await admin
  .from("forms")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", profile.default_workspace_id ?? "");
console.log(`default ws forms count: ${formsCount}`);
