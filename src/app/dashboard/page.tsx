import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { DashboardOverview } from "@/features/dashboard/overview";

/**
 * Dashboard page.
 *
 * Auth is enforced by src/proxy.ts (Next.js 16 middleware). The proxy
 * refreshes the Supabase session and redirects unauthenticated users
 * to /signin before this page ever runs.
 *
 * We deliberately do NOT call supabase.auth.getUser() + redirect() here
 * because that would create a second source of truth that can disagree
 * with the proxy (the proxy modifies cookies in-flight, but server
 * components read cookies from the original request, not the modified
 * one — leading to "redirected you too many times" loops).
 *
 * If the session somehow becomes invalid mid-flight, the client-side
 * AuthProvider will detect it (user becomes null) and redirect to
 * /signin gracefully.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardOverview />
    </DashboardShell>
  );
}
