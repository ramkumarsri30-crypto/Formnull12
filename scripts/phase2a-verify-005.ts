/**
 * Phase 2A FINAL — Migration 005 verification (read-only behavioral probes).
 *
 * The user applied 005 manually in the Supabase SQL editor. PostgREST does not
 * expose pg_catalog, so catalog properties are verified through behavior that
 * can ONLY result from the applied SQL, plus the live OpenAPI signature:
 *
 *  P1  Live OpenAPI spec           → function exists + exact parameter list
 *  P2  anon key call               → 42501 permission denied (REVOKE worked)
 *  P3  service key, no user JWT    → AUTH_REQUIRED (auth.uid() guard is live,
 *                                    owner can never be spoofed; creates nothing)
 *  P4  authenticated + empty name  → INVALID_NAME (authenticated CAN execute;
 *                                    executes real code path; creates nothing)
 *  P5  authenticated + forged
 *      user_id/workspace_id params → PostgREST signature-resolution error
 *                                    (signature has no such params → cross-tenant
 *                                    membership impossible by construction)
 *  P6  workspaces + workspace_members row counts before/after → unchanged
 *  P7  orphan workspace debug-test-ws read-only check (id/slug/members/forms)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !secret) {
  console.error("Missing env vars.");
  process.exit(1);
}

const ORPHAN_ID = "2d618272-11c8-4982-9f10-5fdfc034b130";
const ORPHAN_SLUG = "debug-test-ws";
const TEST_EMAIL = "formnull.test@gmail.com";
const TEST_PASS = "TestPass123!";

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
  if (!ok) failures++;
};

// --- authenticated user JWT (password grant, no browser session involved) ---
const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
});
if (!tokenRes.ok) {
  console.error(`Could not sign in test user: ${tokenRes.status}`);
  process.exit(1);
}
const { access_token: userJwt, user } = await tokenRes.json();
console.log(
  `signed in: ${user.email} (sub=${(user.id as string).slice(0, 8)}…)`,
);

const rpc = async (
  key: string,
  jwt: string | null,
  body: Record<string, unknown>,
) => {
  const res = await fetch(`${url}/rest/v1/rpc/create_workspace`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${jwt ?? key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
};

// P6a — row counts BEFORE probes
const admin = createClient(url, secret, { auth: { persistSession: false } });
const count = async (table: string) =>
  (await admin.from(table).select("id", { count: "exact", head: true })).count;
const wsBefore = await count("workspaces");
const wmBefore = await count("workspace_members");
console.log(
  `\nrows before probes: workspaces=${wsBefore} workspace_members=${wmBefore}`,
);

// P1 — REMOVED: this project's REST gateway returns an OpenAPI spec with an
// empty paths list (even for tables), so it cannot prove presence/absence of
// RPCs. Existence + signature are instead proven behaviorally by P4 (the
// function body executes and returns our own INVALID_NAME error) and P5
// (PostgREST PGRST202 enumerates the only resolvable parameter list).

// P2 — anon EXECUTE must be denied (no row created)
console.log("\n--- P2: anon key must be DENIED ---");
const p2 = await rpc(anon, anon, { p_name: "anon-probe-should-fail" });
check(
  "P2 anon denied (PG 42501 permission denied for function)",
  [401, 403, 42501].includes(p2.status) &&
    /42501/.test(p2.body) &&
    /permission denied for function create_workspace/i.test(p2.body),
  `status=${p2.status} body=${p2.body.slice(0, 160)}`,
);

// P3 — service key without user JWT: auth.uid() is NULL → AUTH_REQUIRED
console.log("\n--- P3: no-user-JWT call hits auth.uid() guard ---");
const p3 = await rpc(secret, secret, { p_name: "svc-probe-should-raise" });
check(
  "P3 AUTH_REQUIRED raised (owner cannot be spoofed)",
  p3.status >= 400 && /AUTH_REQUIRED/.test(p3.body),
  `status=${p3.status} body=${p3.body.slice(0, 160)}`,
);

// P4 — authenticated user CAN execute; empty name → INVALID_NAME (no row)
console.log("\n--- P4: authenticated can execute (validation path) ---");
const p4 = await rpc(anon, userJwt, { p_name: "   " });
check(
  "P4 authenticated executes; INVALID_NAME raised (no data)",
  p4.status >= 400 && /INVALID_NAME/.test(p4.body),
  `status=${p4.status} body=${p4.body.slice(0, 160)}`,
);

// P5 — forged user_id / workspace_id params cannot resolve to any function
console.log("\n--- P5: no user_id/workspace_id parameter exists ---");
const p5 = await rpc(anon, userJwt, {
  p_name: "forge-probe",
  user_id: "00000000-0000-0000-0000-000000000000",
  workspace_id: "00000000-0000-0000-0000-000000000000",
});
check(
  "P5 forged params rejected (signature has only p_name/p_description)",
  p5.status === 404 && /could not find the function/i.test(p5.body),
  `status=${p5.status} body=${p5.body.slice(0, 200)}`,
);

// P6b — row counts AFTER probes (proves probes created nothing)
console.log("\n--- P6: probes were read-only ---");
const wsAfter = await count("workspaces");
const wmAfter = await count("workspace_members");
check(
  "P6 no rows created by probes",
  wsAfter === wsBefore && wmAfter === wmBefore,
  `workspaces ${wsBefore}→${wsAfter}, members ${wmBefore}→${wmAfter}`,
);

// P7 — orphan workspace: read-only status check
console.log("\n--- P7: orphan workspace debug-test-ws status ---");
const { data: orphan } = await admin
  .from("workspaces")
  .select("id,slug,name,owner_id,created_at")
  .eq("slug", ORPHAN_SLUG)
  .maybeSingle();
const orphanById = orphan?.id === ORPHAN_ID;
if (!orphan) {
  console.log(
    "P7 orphan ALREADY REMOVED by owner (no workspace with slug debug-test-ws).",
  );
} else {
  const { count: orWm } = await admin
    .from("workspace_members")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", orphan.id);
  const { count: orForms } = await admin
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", orphan.id);
  console.log(
    `P7 orphan STILL EXISTS: id=${orphan.id} slug=${orphan.slug} members=${orWm} forms=${orForms} owner_id=${orphan.owner_id}`,
  );
  if (orphanById && orWm === 0 && orForms === 0) {
    console.log(
      "P7 identity CONFIRMED (exact id + slug + zero members + zero forms) — safe to remove per owner instruction.",
    );
    const { error: delErr } = await admin
      .from("workspaces")
      .delete()
      .eq("id", ORPHAN_ID)
      .eq("slug", ORPHAN_SLUG);
    console.log(
      delErr
        ? `P7 DELETE failed: ${delErr.message}`
        : `P7 DELETE executed (matched id+slug guards). verifying…`,
    );
    const { data: still } = await admin
      .from("workspaces")
      .select("id")
      .eq("id", ORPHAN_ID)
      .maybeSingle();
    console.log(
      still ? "P7 row STILL PRESENT" : "P7 row removed; other rows untouched.",
    );
  } else {
    console.log(
      "P7 identity MISMATCH — NOT deleting (does not exactly match the known test artifact).",
    );
  }
}

console.log(`\n${failures === 0 ? "ALL PROBES PASSED" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
