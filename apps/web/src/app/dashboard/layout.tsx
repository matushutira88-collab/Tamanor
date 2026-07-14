import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
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
  const [itemsProcessed, tenant] = await withTenant(session.tenantId, (db) => Promise.all([
    db.reputationItem.count({ where: { tenantId: session.tenantId } }),
    db.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } }),
  ]));

  // The demo badge shows ONLY for an actual demo workspace (name contains "Demo").
  // The default real-only seed uses a neutral workspace name → no badge.
  const isDemoWorkspace = (tenant?.name ?? "").toLowerCase().includes("demo");

  return (
    <DashboardShell
      tenantName={tenant?.name ?? session.tenantName}
      userName={session.userName}
      role={session.role}
      trialUsed={itemsProcessed}
      trialLimit={TRIAL_ITEM_LIMIT}
      demo={isDemoWorkspace}
      locale={locale}
      navLabels={dict.dashboardNav}
      sidebarStrings={dict.sidebar}
    >
      {children}
    </DashboardShell>
  );
}
