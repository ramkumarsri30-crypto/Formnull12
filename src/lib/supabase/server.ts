/**
 * FormNull Supabase — Server Client (cookie-based)
 * =====================================================================
 * Used in Server Components, Route Handlers, and Server Actions.
 * Reads cookies from next/headers and writes updated session cookies
 * back to the response. Anon key only — never the service role key.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

export async function supabaseServer() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
        }
      },
    },
  });
}

/**
 * FormNull Supabase — Admin Client (service role)
 * =====================================================================
 * SERVER-ONLY. Bypasses RLS. Use ONLY for trusted server-side operations
 * where RLS would be in the way (rare). Never import in client code.
 *
 * Common uses:
 *   - Creating a profile row when a user signs up via OAuth and the
 *     auth.users trigger hasn't propagated yet
 *   - Generating signed storage URLs for private assets
 *   - Bulk admin operations
 */
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This is required for admin operations.",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
