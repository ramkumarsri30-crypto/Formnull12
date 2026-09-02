/**
 * FormNull Supabase — Browser Client
 * =====================================================================
 * Used in client components only. Reads NEXT_PUBLIC_* env vars.
 * NEVER import the service role key here.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // We throw here only at module load time on the client. In server
  // contexts (SSR), env vars are always available, so this is safe.
  // The error helps catch missing .env.local during development.
  throw new Error(
    "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
  );
}

export const supabaseBrowser = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);
