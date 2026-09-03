import type { Metadata } from "next";
import { PublicForm } from "@/features/forms/public-form";

/**
 * Public form page — /f/{public_key}/
 *
 * Deliberately NOT auth-protected: proxy.ts only guards /dashboard,
 * /forms, /settings, /account, /workspace. Anonymous visitors fetch the
 * published snapshot via get_public_form (migration 006 — snapshot-only
 * read, RLS-irrelevant, no existence oracle) and submit through
 * submit_public_form (server-side validation + rate limiting).
 * Unknown/closed keys render the same friendly unavailable state.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Form — FormNull",
  description: "Fill in this FormNull form.",
  robots: { index: false, follow: false },
};

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <PublicForm publicKey={key} />;
}
