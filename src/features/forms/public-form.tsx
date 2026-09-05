"use client";

/**
 * FormNull — Public Form (Phase 3)
 * =====================================================================
 * The respondent-facing form at /f/{public_key}/.
 *
 *   load  : get_public_form(key)   — migration 006, anon-executable,
 *                                    snapshot-only read (no live table
 *                                    access, no existence oracle)
 *   submit: submit_public_form(key, values, honeypot, meta) — 006
 *
 * Renders through the SAME shared FormRenderer as the builder preview
 * and canvas — the respondent sees exactly what the builder previewed.
 * Client-side validation (validateAllValues) is UX only; 006
 * re-validates every answer server-side before anything is written.
 *
 * Honeypot: a visually-hidden, tab-unreachable input. Bots that fill
 * it get 006's fake-success (identical response shape) — humans never
 * see it. p_meta carries only page metadata the RPC whitelists
 * (referrer / locale / timezone offset).
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  GeometricCircle,
  GeometricTriangle,
  DotPattern,
} from "@/components/memphis/memphis-decorations";
import { Logo } from "@/components/formnull/logo";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isSubmittableType } from "./field-registry";
import {
  FormRenderer,
  snapshotToModel,
  validateAllValues,
  type RenderableFormField,
  type RenderableFormHeader,
} from "./form-renderer";
import {
  readThankYouSettings,
  readWelcomeSettings,
  ThankYouScreen,
} from "./welcome-thankyou";
import { Check, Loader2, TriangleAlert, FileText } from "lucide-react";

type Phase = "loading" | "error" | "ready" | "submitting" | "success";

interface PublicFormState {
  phase: Phase;
  errorTitle: string;
  errorDetail: string | null;
  form: RenderableFormHeader | null;
  fields: RenderableFormField[];
  reference: number | null;
}
/** Map submit_public_form's coded errors to respondent-friendly text. */
function submitErrorText(rawMessage: string): { title: string; detail: string } {
  const code = rawMessage.split(":")[0]?.trim() ?? "";
  switch (code) {
    case "NOT_FOUND":
      return {
        title: "This form is closed",
        detail: "It was unpublished or never existed. Contact the form owner for a valid link.",
      };
    case "FORM_CLOSED":
      return {
        title: "This form is not accepting responses",
        detail: "The owner paused or archived it. Try again later.",
      };
    case "RATE_LIMITED":
      return {
        title: "Too many submissions",
        detail: "You have submitted several times in a short period — please wait a few minutes.",
      };
    case "SNAPSHOT_INVALID":
      return {
        title: "This form is unavailable",
        detail: "The published form data is malformed. Contact the person who sent you this link.",
      };
    case "INVALID_PAYLOAD":
    case "PAYLOAD_TOO_LARGE":
    case "TOO_MANY_KEYS":
      return {
        title: "Submission rejected",
        detail: "The submitted answers did not match the form. Refresh and try again.",
      };
    default:
      return { title: "Submission failed", detail: rawMessage };
  }
}

function loadErrorText(rawMessage: string): { title: string; detail: string } {
  const code = rawMessage.split(":")[0]?.trim() ?? "";
  if (code === "NOT_FOUND" || code === "FORM_CLOSED") {
    return {
      title: "This form is unavailable",
      detail:
        "The link may be wrong, or the form is closed. If you followed a shared link, contact the person who sent it.",
    };
  }
  return { title: "Could not load this form", detail: rawMessage };
}

