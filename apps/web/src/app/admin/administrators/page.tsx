import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess, platformCapsFor } from "@/server/platform/guard";
import { listPlatformAdministrators } from "@guardora/db";
import { ADMIN_COPY } from "../admin-i18n";
import { Unauthorized } from "../unauthorized";
import { AdminConsole } from "./admin-console";
import { roleTone, fmtDate } from "../admin-view";

export const dynamic = "force-dynamic";

export default async function AdministratorsPage() {
  const t = ADMIN_COPY[await getLocale()];
  const platform = await requirePlatformAccess("admin_users.view");
  if (!platform) return <Unauthorized t={t} />;
  const caps = platformCapsFor(platform.role);
  const admins = await listPlatformAdministrators(platform.userId);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="👤" title={t.nav.administrators} description={caps.adminUsersManage ? t.admin.reauthWarning : t.admin.lastOwnerNote} />
      <Card className="p-3 text-xs text-[var(--color-muted)]">🔒 {t.admin.lastOwnerNote} · {t.admin.reauthWarning}</Card>

      {caps.adminUsersManage ? <AdminConsole t={t} selfUserId={platform.userId} admins={admins} /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-xs"><caption className="sr-only">{t.nav.administrators}</caption>
            <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.fields.name}</th><th scope="col" className="px-3 py-2">{t.fields.role}</th><th scope="col" className="px-3 py-2">{t.fields.status}</th><th scope="col" className="px-3 py-2">{t.fields.lastAccess}</th></tr></thead>
            <tbody>{admins.map((a) => <tr key={a.userId} className="border-b border-[var(--color-border)] last:border-0"><td className="px-4 py-2">{a.name ?? a.email}</td><td className="px-3 py-2"><Badge tone={roleTone(a.platformRole)}>{t.roleLabel[a.platformRole] ?? a.platformRole}</Badge></td><td className="px-3 py-2">{a.active ? t.fields.active : t.fields.inactive}</td><td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{fmtDate(a.platformLastAccessAt)}</td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
