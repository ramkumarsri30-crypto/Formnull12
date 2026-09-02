import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { NewFormPage } from "@/features/forms/new-form";

/**
 * New form page. Auth is enforced by src/proxy.ts — see
 * app/dashboard/page.tsx for the rationale.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <DashboardShell>
      <NewFormPage />
    </DashboardShell>
  );
}
