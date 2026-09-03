/**
 * Debug: why does A see their form (ws 36637313) but not the workspace row?
 * Read-only queries as User A.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "formnull.test@gmail.com", password: "TestPass123!" }),
});
const { access_token: t, user } = (await r.json()) as {
  access_token: string;
  user: { id: string; email: string };
};
console.log("A user id:", user.id);

const h = { apikey: anon, Authorization: `Bearer ${t}` };
for (const q of [
  "workspaces?select=id,name",
  "workspaces?id=eq.36637313-e30f-44da-944d-779e1ec9c504&select=id,name",
  "workspace_members?select=workspace_id,role&user_id=eq." + user.id,
  "forms?workspace_id=eq.36637313-e30f-44da-944d-779e1ec9c504&select=id,name",
]) {
  const res = await fetch(`${url}/rest/v1/${q}`, { headers: h });
  console.log(q.slice(0, 60), "→", res.status, (await res.text()).slice(0, 250));
}
