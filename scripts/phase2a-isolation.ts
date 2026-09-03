/**
 * Phase 2A — Tenant isolation / RLS enforcement via REAL authenticated
 * requests (password-grant tokens for both users). Attempted cross-tenant
 * writes are expected to be BLOCKED by RLS — nothing is inserted.
 *
 * Run: bun scripts/phase2a-isolation.ts
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Missing env.");
  process.exit(1);
}

const A_EMAIL = "formnull.test@gmail.com";
const A_PASS = "TestPass123!";
const B_EMAIL = "formnull.b@gmail.com";
const B_PASS = "TestPass456!";

// Fixed IDs from the verified live state:
const A_WS_FORMNULL = "36637313-e30f-4e0e-944d-779e1ec9c504"; // formnull-test ws
const A_WS_QA = "399b72f8-c54f-450d-82cc-6c3330876c29";
const A_FORM = "29db4876-5470-4280-b1b3-2cbdd7d42076";

async function grant(email: string, pass: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });
  if (!r.ok) throw new Error(`grant failed for ${email}: ${r.status}`);
  const j = (await r.json()) as { access_token: string; user: { id: string } };
  return j.access_token;
}

function authHeaders(token: string): Record<string, string> {
  return { apikey: anon, Authorization: `Bearer ${token}` };
}

async function get(token: string, path: string) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: authHeaders(token) });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 200) };
}

async function post(token: string, table: string, payload: unknown) {
  const r = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 220) };
}

async function patch(token: string, table: string, filter: string, payload: unknown) {
  const r = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 220) };
}

const tokenA = await grant(A_EMAIL, A_PASS);
const tokenB = await grant(B_EMAIL, B_PASS);
console.log("Both users authenticated (A=owner of formnull-test, B=owner of own workspace).\n");

function report(name: string, r: { status: number; body: string }, expect: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — expect ${expect}: HTTP ${r.status} ${r.body.slice(0, 140)}`);
}

// ---------- B attacking A ----------
console.log("— USER B → USER A's tenant (must ALL be denied/empty) —");

let r = await get(tokenB, `workspaces?id=eq.${A_WS_FORMNULL}&select=id,name`);
report("B reads A's workspace row", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await get(tokenB, `forms?workspace_id=eq.${A_WS_FORMNULL}&select=id,name`);
report("B lists A's workspace forms", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await get(tokenB, `forms?id=eq.${A_FORM}&select=id,name`);
report("B reads A's form by direct id", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await get(tokenB, `submissions?workspace_id=eq.${A_WS_FORMNULL}&select=id`);
report("B reads A's submissions", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await get(tokenB, `form_fields?form_id=eq.${A_FORM}&select=id`);
report("B reads A's form fields", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await post(tokenB, "workspace_members", { workspace_id: A_WS_FORMNULL, user_id: "63b52b9f-87ba-411f-ad33-f40102149240", role: "owner" });
report("B inserts membership into A's workspace", r, "403/RLS", r.status === 403 || r.status === 404);

r = await patch(tokenB, "forms", `id=eq.${A_FORM}`, { name: "HACKED" });
report("B renames A's form", r, "403/RLS or no-op", r.status === 403 || r.status === 404 || r.status === 204);

r = await get(tokenB, `workspaces?id=eq.${A_WS_QA}&select=id`);
report("B reads A's QA workspace", r, "empty []", r.status === 200 && r.body.trim() === "[]");

// ---------- A attacking B ----------
console.log("\n— USER A → USER B's tenant (must ALL be denied/empty) —");

const B_WS = "9fb5120d-f7c5-43e6-826c-5b62a8a45fd9";

r = await get(tokenA, `workspaces?id=eq.${B_WS}&select=id,name`);
report("A reads B's workspace row", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await get(tokenA, `forms?workspace_id=eq.${B_WS}&select=id`);
report("A lists B's forms", r, "empty []", r.status === 200 && r.body.trim() === "[]");

r = await post(tokenA, "workspace_members", { workspace_id: B_WS, user_id: "52fdb4ee-abb3-44da-8bb3-4473aed8d004", role: "owner" });
report("A inserts membership into B's workspace", r, "403/RLS", r.status === 403 || r.status === 404);

// ---------- positive controls (own data IS visible) ----------
console.log("\n— Positive controls (own data must be visible) —");

r = await get(tokenA, `forms?id=eq.${A_FORM}&select=id,name`);
report("A reads own form", r, "1 row", r.status === 200 && r.body.includes("Phase 2A"));

r = await get(tokenA, `workspaces?id=eq.${A_WS_FORMNULL}&select=id,name`);
report("A reads own workspace", r, "1 row", r.status === 200 && r.body.includes("formnull.test"));

r = await get(tokenB, `workspaces?id=eq.${B_WS}&select=id,name`);
report("B reads own workspace", r, "1 row", r.status === 200 && r.body.includes("formnull.b"));

console.log("\nDone.");
