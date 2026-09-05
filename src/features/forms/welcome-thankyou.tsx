"use client";

/**
 * FormNull — Welcome & Thank-you screens (Field Expansion phase)
 * =====================================================================
 * Configurable screens stored in forms.settings (presentation-only
 * jsonb — migration 006 snapshots settings WHOLESALE and
 * get_public_form serves them, so NO database change is needed):
 *
 *   settings.welcome = {
 *     enabled: boolean,
 *     title: string,          (falls back to the form name)
 *     description: string,    (falls back to the form description)
 *     button_label: string,   (defaults to "Start")
 *   }
 *   settings.thankyou = {
 *     enabled: boolean,
 *     title: string,          (defaults to "Thank you — response received")
 *     description: string,
 *     button_label: string,   (optional CTA label)
 *     link_url: string,       (optional CTA href — https only)
 *   }
 *
 * Consumers: public form (welcome gate before the form, thank-you
 * screen after a successful submit), the preview dialog (the same
 * screens so builders see exactly what respondents get), and card
 * mode's step-0 welcome card (form-renderer.tsx).
 */
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, ExternalLink } from "lucide-react";

export interface WelcomeSettings {
  enabled: boolean;
  title?: string;
  description?: string;
  button_label?: string;
}

export interface ThankYouSettings {
  enabled: boolean;
  title?: string;
  description?: string;
  button_label?: string;
  link_url?: string;
}

/** Read settings.welcome defensively (published snapshots are
 *  immutable, but a malformed one must never crash the page). */
export function readWelcomeSettings(
  settings: Record<string, unknown> | null | undefined,
): WelcomeSettings | null {
  const w = settings?.welcome;
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const o = w as Record<string, unknown>;
  if (o.enabled !== true) return null;
  return {
    enabled: true,
    title: typeof o.title === "string" ? o.title.slice(0, 200) : undefined,
    description: typeof o.description === "string" ? o.description.slice(0, 1000) : undefined,
    button_label: typeof o.button_label === "string" ? o.button_label.slice(0, 40) : undefined,
  };
}

/** Read settings.thankyou defensively. */
export function readThankYouSettings(
  settings: Record<string, unknown> | null | undefined,
): ThankYouSettings | null {
  const t = settings?.thankyou;
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const o = t as Record<string, unknown>;
  if (o.enabled !== true) return null;
  const link =
    typeof o.link_url === "string" && /^https:\/\//.test(o.link_url)
      ? o.link_url.slice(0, 2048)
      : undefined;
  return {
    enabled: true,
    title: typeof o.title === "string" ? o.title.slice(0, 200) : undefined,
    description: typeof o.description === "string" ? o.description.slice(0, 1000) : undefined,
    button_label: typeof o.button_label === "string" ? o.button_label.slice(0, 40) : undefined,
    link_url: link,
  };
}

/* ------------------------------------------------------------------ */
/* Welcome screen                                                      */
/* ------------------------------------------------------------------ */

export function WelcomeScreen({
  fallbackTitle,
  fallbackDescription,
  welcome,
  onStart,
  autoFocus,
}: {
  fallbackTitle: string;
  fallbackDescription?: string | null;
  welcome: WelcomeSettings;
  onStart: () => void;
  autoFocus?: boolean;
}) {
  const title = welcome.title?.trim() || fallbackTitle;
  const description = welcome.description?.trim() || fallbackDescription || null;
  const cta = welcome.button_label?.trim() || "Start";
  return (
    <div className="flex min-h-[16rem] flex-col justify-center">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
      )}
      <div className="mt-8">
        <Button
          type="button"
          variant="memphis-coral"
          size="lg"
          onClick={onStart}
          autoFocus={autoFocus}
        >
          {cta}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thank-you screen                                                    */
/* ------------------------------------------------------------------ */

export function ThankYouScreen({
  fallbackTitle,
  fallbackDescription,
  thankyou,
  reference,
  onBack,
  backLabel,
}: {
  fallbackTitle: string;
  fallbackDescription?: string | null;
  thankyou: ThankYouSettings;
  reference?: number | null;
  /** Preview only — returns to the form to edit answers. */
  onBack?: () => void;
  backLabel?: string;
}) {
  const title = thankyou.title?.trim() || fallbackTitle;
  const description = thankyou.description?.trim() || fallbackDescription || null;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-8 text-center shadow-[6px_6px_0_0_var(--memphis-ink)]"
      role="status"
      aria-live="polite"
    >
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--memphis-mint)]/15 text-[color:var(--memphis-mint)]">
        <Check className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
      {reference != null && (
        <p className="mt-2 text-sm text-muted-foreground">
          Your reference number is{" "}
          <span className="font-mono font-semibold text-foreground">#{reference}</span>.
        </p>
      )}
      {description && (
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {thankyou.link_url && (
          <Button asChild variant="memphis-coral" size="lg">
            <a href={thankyou.link_url} target="_blank" rel="noopener noreferrer">
              {thankyou.button_label?.trim() || "Continue"}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
        )}
        {!thankyou.link_url && thankyou.button_label && onBack && (
          <Button variant="outline" size="lg" onClick={onBack}>
            {thankyou.button_label}
          </Button>
        )}
        {onBack && (
          <Button variant="outline" size="lg" onClick={onBack}>
            {backLabel ?? "Back to the form"}
          </Button>
        )}
      </div>
    </div>
  );
}
