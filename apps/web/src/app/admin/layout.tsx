import Link from "next/link";
import { getLocale } from "@/i18n/locale-server";
import { requirePlatformAccess, platformCapsFor } from "@/server/platform/guard";
import { ADMIN_COPY } from "./admin-i18n";
import { Unauthorized } from "./unauthorized";

export const dynamic = "force-dynamic";

/**
 * Platform-admin shell — visually distinct from the tenant dashboard, with a persistent restricted-area
 * warning. Baseline admin.access is enforced here (server-side, fresh); each page additionally guards its own
 * capability. Nav is filtered by capability. A denied user sees a SAFE, non-enumerating denial.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = ADMIN_COPY[locale];
  const platform = await requirePlatformAccess("admin.access");
  if (!platform) return <div className="min-h-screen bg-[var(--color-bg)] p-6"><Unauthorized t={t} /></div>;
  const caps = platformCapsFor(platform.role);

  const nav = [
    { href: "/admin", label: t.nav.dashboard, show: true },
    { href: "/admin/analytics", label: t.nav.analytics, show: caps.analyticsView },
    { href: "/admin/administrators", label: t.nav.administrators, show: caps.adminUsersView },
    { href: "/admin/audit", label: t.nav.audit, show: caps.auditView },
    { href: "/admin/meta-review", label: t.metaReview.title, show: caps.systemHealth },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Distinct restricted-area top stripe (not the tenant dashboard chrome). */}
      <div role="note" className="border-b border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-2 text-center text-xs font-semibold text-[var(--color-danger)]">
        🔒 {t.restrictedBanner}
      </div>
      <div className="mx-auto max-w-6xl px-4 py-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[var(--color-fg)] px-2 py-1 text-xs font-bold text-[var(--color-bg)]">TAMANOR · PLATFORM</span>
            <nav aria-label="Platform admin" className="flex flex-wrap gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-neutral-soft)] hover:text-[var(--color-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">{n.label}</Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="hidden sm:inline">{platform.userEmail}</span>
            <Link href="/dashboard" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 font-medium">{t.nav.exitAdmin}</Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
