import type { Metadata } from "next";
import Link from "next/link";
import {
  can, Permission, isValidContactStatus, BusinessContactStatus, BusinessContactSource,
  normalizeContactSearch, CONTACT_SEARCH_MAX_LENGTH, CONTACT_EXPORT_MAX_ROWS,
} from "@guardora/core";
import { listBusinessContacts, businessContactCounts, listAssignableMembers } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/dashboard/ui";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { businessDict, bizLabel } from "../business-i18n";
import { ContactsBulkTable } from "@/components/dashboard/contacts-bulk-table";
import { bulkChangeStatusAction, bulkAssignAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts", robots: { index: false, follow: false } };

type SP = { status?: string; source?: string; cursor?: string; q?: string; bulk?: string; n?: string; f?: string; e?: string };

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
  const canManage = can(session.role, Permission.BusinessContactsManage);
  const canExport = can(session.role, Permission.BusinessContactsExport);
  // Bounded, non-negative counts parsed defensively from the redirect — never rendered raw.
  const boundedCount = (raw: string | undefined): number => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0;
  };
  const bulkErrors: Record<string, string> = {
    bulk_empty: t.contacts.bulkNoneSelected, bulk_too_many: t.contacts.bulkTooMany,
    bulk_invalid: t.contacts.bulkInvalid, bulk_assignee: t.contacts.bulkAssigneeInvalid,
    rate_limited: t.contacts.rateLimited, csrf: t.contacts.bulkFailedGeneric,
    input: t.contacts.bulkInvalid,
  };
  // Remounts (and therefore clears selection) whenever search, filters or the page change.
  const selectionKey = `${sp.q ?? ""}|${sp.status ?? ""}|${sp.source ?? ""}|${sp.cursor ?? ""}`;

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

      {sp.bulk ? (
        <p role="status" aria-live="polite" className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">
          {t.contacts.bulkAffected(boundedCount(sp.n))}
          {boundedCount(sp.f) > 0 ? <> · {t.contacts.bulkFailed(boundedCount(sp.f))}</> : null}
        </p>
      ) : null}
      {sp.e ? (
        <p role="alert" className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]">
          {bulkErrors[sp.e] ?? t.contacts.bulkFailedGeneric}
        </p>
      ) : null}

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

      {/* Export runs server-side over the CURRENT filters, submitted in the request BODY (POST) so the search
          text never reaches a request path or an access log. */}
      {canExport ? (
        <form method="post" action="/api/dashboard/contacts/export">
          <input type="hidden" name="q" value={search ?? ""} />
          <input type="hidden" name="status" value={status ?? ""} />
          <input type="hidden" name="source" value={source ?? ""} />
          <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-2)]">
            {t.contacts.exportCsv}
          </button>
          {counts.total > CONTACT_EXPORT_MAX_ROWS ? (
            <span className="ml-2 text-xs text-[var(--color-muted)]">{t.contacts.exportLimited(CONTACT_EXPORT_MAX_ROWS)}</span>
          ) : null}
        </form>
      ) : null}

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
          <ContactsBulkTable
            key={selectionKey}
            pageIds={page.items.map((c) => c.id)}
            canManage={canManage}
            statusAction={bulkChangeStatusAction}
            assignAction={bulkAssignAction}
            statusOptions={ALL_STATUSES.map((st) => ({ value: st, label: bizLabel(t.status, st) }))}
            assigneeOptions={members.map((m) => ({ value: m.userId, label: m.email }))}
            labels={{
              selectRow: t.contacts.selectRow, selectPage: t.contacts.selectPage,
              selectedCount: t.contacts.selectedCount, clearSelection: t.contacts.clearSelection,
              bulkStatus: t.contacts.bulkStatus, bulkAssign: t.contacts.bulkAssign,
              bulkUnassign: t.contacts.bulkUnassign, apply: t.contacts.apply,
            }}
            header={<>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colName}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colContact}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colSource}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colCampaign}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colReceived}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colLatestActivity}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colAssignee2}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t.contacts.colStatus}</th>
            </>}
            renderRow={(id) => {
              const c = page.items.find((x) => x.id === id)!;
              return (<>
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
              </>);
            }}
          />
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
