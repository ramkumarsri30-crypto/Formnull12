/**
 * Probe more Supabase HTTP endpoints to find a SQL execution path.
 */
export {};

import process from "node:process";

// Credentials come from the environment (.env.local — auto-loaded by bun).
// Never hardcode keys in committed files.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Missing env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (bun loads it automatically).",
  );
  process.exit(1);
}

const paths = [
  "/pg",
  "/pg/sql",
  "/pg/exec",
  "/sql",
  "/db/query",
  "/database/query",
  "/rest/v1/rpc/exec_sql",
];

for (const p of paths) {
  try {
    const res = await fetch(`${URL}${p}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ query: "SELECT 1;" }),
    });
    const text = await res.text();
    console.log(
      `[${p}] status=${res.status} ct=${res.headers.get("content-type")}`,
    );
    console.log(`  body: ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`[${p}] error: ${e}`);
  }
  console.log("---");
}

// Also try GET /auth/v1/health to make sure the project is alive
try {
  const res = await fetch(`${URL}/auth/v1/health`, {
    headers: { apikey: KEY },
  });
  console.log(
    `[/auth/v1/health] status=${res.status} body=${(await res.text()).slice(0, 200)}`,
  );
} catch (e) {
  console.log(`[/auth/v1/health] error: ${e}`);
}
