/**
 * Helper script to confirm a user's email using the service role key.
 * Used for testing only — production users confirm via email link.
 */
import { createClient } from "@supabase/supabase-js";

// Credentials come from the environment (.env.local — auto-loaded by bun).
// Never hardcode keys in committed files.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Missing env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (bun loads it automatically).",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = process.argv[2] ?? "formnull.test@gmail.com";

const { data, error } = await supabase.auth.admin.listUsers();
if (error) {
  console.error("Failed to list users:", error.message);
  process.exit(1);
}

const user = data.users.find((u) => u.email === email);
if (!user) {
  console.error(`User with email ${email} not found.`);
  console.log("All users:", data.users.map((u) => u.email));
  process.exit(1);
}

console.log(`Found user: ${user.id} (${user.email})`);
console.log(`  email_confirmed_at: ${user.email_confirmed_at ?? "null"}`);

if (user.email_confirmed_at) {
  console.log("  Already confirmed.");
  process.exit(0);
}

const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(
  user.id,
  { email_confirm: true },
);

if (updateErr) {
  console.error("Failed to confirm:", updateErr.message);
  process.exit(1);
}

console.log(`  ✅ Confirmed. email_confirmed_at = ${updated.user?.email_confirmed_at}`);
