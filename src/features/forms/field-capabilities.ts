"use client";

/**
 * FormNull — Field Capabilities (runtime migration detection)
 * =====================================================================
 * The Field Expansion phase ships its server contracts in migration
 * 008 (new enum values, upload/payments/bookings tables, RPCs). 008
 * is applied by the project owner manually — the app must behave
 * honestly BOTH before and after that apply:
 *
 *   BEFORE 008: contact_info / payment / scheduler / embed fields
 *     cannot even be INSERTed (the field_type enum rejects them), and
 *     file_upload / signature stay publish-blocked (006's contract).
 *     The library shows them as unavailable rather than letting a
 *     builder hit a raw enum error.
 *
 *   AFTER 008: everything flips live automatically — no code change,
 *     no redeploy. The builder detects the migration ONCE per page
 *     load through a cheap, read-only REST probe.
 *
 * PROBE DESIGN (no fake states, no existence oracle):
 *   POST /rest/v1/rpc/create_upload_intent with a deliberately
 *   unknown public key. The function only exists after 008:
 *     - pre-008  → PGRST202 "function not found in the schema cache"
 *     - post-008 → a domain error (NOT_FOUND / INVALID_...) proving
 *                  the 008 RPC is live
 *   One request per builder page load, module-cached, anonymous-key
 *   safe (the RPC is anon-executable). A failed probe (network error)
 *   reports "unknown" — the UI then hides the gated types rather
 *   than showing them broken; refreshing re-probes.
 */
import { supabaseBrowser } from "@/lib/supabase/client";

export interface FieldCapabilities {
  /** null = not probed yet / probe failed; true = migration 008 live. */
  v008: boolean | null;
}

let cached: FieldCapabilities = { v008: null };
let inflight: Promise<boolean> | null = null;

export function fieldCapabilities(): FieldCapabilities {
  return cached;
}

/**
 * Probe whether migration 008's RPCs exist on the live project.
 * Safe to call repeatedly — the result is cached module-wide and the
 * actual network request happens at most once per page load.
 */
export async function detectFieldCapabilities(): Promise<boolean> {
  if (cached.v008 !== null) return cached.v008;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { error } = await supabaseBrowser.rpc("create_upload_intent", {
        p_public_key: "00000000-0000-0000-0000-000000000000",
        p_field_key: "probe",
        p_file_name: "probe.txt",
        p_mime_type: "text/plain",
        p_size_bytes: 1,
      });
      if (!error) {
        // Unexpected but harmless: a call that SUCCEEDED means 008 is
        // live (only the honeypot-ish empty path could do this).
        cached = { v008: true };
        return true;
      }
      const msg = error.message ?? "";
      // PGRST202 = function missing from schema cache → pre-008.
      // Any other error (NOT_FOUND, INVALID_*, P0001 domain raise)
      // proves the 008 function body executed → post-008.
      const isMissing =
        msg.includes("PGRST202") ||
        /Could not find the function/i.test(msg) ||
        /does not exist/i.test(msg);
      cached = { v008: !isMissing };
      return !isMissing;
    } catch {
      // Network/probe failure: report unknown. Callers treat null as
      // "not available" (honest — never assume the migration ran).
      cached = { v008: null };
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
