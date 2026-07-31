import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, Permission, BusinessContactStatus } from "@guardora/core";
import { getBusinessContact, listAssignableMembers } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { businessDict, bizLabel } from "../../business-i18n";
import { changeContactStatusAction, assignContactAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact", robots: { index: false, follow: false } };

const ALL_STATUSES: BusinessContactStatus[] = [
  BusinessContactStatus.New, BusinessContactStatus.Contacted, BusinessContactStatus.Handled,
  BusinessContactStatus.Customer, BusinessContactStatus.Rejected,
];

export default async function ContactDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; e?: string }> }) {
  const locale = await getLocale();
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;
  const session = cap.session;
  if (!can(session.role, Permission.BusinessContactsRead)) return <AccessDeniedState locale={locale} />;

  const t = businessDict(locale);
  const { id } = await params;
  const sp = await searchParams;
  const contact = await getBusinessContact(session.tenantId, id);
  if (!contact) notFound();

  const canManage = can(session.role, Permission.BusinessContactsManage);
  const members = canManage ? await listAssignableMembers(session.tenantId) : [];
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const consentText = contact.consentValue === true ? t.contacts.consentGranted : contact.consentValue === false ? t.contacts.consentDenied : t.contacts.consentUnknown;

  const rows: { label: string; value: string | null }[] = [
    { label: t.contacts.email, value: contact.email },
    { label: t.contacts.phone, value: contact.phone },
    { label: t.contacts.company, value: contact.company },
    { label: t.contacts.colSource, value: bizLabel(t.source, contact.sourcePlatform) },
    { label: t.contacts.campaign, value: contact.campaignName },
    { label: t.contacts.form, value: contact.formName },
    { label: t.contacts.message, value: contact.messageSummary },
    { label: t.contacts.received, value: dtf.format(contact.receivedAt) },
    { label: t.contacts.consent, value: consentText },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={contact.fullName ?? t.contacts.noName} description={t.contacts.detailTitle}
        action={<Link href="/dashboard/contacts" className="text-sm font-semibold hover:underline">← {t.contacts.back}</Link>} />

      {sp.saved ? <p role="status" aria-live="polite" className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">{sp.saved === "assign" ? t.contacts.assigned : t.contacts.statusChanged}</p> : null}

      <div className="flex items-center gap-3">
        <Badge tone="info">{bizLabel(t.status, contact.status)}</Badge>
      </div>

      <Card>
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{r.label}</dt>
              <dd className="mt-0.5 text-sm">{r.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {canManage ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <form action={changeContactStatusAction} className="space-y-3">
              <input type="hidden" name="contactId" value={contact.id} />
              <label htmlFor="status" className="block text-sm font-semibold">{t.contacts.changeStatus}</label>
              <select id="status" name="status" defaultValue={contact.status} className="w-full rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-2 text-sm">
                {ALL_STATUSES.map((s) => <option key={s} value={s}>{bizLabel(t.status, s)}</option>)}
              </select>
              <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{t.contacts.save}</button>
            </form>
          </Card>
          <Card>
            <form action={assignContactAction} className="space-y-3">
              <input type="hidden" name="contactId" value={contact.id} />
              <label htmlFor="assigneeUserId" className="block text-sm font-semibold">{t.contacts.assign}</label>
              <select id="assigneeUserId" name="assigneeUserId" defaultValue={contact.assignedUserId ?? ""} className="w-full rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-2 text-sm">
                <option value="">{t.contacts.unassign}</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}
              </select>
              <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{t.contacts.save}</button>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