export function PublicForm({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PublicFormState>({
    phase: "loading",
    errorTitle: "",
    errorDetail: null,
    form: null,
    fields: [],
    reference: null,
  });
  const [honeypot, setHoneypot] = useState("");
  const [submitError, setSubmitError] = useState<{ title: string; detail: string } | null>(null);
  /** A Stripe payment reference for THIS form's payment field, captured
   *  from the ?payment= return parameter after a checkout redirect. */
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  /** Per-field messages from submit_public_form's structured failure
   *  path (HTTP 200 + ok:false — nothing was written). Threaded into
   *  the FormRenderer so they render with the same per-field error
   *  chrome as client-side validation, exactly as 006 documents. */
  const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, phase: "loading" }));
    try {
      const { data, error } = await supabaseBrowser.rpc("get_public_form", {
        p_public_key: publicKey,
      });
      if (error) {
        const t = loadErrorText(error.message);
        setState((s) => ({ ...s, phase: "error", errorTitle: t.title, errorDetail: t.detail }));
        return;
      }
      const model = snapshotToModel(data as Record<string, unknown>);
      if (!model) {
        setState((s) => ({
          ...s,
          phase: "error",
          errorTitle: "This form is unavailable",
          errorDetail: "The published data is malformed.",
        }));
        return;
      }
      setState((s) => ({
        ...s,
        phase: "ready",
        form: model.form,
        fields: model.fields,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        phase: "error",
        errorTitle: "Could not load this form",
        errorDetail: e instanceof Error ? e.message : "Please try again.",
      }));
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stripe Checkout returns with ?payment={ref} on success — keep it
  // for the submit flow (sessionStorage survives the redirect).
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const ref = url.searchParams.get("payment");
      if (ref && /^[A-Za-z0-9_-]{8,64}$/.test(ref)) {
        setPaymentRef(ref);
        sessionStorage.setItem(`formnull:payment:${publicKey}`, ref);
        // Clean the URL so a refresh does not re-apply a stale param.
        url.searchParams.delete("payment");
        window.history.replaceState({}, "", url.toString());
        return;
      }
      const stored = sessionStorage.getItem(`formnull:payment:${publicKey}`);
      if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) setPaymentRef(stored);
    } catch {
      /* URL APIs unavailable — payment return flow disabled */
    }
  }, [publicKey]);

  /** Upload one signature drawing → private storage → answer token.
   *  Runs only on the real public form (never in preview/builder). */
  async function uploadSignature(fieldKey: string, dataUrl: string): Promise<unknown> {
    const blob = await (await fetch(dataUrl)).blob();
    const name = "signature.png";
    const { data: intent, error: rpcError } = await supabaseBrowser.rpc(
      "create_upload_intent",
      {
        p_public_key: publicKey,
        p_field_key: fieldKey,
        p_file_name: name,
        p_mime_type: "image/png",
        p_size_bytes: blob.size,
      },
    );
    if (rpcError) throw rpcError;
    const r = intent as { token?: string; path?: string } | null;
    if (!r?.token || !r?.path) throw new Error("Upload intent returned no path.");
    await new Promise<void>((resolve, reject) => {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/form-uploads/${r.path}`;
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`);
      xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
      xhr.upload.onprogress = () => {
        /* signature PNGs are small — no progress UI needed */
      };
      xhr.onerror = () => reject(new Error("Network error during signature upload."));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Storage rejected the signature (HTTP ${xhr.status}).`));
      };
      xhr.send(blob);
    });
    return r.token;
  }

  /**
   * Start a Stripe Checkout session for a required payment field.
   * The route is honest: without STRIPE_SECRET_KEY it refuses with
   * PAYMENT_NOT_CONFIGURED (never a fake success). With keys, the
   * respondent is redirected to Stripe and returns with ?payment=.
   */
  async function startPayment(fieldKey: string): Promise<"redirecting" | "error"> {
    const ref = crypto.randomUUID();
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, fieldKey, paymentRef: ref }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.status === 200 && body.url) {
        window.location.assign(body.url);
        return "redirecting";
      }
      const code = body.error ?? "";
      if (code === "PAYMENT_NOT_CONFIGURED") {
        setSubmitError({
          title: "Payment is not available on this form",
          detail:
            "The form owner has not finished payment configuration. Nothing was charged and your answers were not submitted — contact them for a working link.",
        });
      } else {
        setSubmitError({
          title: "Could not start payment",
          detail: code || `The payment service responded with ${res.status}.`,
        });
      }
      return "error";
    } catch {
      setSubmitError({
        title: "Could not start payment",
        detail: "A network error interrupted the checkout. Please try again.",
      });
      return "error";
    }
  }

  async function onSubmit(values: Record<string, unknown>) {
    // Client validation is UX only — strip keys with undefined (absent
    // answers) and let the server be the real authority.
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      if (v === "") continue;
      clean[k] = v;
    }
    // Defense-in-depth: never send unknown keys (the server rejects
    // them). Registry-driven: only types submit_public_form accepts.
    const known = new Set(
      state.fields.filter((f) => isSubmittableType(f.field_type)).map((f) => f.field_key),
    );
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(clean)) {
      if (known.has(k)) payload[k] = v;
    }

    // ── Signature fields: convert local drawings to storage tokens ──
    for (const f of state.fields) {
      if (f.field_type !== "signature") continue;
      const v = payload[f.field_key];
      if (typeof v === "string" && v.startsWith("data:image/png")) {
        setState((s) => ({ ...s, phase: "submitting" }));
        try {
           
          payload[f.field_key] = await uploadSignature(f.field_key, v);
        } catch (e) {
          setState((s) => ({ ...s, phase: "ready" }));
          setSubmitError({
            title: "Could not save the signature",
            detail: e instanceof Error ? e.message : "Please draw it again and resubmit.",
          });
          return;
        }
      }
    }

    // ── Required payment: checkout must complete BEFORE storing ──
    const paymentField = state.fields.find(
      (f) => f.field_type === "payment" && f.is_required,
    );
    if (paymentField) {
      if (!paymentRef) {
        const outcome = await startPayment(paymentField.field_key);
        if (outcome === "redirecting") {
          // Leaving for Stripe — answers stay on the page via bfcache +
          // the return parameter flow.
          setState((s) => ({ ...s, phase: "ready" }));
          return;
        }
        setState((s) => ({ ...s, phase: "ready" }));
        return;
      }
    }

    setState((s) => ({ ...s, phase: "submitting" }));
    setSubmitError(null);
    try {
      const meta: Record<string, unknown> = {
        page_referrer: typeof document !== "undefined" ? document.referrer || null : null,
        locale: typeof navigator !== "undefined" ? navigator.language : null,
      };
      if (paymentRef) meta.payment_ref = paymentRef;
      const { data, error } = await supabaseBrowser.rpc("submit_public_form", {
        p_public_key: publicKey,
        p_values: payload,
        p_honeypot: honeypot || null,
        p_meta: meta,
      });
      if (error) {
        setSubmitError(submitErrorText(error.message));
        setState((s) => ({ ...s, phase: "ready" }));
        return;
      }
      const r = data as
        | {
            ok?: boolean;
            reference?: number | null;
            error_code?: string;
            errors?: Record<string, string>;
          }
        | null;
      // Structured validation failure (006/007): HTTP 200 with
      // ok:false + per-field messages, and NOTHING was persisted.
      // Showing the thank-you page here would be a silent data loss —
      // render the server's messages on the form instead.
      if (r && r.ok === false) {
        const errs =
          r.errors && typeof r.errors === "object" && !Array.isArray(r.errors)
            ? r.errors
            : {};
        setServerErrors(errs);
        setSubmitError({
          title: "Some answers need attention",
          detail:
            Object.keys(errs).length > 0
              ? "Please fix the highlighted answers and submit again."
              : "The submitted answers did not pass validation. Please try again.",
        });
        setState((s) => ({ ...s, phase: "ready" }));
        return;
      }
      setServerErrors(null);
      const reference = typeof r?.reference === "number" ? r.reference : null;
      setState((s) => ({ ...s, phase: "success", reference }));
    } catch (e) {
      setSubmitError({
        title: "Submission failed",
        detail: e instanceof Error ? e.message : "Please try again.",
      });
      setState((s) => ({ ...s, phase: "ready" }));
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Memphis backdrop */}
      <DotPattern className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
      <GeometricCircle
        color="coral"
        size={120}
        className="pointer-events-none absolute -top-10 -left-10 opacity-20"
      />
      <GeometricTriangle
        color="violet"
        size={110}
        rotate={18}
        className="pointer-events-none absolute top-1/3 -right-14 opacity-20"
      />
      <GeometricCircle
        color="mint"
        size={90}
        className="pointer-events-none absolute -bottom-8 left-1/4 opacity-20"
      />

      {/* Header */}
      <header className="relative z-10 px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Logo />
        </div>
      </header>

      {/* Body */}
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 py-6 sm:px-6 sm:py-10">
        <div className="w-full max-w-2xl">
          {state.phase === "loading" && (
            <div
              className="flex items-center justify-center gap-3 rounded-2xl border-2 border-foreground/10 bg-surface p-12"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Loading form…</p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-8 text-center shadow-[6px_6px_0_0_var(--memphis-ink)]">
              <GeometricTriangle color="coral" size={22} rotate={-12} className="mx-auto mb-4 opacity-80" />
              <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                {state.errorTitle}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {state.errorDetail}
              </p>
            </div>
          )}

          {state.phase === "success" && (() => {
            const thankyou = readThankYouSettings(state.form?.settings);
            if (thankyou) {
              return (
                <ThankYouScreen
                  fallbackTitle="Thank you — response received"
                  fallbackDescription={`${state.form?.name ?? "Your response"} has been recorded. You can close this page.`}
                  thankyou={thankyou}
                  reference={state.reference}
                />
              );
            }
            return (
            <div
              className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-8 text-center shadow-[6px_6px_0_0_var(--memphis-ink)]"
              role="status"
              aria-live="polite"
            >
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--memphis-mint)]/15 text-[color:var(--memphis-mint)]">
                <Check className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                Thank you — response received
              </h1>
              {state.reference !== null && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your reference number is{" "}
                  <span className="font-mono font-semibold text-foreground">
                    #{state.reference}
                  </span>
                  .
                </p>
              )}
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                {state.form?.name} has been recorded. You can close this page.
              </p>
            </div>
            );
          })()}

          {(state.phase === "ready" || state.phase === "submitting") && state.form && (
            <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 shadow-[6px_6px_0_0_var(--memphis-ink)] sm:p-8">
              {/* Honeypot — invisible to humans, unreachable by tab */}
              <input
                type="text"
                name="company_website"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
              />

              {submitError && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-destructive">{submitError.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-destructive/90">
                      {submitError.detail}
                    </p>
                  </div>
                </div>
              )}

              <FormRenderer
                form={state.form}
                fields={state.fields}
                mode="public"
                onSubmit={onSubmit}
                submitting={state.phase === "submitting"}
                serverErrors={serverErrors ?? undefined}
                formPublicKey={publicKey}
                paymentRef={paymentRef}
              />
            </div>
          )}

          {(state.phase === "ready" || state.phase === "submitting") && state.fields.length === 0 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              This published form has no answer fields.
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-4 py-5 text-center sm:px-6">
        <p className="text-[11px] text-muted-foreground/70">
          Powered by FormNull — responses are validated and stored server-side.
        </p>
      </footer>
    </div>
  );
}

/* Re-export for the page shell (keeps the page file minimal). */
export { validateAllValues as _validateAllValues };
