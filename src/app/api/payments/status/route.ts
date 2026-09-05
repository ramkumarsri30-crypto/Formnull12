import { NextResponse } from "next/server";

/**
 * Payment configuration status (Field Expansion phase).
 *
 * GET /api/payments/status
 *   → { configured: boolean, live: boolean }
 *
 * `configured` = a Stripe secret key exists in this app's environment.
 * Deliberately answers ONLY that — no key material, no hints about its
 * format, nothing else. The public form and the publish dialog use it
 * to be honest about whether payment fields can actually process
 * charges right now (never a fake "works" state).
 */
export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY;
  return NextResponse.json({
    configured: typeof key === "string" && key.trim().length > 20,
    live: typeof key === "string" && key.trim().startsWith("sk_live_"),
  });
}
