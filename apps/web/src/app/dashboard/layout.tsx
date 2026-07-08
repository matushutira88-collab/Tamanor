import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getLocale } from "@/i18n/locale-server";
import { getDictionary } from "@/i18n";

const TRIAL_ITEM_LIMIT = 500;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const [itemsProcessed, tenant] = await Promise.all([
    prisma.reputationItem.count({ where: { tenantId: session.tenantId } }),
    prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { plan: true } }),
  ]);

  return (
    <DashboardShell
      tenantName={session.tenantName}
      userName={session.userName}
      role={session.role}
      trialUsed={itemsProcessed}
      trialLimit={TRIAL_ITEM_LIMIT}
      demo={tenant?.plan === "dev"}
      navLabels={dict.dashboardNav}
      sidebarStrings={dict.sidebar}
    >
      {children}
    </DashboardShell>
  );
}
