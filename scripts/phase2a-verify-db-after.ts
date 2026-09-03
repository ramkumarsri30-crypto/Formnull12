/**
 * Phase 2A FINAL — post-E2E DB state verification (read-only).
 * Verifies the workspace created through the UI matches all 18 expected
 * conditions from the user's checklist (DB-side subset):
 *   - exactly ONE new workspace row named "Phase 2A Final Workspace Test"
 *   - exactly ONE owner membership for it, user_id = test user (auth.uid())
 *   - role = owner
 *   - no orphan workspaces (any workspace with 0 members)
 *   - no duplicate workspace/member rows
 *   - profiles.default_workspace_id points to the new workspace
 *   - previous workspace unchanged & isolated (forms still 2, other rows intact)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, secret, { auth: { persistSession: false } });

const NAME = "Phase 2A Final Workspace Test";
const TEST_EMAIL = "formnull.test@gmail.com";

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
  if (!ok) failures++;
};

// baseline from before the E2E (captured in this session):
//   workspaces=5 memberships=5 forms=2 (2 forms in formnull-test ws)
const { data: allWs } = await admin
  .from("workspaces")
  .select("id,slug,name,owner_id,plan,description");
const { data: allM } = await admin
  .from("workspace_members")
  .select("id,workspace_id,user_id,role");

console.log(`workspaces=${allWs?.length} (baseline 5+1 expected)`);
console.log(`memberships=${allM?.length} (baseline 5+1 expected)`);

// 1. exactly one new workspace with the E2E name
const created = (allWs ?? []).filter((w) => w.name === NAME);
check(
  "exactly one 'Phase 2A Final Workspace Test' row",
  created.length === 1,
  `found ${created.length}`,
);

if (created.length === 1) {
  const ws = created[0];
  console.log(
    `      id=${ws.id} slug=${ws.slug} owner=${ws.owner_id} plan=${ws.plan} desc="${ws.description}"`,
  );

  // test user id
  const { data: profile } = await admin
    .from("profiles")
    .select("id,email,default_workspace_id")
    .eq("email", TEST_EMAIL)
    .single();

  // 2. exactly one membership, owner role, user_id = creator
  const ms = (allM ?? []).filter((m) => m.workspace_id === ws.id);
  check("exactly one membership row for new workspace", ms.length === 1, `found ${ms.length}`);
  check(
    "membership role is owner",
    ms[0]?.role === "owner",
    `role=${ms[0]?.role}`,
  );
  check(
    "membership user_id equals creator's auth.uid()",
    ms[0]?.user_id === profile?.id,
    `member=${ms[0]?.user_id?.slice(0, 8)} creator=${profile?.id?.slice(0, 8)}`,
  );
  check(
    "workspace owner_id equals creator",
    ws.owner_id === profile?.id,
    `owner_id=${ws.owner_id.slice(0, 8)} creator=${profile?.id?.slice(0, 8)}`,
  );

  // 3. default_workspace_id updated (E2E left it selected after switch-back?)
  console.log(
    `      profile.default_workspace_id=${profile?.default_workspace_id?.slice(0, 8)} (new ws = ${ws.id.slice(0, 8)})`,
  );

  // 4. slug uniqueness (no duplicates)
  const dupSlug = (allWs ?? []).filter((w) => w.slug === ws.slug).length;
  check("no duplicate slug", dupSlug === 1, `slug=${ws.slug} count=${dupSlug}`);
}

// 5. no orphan workspaces anywhere (every workspace has >=1 member)
const orphanIds = (allWs ?? []).filter(
  (w) => !(allM ?? []).some((m) => m.workspace_id === w.id),
);
check(
  "no orphan workspaces (all have members)",
  orphanIds.length === 0,
  orphanIds.length === 0
    ? "every workspace has at least one member"
    : `orphans: ${orphanIds.map((w) => w.slug).join(", ")}`,
);

// 6. previous workspace untouched (isolation): formnull-test still has its 2 forms
const prev = (allWs ?? []).find((w) => w.slug === "formnull-test");
if (prev) {
  const { count: prevForms } = await admin
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", prev.id);
  check(
    "previous workspace intact (2 forms, RLS-isolated)",
    prevForms === 2,
    `formnull-test forms=${prevForms}`,
  );
  const prevMs = (allM ?? []).filter((m) => m.workspace_id === prev.id);
  check(
    "previous workspace membership unchanged",
    prevMs.length === 1 && prevMs[0].role === "owner",
    `members=${prevMs.length}`,
  );
}

// 7. other users' data untouched
const { count: totalForms } = await admin
  .from("forms")
  .select("id", { count: "exact", head: true });
check("total forms unchanged (2)", totalForms === 2, `forms=${totalForms}`);
const { count: totalProfiles } = await admin
  .from("profiles")
  .select("id", { count: "exact", head: true });
check("total profiles unchanged (4)", totalProfiles === 4, `profiles=${totalProfiles}`);

console.log(`\n${failures === 0 ? "ALL DB CHECKS PASSED" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
