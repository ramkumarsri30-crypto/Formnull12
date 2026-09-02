/**
 * Debug script: test supabase.auth.getUser() with a real session cookie
 * to figure out why the proxy redirects authenticated users to /signin.
 */
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = "https://sqtolkfjnskyxnltuyci.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PbqLlhGOI_T13rtIFuEnFQ_Z2Fs9RZ6";

// 1. Get real tokens via password grant
const authResp = await fetch(
  `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "formnull.test@gmail.com",
      password: "TestPass123!",
    }),
  },
);
const authData = (await authResp.json()) as {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user?: { id: string; email: string };
};

console.log("--- Auth response status:", authResp.status);
console.log("--- Got access_token:", authData.access_token?.slice(0, 40), "...");
console.log("--- Got refresh_token:", authData.refresh_token?.slice(0, 20), "...");
console.log("--- expires_in:", authData.expires_in);
console.log("");

// 2. Build the cookie value the way @supabase/ssr expects it
// @supabase/ssr stores the session as base64(JSON.stringify(session))
const sessionObj = {
  access_token: authData.access_token,
  refresh_token: authData.refresh_token,
  expires_in: authData.expires_in,
  token_type: authData.token_type,
  user: authData.user,
};
const cookieValue = Buffer.from(JSON.stringify(sessionObj)).toString("base64");
const cookieName = `sb-sqtolkfjnskyxnltuyci-auth-token`;

console.log("--- Cookie name:", cookieName);
console.log("--- Cookie value length:", cookieValue.length);
console.log("");

// 3. Create a supabase client with this cookie and call getUser()
const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  cookies: {
    getAll() {
      return [{ name: cookieName, value: cookieValue }];
    },
    setAll() {
      // no-op for this test
    },
  },
});

const { data, error } = await supabase.auth.getUser();
console.log("--- getUser() result ---");
console.log("  user:", data.user ? { id: data.user.id, email: data.user.email } : null);
console.log("  error:", error ? { message: error.message, name: error.name } : null);
console.log("");

// 4. Also test getSession() to see if the session is recognized
const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
console.log("--- getSession() result ---");
console.log(
"  session:",
  sessionData.session
    ? {
        access_token: sessionData.session.access_token?.slice(0, 30) + "...",
        expires_at: sessionData.session.expires_at,
      }
    : null,
);
console.log("  error:", sessionError ? sessionError.message : null);
