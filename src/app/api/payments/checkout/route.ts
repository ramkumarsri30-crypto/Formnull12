import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Stripe Checkout session creation (Field Expansion phase).
 * =====================================================================
 * POST /api/payments/checkout  { publicKey, fieldKey, paymentRef }
 *
 * The production payment flow, honestly split:
 *
 *   1. create_payment_intent RPC (migration 008) — validates the field
 *      against the PUBLISHED snapshot and writes a PENDING payments
 *      row keyed by the client-generated paymentRef.
 *   2. Stripe Checkout Session (REST API — no SDK dependency) using
 *      STRIPE_SECRET_KEY. The session's client_reference_id is the
 *      paymentRef; success returns to /f/{key}/?payment={ref}.
 *   3. The webhook (/api/payments/webhook) marks the payments row
 *      succeeded; submit_public_form then verifies it server-side
 *      before storing the submission.
 *
 * HONESTY CONTRACT: without STRIPE_SECRET_KEY this route responds
 * 503 PAYMENT_NOT_CONFIGURED and never pretends a charge happened.
 * Card data only ever touches Stripe's hosted page — nothing
 * card-related reaches this app.
 */
export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.trim().length < 20) {
    return NextResponse.json(
      { error: "PAYMENT_NOT_CONFIGURED", detail: "Stripe is not configured for this deployment." },
      { status: 503 },
    );
  }

  let body: { publicKey?: string; fieldKey?: string; paymentRef?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
  const fieldKey = typeof body.fieldKey === "string" ? body.fieldKey : "";
  const paymentRef = typeof body.paymentRef === "string" ? body.paymentRef : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicKey) || !/^[a-z0-9_]{1,64}$/.test(fieldKey)) {
    return NextResponse.json({ error: "INVALID_ARGS" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(paymentRef)) {
    return NextResponse.json({ error: "INVALID_PAYMENT_REF" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: "SERVER_NOT_CONFIGURED" }, { status: 500 });
  }

  // (1) Payment intent against the published snapshot. The anon key is
  // the correct credential: create_payment_intent is anon-executable
  // and performs its own snapshot validation.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: intent, error: intentError } = await anon.rpc("create_payment_intent", {
    p_public_key: publicKey,
    p_field_key: fieldKey,
    p_provider_ref: paymentRef,
  });
  if (intentError) {
    return NextResponse.json(
      { error: intentError.message?.split(":")[0] ?? "INTENT_FAILED", detail: intentError.message },
      { status: 400 },
    );
  }
  const r = intent as { payment_id?: string; amount_cents?: number; currency?: string } | null;
  if (!r?.payment_id || typeof r.amount_cents !== "number" || !r.currency) {
    return NextResponse.json({ error: "INTENT_FAILED" }, { status: 400 });
  }

  // (2) Stripe Checkout Session via the REST API (form-encoded).
  const origin = new URL(req.url).origin;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", paymentRef);
  params.set("success_url", `${origin}/f/${publicKey}/?payment=${paymentRef}`);
  params.set("cancel_url", `${origin}/f/${publicKey}/`);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", r.currency.toLowerCase());
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(r.amount_cents)));
  params.set("line_items[0][price_data][product_data][name]", "Form submission payment");
  params.set("metadata[form_public_key]", publicKey);
  params.set("metadata[field_key]", fieldKey);
  params.set("metadata[payment_id]", r.payment_id);

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = (await res.json()) as { url?: string; id?: string; error?: { message?: string } };
    if (!res.ok || !session.url) {
      return NextResponse.json(
        { error: "STRIPE_ERROR", detail: session.error?.message ?? `HTTP ${res.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    return NextResponse.json(
      { error: "STRIPE_UNREACHABLE", detail: e instanceof Error ? e.message : "network error" },
      { status: 502 },
    );
  }
}
