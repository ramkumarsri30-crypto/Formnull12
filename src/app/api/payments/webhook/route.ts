import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Stripe webhook (Field Expansion phase).
 * =====================================================================
 * POST /api/payments/webhook  (called by Stripe)
 *
 * Verifies the Stripe-Signature header (t=…,v1=… — HMAC-SHA256 of
 * `${timestamp}.${rawBody}` with STRIPE_WEBHOOK_SECRET, implemented
 * with node:crypto — no SDK dependency) and, for
 * checkout.session.completed events, marks the matching payments row
 * (matched by client_reference_id = the paymentRef the client
 * generated) succeeded via the service-role client.
 *
 * HONESTY CONTRACT: without STRIPE_WEBHOOK_SECRET this route responds
 * 503 and never fabricates a succeeded payment. Failed verification →
 * 400. Nothing else is mutated.
 */
function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = header.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim().length < 10) {
    return NextResponse.json(
      { error: "WEBHOOK_NOT_CONFIGURED", detail: "Stripe webhook secret is not set." },
      { status: 503 },
    );
  }

  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const ref = typeof session.client_reference_id === "string" ? session.client_reference_id : null;
    const paymentStatus = typeof session.payment_status === "string" ? session.payment_status : "";
    if (ref && paymentStatus === "paid") {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceKey) {
        return NextResponse.json({ error: "SERVER_NOT_CONFIGURED" }, { status: 500 });
      }
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { error } = await admin
        .from("payments")
        .update({ status: "succeeded", updated_at: new Date().toISOString() })
        .eq("provider_ref", ref)
        .eq("status", "pending");
      if (error) {
        return NextResponse.json({ error: "UPDATE_FAILED", detail: error.message }, { status: 500 });
      }
    }
  }

  // Stripe expects 2xx for handled events.
  return NextResponse.json({ received: true });
}
