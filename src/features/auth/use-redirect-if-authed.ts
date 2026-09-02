"use client";

/**
 * useRedirectIfAuthed
 * =====================================================================
 * Client-side redirect for auth pages (/signin, /signup).
 *
 * Why this exists:
 *   The proxy (src/proxy.ts) no longer redirects authed users away from
 *   /signin and /signup. That redirect was the root cause of the
 *   "redirected you too many times" loop: when the user had a stale
 *   cookie, the proxy's getUser() returned null (redirect to /signin),
 *   then on /signin getUser() somehow succeeded (redirect to /dashboard),
 *   then on /dashboard getUser() failed again (redirect to /signin)... ∞
 *
 * LOOP-PROOF VERSION (v2):
 *   The first version of this hook trusted `useAuth().user`, which is
 *   populated from auth.getSession() — and getSession() only READS the
 *   stored cookie, it never validates the JWT with the Supabase server.
 *   A stale/expired cookie therefore looked "signed in" here while the
 *   proxy (which calls getUser(), a server-validated check) rejected it.
 *   Result: signin pushes → /dashboard, proxy bounces → /signin, client
 *   pushes again... the same infinite loop, one layer higher.
 *
 *   The fix: before redirecting anywhere, we ask the Supabase auth
 *   server to actually VALIDATE the session via getUser(). This call
 *   also refreshes the access token when possible, so genuinely-signed-
 *   in users still sail through. If validation fails, the cookie is
 *   poison — we sign out locally to clear it and stay on the auth page.
 *   The client can now NEVER bounce the user to a route the server will
 *   reject, so the loop is structurally impossible.
 *
 *   We also sanitize ?redirect= to a relative, single-slash path so the
 *   redirect can never be abused to send users off-site.
 */
import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";

/** Only allow in-app, non-protocol-relative redirect targets. */
function sanitizeRedirect(target: string | null): string {
  if (!target) return "/dashboard";
  // Must start with exactly one "/" — blocks "https://...", "//evil.com", etc.
  if (!target.startsWith("/") || target.startsWith("//")) return "/dashboard";
  return target;
}

export function useRedirectIfAuthed() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  // Guard against double-firing (React StrictMode mounts effects twice).
  const attempted = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // No user anymore (signed out / stale cleared) — allow a future attempt.
      attempted.current = false;
      return;
    }
    if (attempted.current) return;
    attempted.current = true;

    const redirectTarget = sanitizeRedirect(searchParams.get("redirect"));

    void (async () => {
      try {
        // VALIDATE the session with the Supabase server. Unlike
        // getSession(), this hits the auth server and refreshes the
        // token if needed — the same check the proxy performs.
        const { data, error } = await supabaseBrowser.auth.getUser();

        if (data?.user && !error) {
          // Session is genuinely valid — safe to proceed.
          router.replace(redirectTarget);
          return;
        }

        // Session is stale/dead: the proxy would reject it too. Clear
        // it locally so the auth pages render a clean sign-in form
        // instead of ping-ponging.
        await supabaseBrowser.auth.signOut();
      } catch {
        // Network/auth-server failure: do NOT redirect (redirecting
        // on an unverifiable session is what created the original
        // loop). Leave the user on the auth page; they can still
        // sign in, which will mint a fresh session.
      }
    })();
  }, [user, loading, router, searchParams]);
}
