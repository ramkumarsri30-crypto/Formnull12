/**
 * Phase 2 — Backfill missing profiles/workspaces for legacy auth users.
 *
 * WHY: auth users formnull.test@gmail.com and sricharanmanikandan@gmail.com
 * were created BEFORE migrations 001-004 were applied to the project, so the
 * sign-up trigger (trg_on_auth_user_created) never fired for them. The
 * invariant "every auth.user has profile + personal workspace + owner
 * membership + default_workspace_id" was broken for exactly these rows.
 *
 * This is a DATA repair (not a schema change): it replicates the exact logic
 * of fn_handle_new_user() for users that predate the trigger.
 *
 * No new migration is needed — the schema and trigger are correct; only
 * these two rows are missing.
 *
 * Run: bun run scripts/backfill-legacy-profiles.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = "https://sqtolkfjnskyxnltuyci.supabase.co";
const serviceKey = "REDACTED_SUPABASE_SECRET_KEY";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function slugify(email: string): string {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  base = base.replace(/^-+|-+$/g, "");
  return base || "workspace";
}

async function main() {
  // 1. List all auth users
  const { data: users, error: usersErr } = await admin.auth.admin.listUsers();
  if (usersErr) throw usersErr;

  // 2. List existing profiles + workspaces + memberships
  const { data: profiles } = await admin.from("profiles").select("id, email");
  const { data: workspaces } = await admin.from("workspaces").select("id, slug, owner_id");
  const { data: members } = await admin.from("workspace_members").select("workspace_id, user_id");

  const profileIds = new Set((profiles ?? []).map((p) => p.id));
  const memberKeys = new Set((members ?? []).map((m) => `${m.workspace_id}:${m.user_id}`));
  const takenSlugs = new Set((workspaces ?? []).map((w) => w.slug));

  let fixed = 0;
  for (const u of users.users) {
    if (profileIds.has(u.id)) {
      console.log(`OK    ${u.email} — profile exists`);
      continue;
    }
    console.log(`FIX   ${u.email} — backfilling…`);

    // Replicate fn_handle_new_user():
    const displayName = u.email?.split("@")[0] ?? "user";

    // 2a. profile
    const { error: pErr } = await admin.from("profiles").insert({
      id: u.id,
      email: u.email ?? "",
      display_name: displayName,
    });
    if (pErr) throw pErr;

    // 2b. personal workspace with unique slug
    let base = slugify(u.email ?? "user");
    let slug = base;
    let attempt = 0;
    while (takenSlugs.has(slug)) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    takenSlugs.add(slug);

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({
        slug,
        name: `${displayName}'s workspace`,
        owner_id: u.id,
        description: "Personal workspace",
      })
      .select("id")
      .single();
    if (wsErr) throw wsErr;

    // 2c. owner membership
    if (!memberKeys.has(`${ws.id}:${u.id}`)) {
      const { error: mErr } = await admin
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: u.id, role: "owner" });
      if (mErr) throw mErr;
    }

    // 2d. default workspace
    const { error: dErr } = await admin
      .from("profiles")
      .update({ default_workspace_id: ws.id })
      .eq("id", u.id);
    if (dErr) throw dErr;

    console.log(`      → workspace "${slug}" (${ws.id}), role owner, default set`);
    fixed += 1;
  }

  console.log(`\nDone. ${fixed} user(s) repaired, ${users.users.length - fixed} already OK.`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
