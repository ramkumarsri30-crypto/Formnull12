/**
 * Test whether Supabase exposes the SQL execution endpoint with the service-role key.
 * Tries several known endpoint shapes.
 */
import process from "node:process";

// Credentials come from the environment (.env.local — auto-loaded by bun).
// Never hardcode keys in committed files.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error(
    "Missing env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (bun loads it automatically).",
  );
  process.exit(1);
}

const candidates = [
  {
    name: "POST /pg/query (json body)",
    url: `${URL}/pg/query`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      } as Record<string, string>,
      body: JSON.stringify({ query: "SELECT 1 AS ok;" }),
    },
  },
  {
    name: "POST /rest/v1/rpc (no fn)",
    url: `${URL}/rest/v1/`,
    init: {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      } as Record<string, string>,
    },
  },
];

for (const c of candidates) {
  try {
    const res = await fetch(c.url, c.init);
    const text = await res.text();
    console.log(
      `[${c.name}] status=${res.status} content-type=${res.headers.get("content-type")}`,
    );
    console.log(`  body (first 400 chars): ${text.slice(0, 400)}`);
  } catch (e) {
    console.log(`[${c.name}] error: ${e}`);
  }
  console.log("---");
}
