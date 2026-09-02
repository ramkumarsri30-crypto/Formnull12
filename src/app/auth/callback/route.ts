import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

/**
 * FormNull — Auth Callback (email verification / OAuth / magic link)
 * =====================================================================
 * Handles ?code= (PKCE exchange) and ?token_hash=&type= (OTP verify),
 * sets the Supabase session cookies on the response, then redirects.
 *
 * Preview-environment notes (root-cause fixes):
 *   1. RELATIVE Location redirects. Behind the Z.ai preview gateway the
 *      request's Host is an INTERNAL hostname (e.g. ...fcapp.run /
 *      localhost:3000) — any ABSOLUTE redirect built from request.url or
 *      forwarded headers either leaves the public domain or dies with a
 *      400. A relative Location is resolved by the browser against the
 *      origin it is ALREADY on, so it is immune to host rewriting at any
 *      proxy layer. (RFC 7231 allows relative Location values.)
 *   2. Redirect targets use the app's canonical trailing-slash form
 *      (next.config.ts trailingSlash:true) so we never chain an extra
 *      canonicalization hop with the gateway.
 *   3. Only in-app relative targets are honored (no open redirect).
 */

/** Allow only in-app paths; canonicalize page targets with a trailing "/". */
function safeRedirectTarget(raw: string | null): string {
  let target =
    raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  // Keep asset-looking paths (e.g. /file.pdf) untouched; pages get "/".
  if (!target.endsWith("/") && !/\.[a-zA-Z0-9]+$/.test(target)) {
    target += "/";
  }
  return target;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Where to send the user after the exchange. Failure lands back on
  // /signin/ with an error flag (the signin page shows a toast).
  let location = safeRedirectTarget(searchParams.get("redirect"));

  // The redirect response carries the session cookies issued by the
  // exchange below. Cookies must be set on THE response that redirects,
  // otherwise the browser never stores the new session.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // The exchange may change `location` (error path), but any cookies it
  // set were already applied to `response` via the setAll bridge above.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      response.headers.set("Location", "/signin/?error=verification_failed");
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as never,
    });
    if (error) {
      response.headers.set("Location", "/signin/?error=verification_failed");
    }
  }

  // 303 See Other with a RELATIVE Location — see notes 1–3 above.
  return response as NextResponse;
}
