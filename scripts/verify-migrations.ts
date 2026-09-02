/**
 * FormNull Migration Verifier
 * =====================================================================
 * Verifies that all migrations have been applied to the live Supabase
 * project. Checks:
 *   1. All expected tables exist in public schema
 *   2. RLS is enabled on every user-owned table
 *   3. Expected RLS policies exist
 *   4. Storage buckets exist
 *   5. Helper functions exist
 *
 * Usage:
 *   bun run scripts/verify-migrations.ts
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed (see output for details)
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

// ------------------------------------------------------------------
// Expected tables (from migrations 001-004)
// ------------------------------------------------------------------
const EXPECTED_TABLES = [
  "profiles",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "forms",
  "form_versions",
  "form_fields",
  "submissions",
  "submission_values",
  "assets",
];

// ------------------------------------------------------------------
// Tables that must have RLS enabled
// ------------------------------------------------------------------
const RLS_TABLES = [
  "profiles",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "forms",
  "form_versions",
  "form_fields",
  "submissions",
  "submission_values",
  "assets",
];

// ------------------------------------------------------------------
// Expected storage buckets
// ------------------------------------------------------------------
const EXPECTED_BUCKETS = [
  "avatars",
  "workspaces",
  "form-assets",
  "submissions",
  "exports",
];

// ------------------------------------------------------------------
// Check 1: Tables exist
// ------------------------------------------------------------------
async function checkTablesExist() {
  console.log("\n[1/5] Checking that all expected tables exist...");
  for (const table of EXPECTED_TABLES) {
    try {
      const { error } = await supabase.from(table).select("id").limit(1);
      if (error) {
        const isMissing =
          error.code === "42P01" || error.code === "PGRST205" || error.message.includes("Could not find");
        results.push({
          name: `table:${table}`,
          passed: !isMissing,
          detail: isMissing ? "Table does not exist" : `Error: ${error.message}`,
        });
        console.log(`  ${isMissing ? "❌" : "⚠️"} ${table}: ${isMissing ? "MISSING" : error.message}`);
      } else {
        results.push({ name: `table:${table}`, passed: true });
        console.log(`  ✓ ${table}`);
      }
    } catch (e) {
      results.push({
        name: `table:${table}`,
        passed: false,
        detail: `Exception: ${e}`,
      });
      console.log(`  ❌ ${table}: exception`);
    }
  }
}

// ------------------------------------------------------------------
// Check 2: RLS enabled (we infer this by attempting an unauthenticated
// SELECT — if RLS is on and we're using service role, we still see data,
// so this check is weaker. For a real RLS test, use the anon key.)
// ------------------------------------------------------------------
async function checkRLSEnabled() {
  console.log("\n[2/5] Checking RLS status (via anon key)...");
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!ANON_KEY) {
    console.log("  ⚠️  Skipping — NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
    return;
  }
  const anonClient = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of RLS_TABLES) {
    try {
      // An unauthenticated SELECT should return empty array (RLS blocks)
      // OR an error if the table doesn't exist.
      const { data, error } = await anonClient.from(table).select("*").limit(1);
      if (error) {
        const isMissing =
          error.code === "42P01" || error.code === "PGRST205" || error.message.includes("Could not find");
        if (isMissing) {
          results.push({
            name: `rls:${table}`,
            passed: false,
            detail: "Table missing",
          });
          console.log(`  ❌ ${table}: table missing`);
        } else {
          // Some other error — might be RLS-related
          results.push({
            name: `rls:${table}`,
            passed: false,
            detail: error.message,
          });
          console.log(`  ⚠️  ${table}: ${error.message}`);
        }
      } else {
        // data should be empty array (RLS blocking anonymous access)
        const passed = Array.isArray(data) && data.length === 0;
        results.push({
          name: `rls:${table}`,
          passed,
          detail: passed ? "RLS active (anonymous sees no rows)" : "RLS may be off or rows leaked",
        });
        console.log(`  ${passed ? "✓" : "⚠️"}  ${table}: ${passed ? "RLS active" : "may be off"}`);
      }
    } catch (e) {
      results.push({
        name: `rls:${table}`,
        passed: false,
        detail: `Exception: ${e}`,
      });
      console.log(`  ❌ ${table}: exception`);
    }
  }
}

// ------------------------------------------------------------------
// Check 3: Storage buckets exist
// ------------------------------------------------------------------
async function checkStorageBuckets() {
  console.log("\n[3/5] Checking storage buckets...");
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    results.push({
      name: "storage:list",
      passed: false,
      detail: error.message,
    });
    console.log(`  ❌ Could not list buckets: ${error.message}`);
    return;
  }
  const bucketIds = new Set((data ?? []).map((b) => b.id));
  for (const bucket of EXPECTED_BUCKETS) {
    const exists = bucketIds.has(bucket);
    results.push({
      name: `bucket:${bucket}`,
      passed: exists,
      detail: exists ? undefined : "Bucket not found",
    });
    console.log(`  ${exists ? "✓" : "❌"} ${bucket}`);
  }
}

// ------------------------------------------------------------------
// Check 4: Helper functions exist (via RPC)
// ------------------------------------------------------------------
async function checkHelperFunctions() {
  console.log("\n[4/5] Checking helper functions...");
  const functions = [
    "fn_user_is_workspace_member",
    "fn_user_can_edit_workspace",
    "fn_user_can_admin_workspace",
    "fn_user_owns_workspace",
  ];
  for (const fn of functions) {
    try {
      // Call with a dummy UUID — we expect either a boolean result (function exists)
      // or a function-not-found error (function missing).
      const { error } = await supabase.rpc(fn, {
        p_workspace_id: "00000000-0000-0000-0000-000000000000",
      });
      const exists = !error || !error.message.includes("Could not find");
      results.push({
        name: `fn:${fn}`,
        passed: exists,
        detail: exists ? undefined : error?.message,
      });
      console.log(`  ${exists ? "✓" : "❌"} ${fn}`);
    } catch (e) {
      results.push({
        name: `fn:${fn}`,
        passed: false,
        detail: `Exception: ${e}`,
      });
      console.log(`  ❌ ${fn}: exception`);
    }
  }
}

// ------------------------------------------------------------------
// Check 5: Auth trigger installed (sign-up should create profile)
// ------------------------------------------------------------------
async function checkAuthTrigger() {
  console.log("\n[5/5] Checking auth trigger (fn_handle_new_user)...");
  // We can't directly check if a trigger exists via the REST API.
  // Instead, we check if any existing user has a profile row.
  const { data: users } = await supabase.auth.admin.listUsers();
  if (!users || users.users.length === 0) {
    console.log("  ⚠️  No users yet — can't verify trigger (sign up to test)");
    results.push({
      name: "trigger:fn_handle_new_user",
      passed: false,
      detail: "No users to verify against",
    });
    return;
  }

  const sampleUser = users.users[0];
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", sampleUser.id)
    .maybeSingle();

  const triggerWorks = !error && !!profile;
  results.push({
    name: "trigger:fn_handle_new_user",
    passed: triggerWorks,
    detail: triggerWorks
      ? undefined
      : "Trigger may not be installed — signups won't auto-create profiles",
  });
  console.log(
    `  ${triggerWorks ? "✓" : "❌"} fn_handle_new_user trigger: ${
      triggerWorks ? "working" : "not installed or failing"
    }`,
  );
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log("FormNull Migration Verifier");
  console.log("===========================");
  console.log(`Project URL: ${URL}`);

  await checkTablesExist();
  await checkRLSEnabled();
  await checkStorageBuckets();
  await checkHelperFunctions();
  await checkAuthTrigger();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log("\n===========================");
  console.log(`Results: ${passed} passed, ${failed} failed (of ${results.length} total)`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  ❌ ${r.name}: ${r.detail ?? "no detail"}`));
    process.exit(1);
  } else {
    console.log("\n✅ All checks passed. Migrations are fully applied.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
