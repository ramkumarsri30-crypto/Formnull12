/**
 * Probe: is migration 007 applied to the live project?
 *
 * Strategy (fully contained — throwaway form, deleted afterwards):
 *   1. Sign in as the standard test user (password grant).
 *   2. Create a draft form in their workspace (public_key auto-generated
 *      by trigger 002).
 *   3. Insert 1 short_text field + 1 matrix field with INVALID config
 *      (duplicate rows — 007's publish validation rejects this; 006 has
 *      no matrix branch so it passes).
 *   4. Call publish_form RPC with the user's token:
 *        - CONFIG_INVALID error mentioning the matrix rows → 007 APPLIED
 *        - publish succeeds (or any other outcome)              → 007 NOT APPLIED
 *   5. Delete the throwaway form either way (cascade removes fields
 *      and any accidental version).
 *
 * Run: bun run scripts/fs3-probe-007-status.ts
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const EMAIL = "formnull.test@gmail.com";
const PASS = "TestPass123!";

async function grant(): Promise<{ token: string; userId: string }> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!r.ok) throw new Error(`grant failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string; user: { id: string } };
  return { token: j.access_token, userId: j.user.id };
}

function h(token: string): Record<string, string> {
  return { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function main() {
  console.log("Signing in as test user…");
  const { token, userId } = await grant();
  console.log(`Signed in: ${userId}`);

  // (2) Throwaway form in the user's first workspace.
  const wsRes = await fetch(`${url}/rest/v1/workspaces?select=id,name&order=created_at&limit=1`, {
    headers: h(token),
  });
  const workspaces = (await wsRes.json()) as Array<{ id: string; name: string }>;
  if (!workspaces?.length) throw new Error("no workspace visible for test user");
  const ws = workspaces[0];
  console.log(`Workspace: ${ws.name} (${ws.id})`);

  const formRes = await fetch(`${url}/rest/v1/forms?select=id,name`, {
    method: "POST",
    headers: { ...h(token), Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: ws.id,
      name: "zz-probe-007-status (throwaway)",
      description: "temporary probe — deleted immediately",
      status: "draft",
      created_by: userId,
    }),
  });
  if (!formRes.ok) throw new Error(`form insert failed: ${formRes.status} ${await formRes.text()}`);
  const form = (await formRes.json())[0] as { id: string };
  console.log(`Throwaway form: ${form.id}`);
  let outcome = "UNKNOWN";

  try {
    // (3) Fields: 1 valid short_text (usable) + matrix with duplicate rows.
    const fieldsRes = await fetch(`${url}/rest/v1/form_fields?select=id,field_key`, {
      method: "POST",
      headers: { ...h(token), Prefer: "return=representation" },
      body: JSON.stringify([
        {
          form_id: form.id,
          field_key: "name",
          field_type: "short_text",
          label: "Name",
          is_required: false,
          sort_order: 0,
          width: 12,
          config: {},
        },
        {
          form_id: form.id,
          field_key: "broken_matrix",
          field_type: "matrix",
          label: "Broken matrix",
          is_required: false,
          sort_order: 1,
          width: 12,
          config: { rows: ["a", "a"], columns: ["x", "y"] }, // duplicates → 007 rejects
        },
      ]),
    });
    if (!fieldsRes.ok)
      throw new Error(`field insert failed: ${fieldsRes.status} ${await fieldsRes.text()}`);
    console.log("Fields inserted (short_text + broken matrix).");

    // (4) publish_form probe.
    const pubRes = await fetch(`${url}/rest/v1/rpc/publish_form`, {
      method: "POST",
      headers: h(token),
      body: JSON.stringify({ p_form_id: form.id }),
    });
    const pubBody = await pubRes.text();
    console.log(`publish_form → HTTP ${pubRes.status}`);
    console.log(`body: ${pubBody.slice(0, 400)}`);

    if (pubBody.includes("matrix") || pubBody.includes("rows")) {
      outcome = "007_APPLIED";
    } else if (pubRes.ok) {
      outcome = "007_NOT_APPLIED (publish accepted the broken matrix — 006 has no matrix branch)";
    } else {
      outcome = `INCONCLUSIVE: ${pubRes.status} ${pubBody.slice(0, 150)}`;
    }
  } finally {
    // (5) Cleanup — cascade removes fields + versions.
    const delRes = await fetch(`${url}/rest/v1/forms?id=eq.${form.id}`, {
      method: "DELETE",
      headers: h(token),
    });
    console.log(`Cleanup delete → HTTP ${delRes.status}`);
  }

  console.log(`\n=== RESULT: ${outcome} ===`);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
