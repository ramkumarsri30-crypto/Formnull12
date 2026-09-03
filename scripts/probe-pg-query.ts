/**
 * Probe: can we apply DDL/SQL to the live Supabase DB?
 * Strategies: 1) /pg/query HTTP endpoint  2) pg connection via DATABASE_URL
 * Read-only SELECT probe only — no writes.
 */
import process from "node:process";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Strategy 1: /pg/query endpoint
try {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: "select current_setting('server_version') as v;" }),
  });
  const body = await res.text();
  console.log("pg/query status:", res.status, "body:", body.slice(0, 300));
} catch (e) {
  console.log("pg/query FAILED:", e.message);
}

// Strategy 2: direct postgres via pg module (if installed)
try {
  const { Client } = await import("pg").catch(() => ({ Client: null }) as never);
  if (Client) {
    console.log("pg module available");
  } else {
    console.log("pg module NOT installed");
  }
} catch {
  console.log("pg module NOT installed");
}

// Check if postgres is available via bun
console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);
