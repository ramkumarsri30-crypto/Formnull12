"use client";

/**
 * FormNull — Publish & Share (Phase 3)
 * =====================================================================
 * Wires migration 006's publish_form(uuid) RPC to the builder.
 *
 *   publish_form returns {public_key, version} and atomically:
 *     - validates every field's config (mirrors validateConfig)
 *     - snapshots the form (immutable form_versions row)
 *     - flips forms.status → 'published' + published_version
 *
 * PostgREST surfaces 006's RAISE EXCEPTION 'CODE: message' errors as
 * HTTP 400 { code: "P0001", message: "CODE: message" } — publishErrorText
 * maps every documented code to a respondent-friendly explanation.
 * Unknown codes fall back to the raw message (never swallowed).
 *
 * The share link targets /f/{public_key}/ — the real public form page
 * rendered from the published snapshot (get_public_form, migration 006).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket, Copy, Check, Globe, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GeometricCircle } from "@/components/memphis/memphis-decorations";

/* ------------------------------------------------------------------ */
/* Error code mapping (006's documented raise codes)                    */
/* ------------------------------------------------------------------ */

export function publishErrorText(rawMessage: string): string {
  const code = rawMessage.split(":")[0]?.trim() ?? "";
  const detail = rawMessage.split(":").slice(1).join(":").trim();
  switch (code) {
    case "AUTH_REQUIRED":
      return "Your session has expired — sign in again, then publish.";
    case "FORM_NOT_FOUND":
      return "This form no longer exists (or you lost access to it).";
    case "PERMISSION_DENIED":
      return "You need editor rights in this workspace to publish.";
    case "NO_USABLE_FIELDS":
      return "Add at least one non-section field before publishing.";
    case "TOO_MANY_FIELDS":
      return "Published forms support at most 300 fields — remove some first.";
    case "FILE_UPLOAD_NOT_SUPPORTED":
      return "This form contains file upload fields. Anonymous uploads are not available yet — remove or replace those fields before publishing.";
    case "SNAPSHOT_TOO_LARGE":
      return "The form is too large to publish (over 512 KB) — reduce fields or options.";
    case "CONFIG_INVALID":
      return detail
        ? `A field's configuration is invalid: ${detail}`
        : "A field's configuration is invalid — open each field and fix the highlighted settings.";
    default:
      return rawMessage;
  }
}

/* ------------------------------------------------------------------ */
/* Publish dialog                                                      */
/* ------------------------------------------------------------------ */

