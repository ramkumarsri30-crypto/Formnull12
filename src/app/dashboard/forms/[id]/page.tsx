import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { FormDetail } from "@/features/forms/form-detail";

/**
 * Form detail page. Auth is enforced by src/proxy.ts — see
 * app/dashboard/page.tsx for the rationale.
 */
export const dynamic = "force-dynamic";

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DashboardShell>
      <FormDetail formId={id} />
    </DashboardShell>
  );
}
