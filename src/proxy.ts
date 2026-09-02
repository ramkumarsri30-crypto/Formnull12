/**
 * FormNull — Auth Proxy (Next.js 16 middleware)
 * =====================================================================
 * Goal: refresh the Supabase session cookie and protect routes.
 *
 * Design principles (learned from the redirect-loop bug):
 *
 *   1. The proxy's job is to REFRESH COOKIES, not to be the sole
 *      authority on auth. The database (RLS) and the client (AuthProvider)
 *      are also auth checks. If the proxy gets it wrong, those layers
 *      catch it.
 *
 *   2. NEVER redirect from /signin to /dashboard based on getUser().
 *      If the user has a stale cookie that getUser() can't validate,
 *      redirecting them away from the sign-in page traps them in a loop
 *      (they can never get back to /signin to re-authenticate).
 *      Instead, let /signin render. If they really are authed, the
 *      client-side AuthProvider will redirect them to /dashboard via
 *      router.push() after mount.
 *
 *   3. For protected routes: if getUser() returns null, redirect to
 *      /signin. But ALSO clear any stale auth cookies so the next
 *      visit to /signin starts fresh.
 *
 *   4. Always copy any cookies set by supabase.auth.getUser() onto
 *      redirect responses — otherwise the refreshed session is lost
 *      and the next request still sees the stale cookie.
 *
 *   5. If the auth server is unreachable or getUser() throws, we FAIL
 *      OPEN rather than redirecting. Redirecting on an unverifiable
 *      session is what produced the "redirected you too many times"
 *      loop; and a transient Supabase outage must not 500 every page.
 *      Defense in depth: RLS remains the real security boundary, and
 *      the client-side AuthProvider still bounces truly-unauthenticated
 *      visitors to /signin.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const protectedPaths = ["/dashboard", "/forms", "/settings", "/account", "/workspace"];

// Supabase cookie names for this project
const PROJECT_REF = "sqtolkfjnskyxnltuyci";
const AUTH_COOKIE_PREFIX = `sb-${PROJECT_REF}-auth-token`;

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Track cookies Supabase sets during getUser() so we can copy them
  // onto redirect responses too.
  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSetArr) {
        cookiesToSetArr.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options as never);
          cookiesToSet.push({ name, value, options: options as Record<string, unknown> });
        });
      },
    },
  });

  // Refresh session — this may set new cookies on the response.
  // getUser() validates the JWT with the Supabase auth server (and
  // refreshes it when expired). If the auth server is unreachable we
  // deliberately fail open — see design note 5 above.
  let user = null as Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"];
  try {
    const {
      data: { user: validated },
    } = await supabase.auth.getUser();
    user = validated;
  } catch (e) {
    console.warn("[proxy] getUser() failed (auth server unreachable?):", e);
    user = null;
  }

  const pathname = request.nextUrl.pathname;
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  // Only handle the "protected route, no user" case here.
  // We deliberately DO NOT redirect /signin → /dashboard in the proxy.
  // The client-side AuthProvider handles that redirect after mount,
  // which is more reliable and avoids redirect loops when cookies are
  // stale or corrupted.
  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    // Trailing slash matches the app's canonical form (next.config.ts
    // trailingSlash:true — required by the preview gateway, which 301s
    // extensionless paths to their slashed form). Redirecting straight
    // to /signin/ avoids a second 308 hop.
    redirectUrl.pathname = "/signin/";
    redirectUrl.searchParams.set("redirect", pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);

    // Copy any cookies Supabase set during getUser() onto the redirect.
    for (const c of cookiesToSet) {
      redirectResponse.cookies.set(c.name, c.value, c.options as never);
    }

    // Also clear stale auth cookies so the user can sign in fresh.
    // We delete all cookies that start with the auth-token prefix
    // (handles chunked cookies like sb-<ref>-auth-token.0, .1, etc.)
    const allCookies = request.cookies.getAll();
    for (const c of allCookies) {
      if (
        c.name === AUTH_COOKIE_PREFIX ||
        c.name.startsWith(`${AUTH_COOKIE_PREFIX}.`) ||
        c.name.startsWith(`${AUTH_COOKIE_PREFIX}-`)
      ) {
        // Only delete if we haven't already set a fresh value above.
        if (!cookiesToSet.some((s) => s.name === c.name)) {
          redirectResponse.cookies.delete(c.name);
        }
      }
    }

    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals & static files. Run on all routes otherwise.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt)$).*)",
  ],
};