export function PublishDialog({
  open,
  onOpenChange,
  formId,
  formName,
  fieldCount,
  blockedTypes,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  formName: string;
  fieldCount: number;
  /** Labels of field types present in the form that cannot be
   *  published yet (registry publishable=false — file upload, staged
   *  types). The RPC explains the same thing server-side. */
  blockedTypes: string[];
  onPublished: (result: { publicKey: string; version: number }) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ publicKey: string; version: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
      setCopied(false);
    }
  }, [open]);

  const shareUrl =
    result && typeof window !== "undefined"
      ? `${window.location.origin}/f/${result.publicKey}/`
      : null;

  async function doPublish() {
    setPublishing(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabaseBrowser.rpc("publish_form", {
        p_form_id: formId,
      });
      if (rpcError) {
        setError(publishErrorText(rpcError.message));
        return;
      }
      const r = data as { public_key?: string; version?: number } | null;
      if (!r?.public_key || typeof r.version !== "number") {
        setError("Publishing returned an unexpected response.");
        return;
      }
      setResult({ publicKey: r.public_key, version: r.version });
      onPublished({ publicKey: r.public_key, version: r.version });
      toast.success(`Published version ${r.version}!`, {
        description: "Your form is now live at its public link.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed unexpectedly.");
    } finally {
      setPublishing(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link text and copy manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !publishing && onOpenChange(o)}>
      <DialogContent className="relative overflow-visible sm:max-w-lg">
        <GeometricCircle color="mint" size={28} className="-top-2.5 -right-2.5 opacity-70" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4.5 w-4.5 text-[color:var(--memphis-coral)]" aria-hidden />
            {result ? "Your form is live" : `Publish “${formName}”`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Share this link — everyone with it can fill the published version."
              : "Publishing snapshots the current fields into an immutable version and makes the form public."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 rounded-xl border-2 border-foreground/10 bg-background p-2.5">
              <Globe className="h-4 w-4 shrink-0 text-[color:var(--memphis-mint)]" aria-hidden />
              <input
                readOnly
                value={shareUrl ?? ""}
                aria-label="Public form link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
              />
              <Button
                variant={copied ? "memphis" : "outline"}
                size="icon-sm"
                onClick={copyLink}
                aria-label="Copy public link"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Version {result.version} · published snapshots are immutable — later edits need a
              new publish (which creates the next version).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button asChild variant="memphis-coral">
                <a
                  href={shareUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the published form in a new tab"
                >
                  <Globe className="h-4 w-4" />
                  Open live form
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Pre-flight summary — honest about what will happen */}
            <ul className="space-y-2 rounded-xl bg-surface p-3.5 text-sm">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--memphis-mint)]" aria-hidden />
                <span>
                  {fieldCount} field{fieldCount === 1 ? "" : "s"} will be frozen into version
                  snapshot <strong>immutable</strong> — respondents always see this exact version.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--memphis-mint)]" aria-hidden />
                <span>
                  A public link (<span className="font-mono text-xs">/f/…</span>) becomes active
                  immediately.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--memphis-mint)]" aria-hidden />
                <span>Rate limited to 20 submissions per 10 minutes per visitor IP.</span>
              </li>
              {blockedTypes.length > 0 && (
                <li className="flex items-start gap-2">
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--memphis-sun)]"
                    aria-hidden
                  />
                  <span>
                    This form contains <strong>{blockedTypes.join(", ")} fields</strong>.
                    Publishing is blocked while they are present — these types cannot
                    collect responses yet. Remove them to publish (full support arrives
                    with the pending server migration).
                  </span>
                </li>
              )}
            </ul>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
              >
                {error}
              </p>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={publishing}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="memphis-coral"
                onClick={doPublish}
                disabled={publishing || blockedTypes.length > 0}
                aria-disabled={blockedTypes.length > 0}
                className="w-full sm:w-auto"
              >
                <Rocket className="h-4 w-4" />
                {publishing ? "Publishing…" : "Publish now"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Share dialog (already-published forms)                               */
/* ------------------------------------------------------------------ */

export function ShareDialog({
  open,
  onOpenChange,
  publicKey,
  version,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
  version: number | null;
  status: string;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/f/${publicKey}/` : `/f/${publicKey}/`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link text and copy manually.");
    }
  }

  const live = status === "published";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this form</DialogTitle>
          <DialogDescription>
            {live
              ? `Link to published version ${version ?? "—"}.`
              : "This link activates as soon as the form is published."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 rounded-xl border-2 border-foreground/10 bg-background p-2.5">
            <Globe
              className={live ? "h-4 w-4 shrink-0 text-[color:var(--memphis-mint)]" : "h-4 w-4 shrink-0 text-muted-foreground"}
              aria-hidden
            />
            <input
              readOnly
              value={shareUrl}
              aria-label="Public form link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <Button
              variant={copied ? "memphis" : "outline"}
              size="icon-sm"
              onClick={copyLink}
              aria-label="Copy public link"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {!live && (
            <p className="text-xs text-muted-foreground">
              Current status: <span className="font-semibold capitalize">{status}</span> — use the
              Publish button to (re)publish and activate this link.
            </p>
          )}
          {live && (
            <Button asChild variant="memphis" size="sm" className="w-full">
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                <Globe className="h-4 w-4" />
                Open live form
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
