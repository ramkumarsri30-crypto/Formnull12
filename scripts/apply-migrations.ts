/**
 * FormNull Migration Applier
 * =====================================================================
 * Applies all SQL files in supabase/migrations/ to the live Supabase project.
 *
 * Strategies (tried in order):
 *   1. Direct Postgres connection via DATABASE_URL env var (most reliable)
 *   2. Supabase /pg/query HTTP endpoint (if enabled on the project)
 *   3. Fallback: print instructions for manual application via Dashboard
 *
 * The migration files themselves are the source of truth. This script
 * is idempotent because every DDL statement uses IF NOT EXISTS / DO $$
 * blocks to avoid errors on re-application.
 *
 * Usage:
 *   bun run scripts/apply-migrations.ts
 *
 * Env vars (read from .env.local automatically by bun):
 *   NEXT_PUBLIC_SUPABASE_URL       — project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — server-only key
 *   DATABASE_URL                   — optional direct Postgres URL
 *                                    (e.g. postgresql://postgres:pass@host:5432/postgres)
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://sqtolkfjnskyxnltuyci.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

interface MigrationFile {
  name: string;
  path: string;
  content: string;
  size: number;
}

async function listMigrations(): Promise<MigrationFile[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
  const migrations: MigrationFile[] = [];
  for (const name of sqlFiles) {
    const path = join(MIGRATIONS_DIR, name);
    const content = await readFile(path, "utf8");
    const stats = await stat(path);
    migrations.push({ name, path, content, size: stats.size });
  }
  return migrations;
}

// ------------------------------------------------------------------
// Strategy 1: Direct Postgres connection (preferred when DATABASE_URL provided)
// ------------------------------------------------------------------
async function tryPostgresDirect(
  migrations: MigrationFile[],
): Promise<boolean> {
  if (!DATABASE_URL) {
    console.log(
      "[strategy 1] Skipping — DATABASE_URL not set. To enable direct Postgres connection, set DATABASE_URL=postgresql://postgres.{ref}:{password}@aws-0-{region}.pooler.supabase.com:6543/postgres",
    );
    return false;
  }

  console.log("[strategy 1] Attempting direct Postgres connection...");
  try {
    // Lazy import — pg is only needed if this strategy is used.
    const { Client } = await import("pg");
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    console.log("[strategy 1] Connected. Applying migrations...");
    for (const m of migrations) {
      console.log(`  → applying ${m.name} (${m.size} bytes)`);
      await client.query(m.content);
    }
    await client.end();
    console.log("[strategy 1] ✅ All migrations applied successfully.");
    return true;
  } catch (e) {
    console.log(`[strategy 1] ❌ Failed: ${e}`);
    return false;
  }
}

// ------------------------------------------------------------------
// Strategy 2: Supabase /pg/query HTTP endpoint
// ------------------------------------------------------------------
async function tryPgQueryEndpoint(
  migrations: MigrationFile[],
): Promise<boolean> {
  if (!SERVICE_KEY) {
    console.log(
      "[strategy 2] Skipping — SUPABASE_SERVICE_ROLE_KEY not set.",
    );
    return false;
  }

  console.log("[strategy 2] Probing Supabase /pg/query endpoint...");
  try {
    const probe = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: "SELECT 1 AS ok;" }),
    });
    if (!probe.ok) {
      console.log(
        `[strategy 2] ❌ Endpoint returned ${probe.status}. Not available on this project.`,
      );
      return false;
    }
    console.log("[strategy 2] /pg/query available. Applying migrations...");
    for (const m of migrations) {
      console.log(`  → applying ${m.name} (${m.size} bytes)`);
      const res = await fetch(`${SUPABASE_URL}/pg/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ query: m.content }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.log(`    ❌ Failed (${res.status}): ${text.slice(0, 500)}`);
        return false;
      }
    }
    console.log("[strategy 2] ✅ All migrations applied successfully.");
    return true;
  } catch (e) {
    console.log(`[strategy 2] ❌ Failed: ${e}`);
    return false;
  }
}

// ------------------------------------------------------------------
// Strategy 3: Fallback — print instructions
// ------------------------------------------------------------------
function printManualInstructions(migrations: MigrationFile[]): void {
  console.log("\n============================================================");
  console.log(" MANUAL MIGRATION REQUIRED");
  console.log("============================================================");
  console.log(
    "Could not apply migrations automatically. To apply manually:",
  );
  console.log("");
  console.log("1. Open your Supabase Dashboard:");
  console.log(`   https://supabase.com/dashboard/project/sqtolkfjnskyxnltuyci/sql/new`);
  console.log("");
  console.log("2. For EACH file below (in order):");
  console.log("   a. Open the file, copy its entire contents.");
  console.log("   b. Paste into the SQL Editor.");
  console.log("   c. Click Run.");
  console.log("");
  console.log("   Migration files to apply (in this exact order):");
  for (const m of migrations) {
    console.log(`     • ${m.path}`);
  }
  console.log("");
  console.log("3. After all migrations are applied, run the verifier:");
  console.log("   bun run scripts/verify-migrations.ts");
  console.log("============================================================\n");
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log("FormNull Migration Applier");
  console.log("==========================");
  console.log(`Project URL: ${SUPABASE_URL}`);
  console.log(`Service key: ${SERVICE_KEY ? "✓ present" : "✗ missing"}`);
  console.log(`Database URL: ${DATABASE_URL ? "✓ present" : "✗ not set"}`);
  console.log("");

  const migrations = await listMigrations();
  if (migrations.length === 0) {
    console.log("No migration files found. Exiting.");
    process.exit(0);
  }

  console.log(`Found ${migrations.length} migration file(s):`);
  for (const m of migrations) {
    console.log(`  • ${m.name} (${m.size} bytes)`);
  }
  console.log("");

  // Try strategies in order
  const ok =
    (await tryPostgresDirect(migrations)) ||
    (await tryPgQueryEndpoint(migrations));

  if (!ok) {
    printManualInstructions(migrations);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
