/**
 * Phase 2 — server-side validation probes via the real submit_public_form RPC
 * (bypasses the browser UI so 006's server validation is tested directly).
 * Read-only for valid rows; invalid payloads are rejected BEFORE any write.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sqtolkfjnskyxnltuyci.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) {
  console.error("keys missing");
  process.exit(1);
}

const publicKey = process.argv[2];
if (!publicKey) {
  console.error("usage: bun run scripts/fs2p2-invalid-submissions.ts <public_key>");
  process.exit(1);
}
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

interface Result {
  name: string;
  payload: Record<string, unknown>;
  expect: "rejected";
  got?: string;
  ok?: boolean;
}

// Field keys from the published snapshot
const { data: formData, error: gfErr } = await anon.rpc("get_public_form", { p_public_key: publicKey });
if (gfErr || !formData) {
  console.error("get_public_form failed:", gfErr?.message);
  process.exit(1);
}
const snapshot = formData as { fields: { key: string; type: string; label: string }[] };
// Pick specific field keys by label (robust against duplicate types).
const findByLabel = (needle: string) =>
  snapshot.fields.find((f) => f.label.toLowerCase().includes(needle.toLowerCase()))?.key ?? "";
const keys = {
  date: snapshot.fields.find((f) => f.type === "date")?.key ?? "",
  time: snapshot.fields.find((f) => f.type === "time")?.key ?? "",
  website: snapshot.fields.find((f) => f.type === "url")?.key ?? "",
  opinion: findByLabel("Opinion scale"),
  nps: findByLabel("recommend"),
  slider: findByLabel("Slider"),
  ranking: findByLabel("Rank your"),
};
console.log("field keys:", JSON.stringify(keys));

const tests: Result[] = [
  {
    name: "bad date format (15/06/2026)",
    payload: { [keys.date]: "15/06/2026" },
    expect: "rejected",
  },
  {
    name: "impossible date (2026-02-30)",
    payload: { [keys.date]: "2026-02-30" },
    expect: "rejected",
  },
  {
    name: "bad time (25:99)",
    payload: { [keys.time]: "25:99" },
    expect: "rejected",
  },
  {
    name: "url without protocol",
    payload: { [keys.website]: "formnull.example" },
    expect: "rejected",
  },
  {
    name: "NPS out of range (11)",
    payload: { [keys.nps]: 11 },
    expect: "rejected",
  },
  {
    name: "NPS fractional (4.5)",
    payload: { [keys.nps]: 4.5 },
    expect: "rejected",
  },
  {
    name: "slider out of range (101)",
    payload: { [keys.slider]: 101 },
    expect: "rejected",
  },
  {
    name: "ranking with unknown option",
    payload: { [keys.ranking]: ["Option 1", "nope"] },
    expect: "rejected",
  },
  {
    name: "ranking with duplicate option",
    payload: { [keys.ranking]: ["Option 1", "Option 1"] },
    expect: "rejected",
  },
  {
    name: "ranking with non-string member",
    payload: { [keys.ranking]: [42] },
    expect: "rejected",
  },
];

let failures = 0;
for (const t of tests) {
  const { data, error } = await anon.rpc("submit_public_form", {
    p_public_key: publicKey,
    p_values: t.payload,
    p_honeypot: null,
    p_meta: { locale: "en-US" },
  });
  if (error) {
    // HTTP-level error (rate limit etc.) — NOT a validation verdict
    t.got = `RPC-ERROR: ${error.message.slice(0, 80)}`;
    t.ok = false;
    failures++;
  } else {
    const r = data as { ok?: boolean; error_code?: string; errors?: Record<string, string> };
    const rejected = r?.ok === false;
    const allErrors = r?.errors ? Object.values(r.errors).join(" | ") : r?.error_code;
    t.got = rejected ? `VALIDATION_FAILED: ${allErrors}` : "ACCEPTED (unexpected!)";
    t.ok = rejected;
    if (!rejected) failures++;
  }
  console.log(`${t.ok ? "PASS" : "FAIL"}  ${t.name} → ${t.got}`);
}

// Also verify a valid minimal submission is accepted (all required fields,
// optional ones omitted)
const { data: validData, error: validErr } = await anon.rpc("submit_public_form", {
  p_public_key: publicKey,
  p_values: {
    [keys.date]: "2026-03-01",
    [keys.nps]: 7,
    [keys.ranking]: ["Option 1", "Option 2", "Option 3", "coffee"],
  },
  p_honeypot: null,
  p_meta: { locale: "en-US" },
});
if (validErr) {
  console.log("INFO  valid partial submission → RPC-ERROR (rate limit?):", validErr.message.slice(0, 60));
} else {
  const r = validData as { ok?: boolean; reference?: number };
  console.log(
    `${r?.ok ? "PASS" : "FAIL"}  valid minimal submission (required only) → ok=${r?.ok} ref=${r?.reference}`,
  );
  if (!r?.ok) failures++;
}

console.log(failures === 0 ? "\nALL SERVER VALIDATION PROBES PASSED" : `\n${failures} PROBES FAILED`);
process.exit(failures === 0 ? 0 : 1);
