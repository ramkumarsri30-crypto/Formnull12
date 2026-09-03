/**
 * Phase 3 verification: submission + values written by submit_public_form.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const rs = await fetch(
    `${url}/rest/v1/submissions?select=id,form_id,submission_seq,status,submitted_by,submitter_ip,is_complete,metadata&order=created_at.desc&limit=5`,
    { headers: h },
  );
  const subs = (await rs.json()) as Array<Record<string, unknown>>;
  console.log(`Submissions: ${subs.length}`);
  for (const s of subs) {
    console.log(
      `  seq=${s.submission_seq} status=${s.status} complete=${s.is_complete} submitted_by=${s.submitted_by} ip=${String(s.submitter_ip).slice(0, 12)}…`,
    );
    const rv = await fetch(
      `${url}/rest/v1/submission_values?select=field_key,value,value_number,value_boolean&submission_id=eq.${s.id}&order=created_at.asc`,
      { headers: h },
    );
    const vals = (await rv.json()) as Array<Record<string, unknown>>;
    for (const v of vals) {
      console.log(
        `    ${v.field_key} = ${JSON.stringify(v.value).slice(0, 70)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
