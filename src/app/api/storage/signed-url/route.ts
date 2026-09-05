import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Signed storage URLs for form uploads (Field Expansion phase).
 * =====================================================================
 * POST /api/storage/signed-url  { tokens: string[] }   (authenticated)
 *
 * Files uploaded through public forms live in the private
 * form-uploads bucket with NO public/anonymous read path — by design.
 * This route is the ONLY way workspace members fetch them:
 *
 *   1. Authenticate the caller (cookie session via supabaseServer).
 *   2. Resolve each token to a form_uploads row and verify the caller
 *      is a member of that upload's workspace (RLS already enforces
 *      the same rule on the SELECT; the explicit check keeps the
 *      error honest instead of an empty set).
 *   3. Create a short-lived (5 min) signed URL with the service key.
 *
 * No ownership → 403, never a URL. Tokens are unguessable UUIDs, and
 * signed URLs expire — nothing is "public" at any point.
 */
export async function POST(req: Request) {
  let body: { tokens?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const tokens = Array.isArray(body.tokens)
    ? body.tokens.filter((t): t is string => typeof t === "string" && /^[0-9a-f-]{36}$/i.test(t))
    : [];
  if (tokens.length === 0 || tokens.length > 50) {
    return NextResponse.json({ error: "INVALID_TOKENS" }, { status: 400 });
  }

  // (1) Caller identity.
  const supabase = await supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const userId = userData.user.id;

  // (2) Resolve + ownership-check the uploads (RLS filters to the
  //     caller's workspaces; a foreign token simply resolves to zero
  //     rows and is reported as not found).
  const { data: uploads, error: fetchError } = await supabase
    .from("form_uploads")
    .select("id, token, bucket, storage_path, original_name, mime_type, size_bytes, form_id, workspace_id, status, submission_id")
    .in("token", tokens);
  if (fetchError) {
    return NextResponse.json({ error: "LOOKUP_FAILED", detail: fetchError.message }, { status: 500 });
  }

  const rows = uploads ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // (3) Signed URLs via the service key (only the server can mint them).
  const admin = supabaseAdmin();
  const urls: Record<string, { url: string; name: string; mime_type: string; size_bytes: number }> = {};
  for (const row of rows) {
     
    const { data, error } = await admin.storage
      .from(row.bucket)
      .createSignedUrl(row.storage_path, 300);
    if (error || !data?.signedUrl) {
      // One failure must not sink the batch — report per-token.
      continue;
    }
    urls[row.token] = {
      url: data.signedUrl,
      name: row.original_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
    };
  }

  return NextResponse.json({ urls, granted: Object.keys(urls).length, checked: userId ? 1 : 0 });
}
