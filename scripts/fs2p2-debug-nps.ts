/** Debug: dump snapshot keys + full error map for one bad NPS submission. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const publicKey = process.argv[2];
const { data, error } = await anon.rpc("get_public_form", { p_public_key: publicKey });
const snapshot = data as { fields: { key: string; type: string; label: string }[] };
console.log("SNAPSHOT KEYS:");
for (const f of snapshot.fields) {
  console.log(`  type=${f.type.padEnd(13)} key="${f.key}" (len ${f.key.length}) label="${f.label.slice(0, 40)}"`);
}

const nps = snapshot.fields.find((f) => f.label.toLowerCase().includes("recommend"));
console.log("\nNPS key from snapshot:", JSON.stringify(nps?.key));

const { data: sub, error: subErr } = await anon.rpc("submit_public_form", {
  p_public_key: publicKey,
  p_values: { [nps?.key ?? "x"]: 11 },
  p_honeypot: null,
  p_meta: null,
});
console.log("\nSUBMIT RESULT:", JSON.stringify(sub), "error:", subErr?.message ?? null);
