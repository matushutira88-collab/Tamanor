import type { Metadata } from "next";
import Link from "next/link";
import {
  can, Permission, isValidContactStatus, BusinessContactStatus, BusinessContactSource,
  normalizeContactSearch, CONTACT_SEARCH_MAX_LENGTH,
} from "@guardora/core";
import { listBusinessContacts, businessContactCounts, listAssignableMembers } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/dashboard/ui";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { businessDict, bizLabel } from "../business-i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts", robots: { index: false, follow: false } };

type SP = { status?: string; source?: string; cursor?: string; q?: string };

const ALL_SOURCES: BusinessContactSource[] = [
  BusinessContactSource.Facebook, BusinessContactSource.Instagram, BusinessContactSource.GoogleAds,
  BusinessContactSource.YouTube, BusinessContactSource.TikTok, BusinessContactSource.LinkedIn, BusinessContactSource.WebForm,
];
const ALL_STATUSES: BusinessContactStatus[] = [
  BusinessContactStatus.New, BusinessContactStatus.Contacted, BusinessContactStatus.Handled,
  BusinessContactStatus.Customer, BusinessContactStatus.Rejected,
];
const STATUS_TONE: Record<BusinessContactStatus, string> = {
  new: "info", contacted: "neutral", handled: "warning", customer: "success", rejected: "muted",
};

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;
  const session = cap.session;
  if (!can(session.role, Permission.BusinessContactsRead)) return <AccessDeniedState locale={locale} />;

  const t = businessDict(locale);
  const sp = await searchParams;
  const status = isValidContactStatus(sp.status) ? (sp.status as BusinessContactStatus) : undefined;
  const source = ALL_SOURCES.includes(sp.source as BusinessContactSource) ? (sp.source as BusinessContactSource) : undefined;
  // Bounded + normalized server-side; a too-short/empty term is simply not a filter. The raw value is never
  // interpolated into SQL — the repository binds it as a parameter.
  const search = normalizeContactSearch(sp.q);
  const filters = { status, sourcePlatform: source, search: search ?? undefined };

  const [page, counts, members] = await Promise.all([
    listBusinessContacts(session.tenantId, filters, sp.cursor),
    businessContactCounts(session.tenantId, filters),
    listAssignableMembers(session.tenantId),
  ]);
  // userId → safe tenant-member display value. An id with no membership renders as "—", never a raw id.
  const memberEmail = new Map(members.map((m) => [m.userId, m.email]));

  // Filter chip href builder — changing a filter resets pagination (drops the cursor).
  const chip = (over: Partial<SP>) => {
    const q = new URLSearchParams();
    const s = over.status !== undefined ? over.status : sp.status;
    const src = over.source !== undefined ? over.source : sp.source;
    const term = over.q !== undefined ? over.q : (search ?? "");
    if (s) q.set("status", s);
    if (src) q.set("source", src);
    if (term) q.set("q", term);
    const qs = q.toString();
    return `/dashboard/contacts${qs ? `?${qs}` : ""}`;
  };
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <PageHeader title={t.contacts.title} description={t.contacts.desc} />

      <p className="text-sm text-[var(--color-muted)]">{t.contacts.total(counts.total)}</p>

      {/* Server-side search. Submitting resets pagination (no cursor is carried) and preserves the active
          status/source filters as hidden fields. */}
      <form method="get" action="/dashboard/contacts" role="search" className="flex flex-wrap items-center gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {source ? <input type="hidden" name="source" value={source} /> : null}
        <label htmlFor="q" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.contacts.search}</label>
        <input
          id="q" name="q" type="search" defaultValue={search ?? ""} maxLength={CONTACT_SEARCH_MAX_LENGTH}
          placeholder={t.contacts.searchPlaceholder} aria-label={t.contacts.search}
          className="min-w-56 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-2)]">{t.contacts.searchApply}</button>
        {search ? (
          <Link href={chip({ q: "" })} className="text-xs font-medium text-[var(--color-brand)] hover:underline">{t.contacts.searchClear}</Link>
        ) : null}
      </form>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.contacts.filterStatus}:</span>
          <Link scroll={false} href={chip({ status: "" })} aria-current={!status ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${!status ? "border-[var(--color-brand)] font-semibold" : "border-[var(--color-border)]"}`}>{t.contacts.all}</Link>
          {ALL_STATUSES.map((s) => (
            <Link key={s} scroll={false} href={chip({ status: s })} aria-current={status === s ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${status === s ? "border-[var(--color-brand)] font-semibold" : "border-[var(--color-border)]"}`}>
              {bizLabel(t.status, s)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t.contacts.filterSource}:</span>
          <Link scroll={false} href={chip({ source: "" })} aria-current={!source ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${!source ? "border-[var(--color-brand)] font-semibold" : "border-[var(--color-border)]"}`}>{t.contacts.all}</Link>
          {ALL_SOURCES.map((s) => (
            <Link key={s} scroll={false} href={chip({ source: s })} aria-current={source === s ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${source === s ? "border-[var(--color-brand)] font-semibold" : "border-[var(--color-border)]"}`}>
              {bizLabel(t.source, s)}
            </Link>
          ))}
        </div>
      </div>

      {page.items.length === 0 ? (
        <EmptyState title={t.contacts.title} body={search ? t.contacts.noResults : t.contacts.empty} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colName}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colContact}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colSource}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colCampaign}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colReceived}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colLatestActivity}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colAssignee2}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/contacts/${c.id}`} className="font-medium hover:underline">
                        {c.fullName ?? t.contacts.noName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{c.email ?? c.phone ?? "—"}</td>
                    <td className="px-3 py-2">{bizLabel(t.source, c.sourcePlatform)}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">{c.campaignName ?? c.formName ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]"><time dateTime={c.receivedAt.toISOString()}>{dtf.format(c.receivedAt)}</time></td>
                    <td className="px-3 py-2 text-[var(--color-muted)]"><time dateTime={c.latestActivityAt.toISOString()}>{dtf.format(c.latestActivityAt)}</time></td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {c.assignedUserId ? (memberEmail.get(c.assignedUserId) ?? "—") : t.contacts.unassignedShort}
                    </td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[c.status]}>{bizLabel(t.status, c.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {page.nextCursor ? (
        <div className="flex justify-center">
          <Link scroll={false} href={`${chip({})}${chip({}).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(page.nextCursor)}`}
            className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold hover:bg-[var(--color-surface-2)]">
            {t.contacts.title} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
