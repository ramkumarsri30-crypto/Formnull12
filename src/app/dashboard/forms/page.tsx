import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { FormsList } from "@/features/forms/forms-list";

/**
 * Forms list page. Auth is enforced by src/proxy.ts — see
 * app/dashboard/page.tsx for the rationale.
 */
export const dynamic = "force-dynamic";

export default async function FormsPage() {
  return (
    <DashboardShell>
      <FormsList />
    </DashboardShell>
  );
}
