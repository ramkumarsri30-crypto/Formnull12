import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { SettingsPage } from "@/features/dashboard/settings-page";

/**
 * Settings page. Auth is enforced by src/proxy.ts — see
 * app/dashboard/page.tsx for the rationale.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <DashboardShell>
      <SettingsPage />
    </DashboardShell>
  );
}
