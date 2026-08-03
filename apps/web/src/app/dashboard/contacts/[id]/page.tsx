import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  can, Permission, BusinessContactStatus, buildContactTimeline, CONTACT_NOTE_MAX_LENGTH,
  BusinessContactLifecycle, contactActionAvailability, ALL_ANONYMIZATION_REASONS,
  CONTACT_ANONYMIZATION_CONFIRMATION,
  type ContactTimelineEntry,
} from "@guardora/core";
import {
  getBusinessContact, listAssignableMembers, listBusinessContactNotes,
  listBusinessContactAuditTrail, CONTACT_TIMELINE_MAX_EVENTS,
} from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { businessDict, bizLabel } from "../../business-i18n";
import { SubmitNoteButton } from "@/components/dashboard/submit-note-button";
import {
  changeContactStatusAction, assignContactAction, addContactNoteAction,
  changeContactLifecycleAction, anonymizeContactAction,
} from "../actions";

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
  // Members are needed for the assignee DISPLAY (read-only users see it too), not only for the picker.
  const [members, notes, auditTrail] = await Promise.all([
    listAssignableMembers(session.tenantId),
    listBusinessContactNotes(session.tenantId, contact.id),
    listBusinessContactAuditTrail(session.tenantId, contact.id),
  ]);
  const memberEmail: Record<string, string> = Object.fromEntries(members.map((m) => [m.userId, m.email]));
  // Timeline is built from the contact's own receivedAt + the EXISTING audit ledger + notes. Bounded.
  const timeline = buildContactTimeline({
    receivedAt: contact.receivedAt, audit: auditTrail, notes,
    actorDisplay: memberEmail, limit: CONTACT_TIMELINE_MAX_EVENTS,
  });
  const assigneeLabel = contact.assignedUserId
    ? (memberEmail[contact.assignedUserId] ?? "—")
    : t.contacts.unassignedShort;
  // Phase C — what this lifecycle still permits. Shared with the server, so the UI can never offer an action
  // the server would reject.
  const allow = contactActionAvailability(contact.lifecycleState);
  const anonymized = contact.lifecycleState === BusinessContactLifecycle.Anonymized;
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const consentText = contact.consentValue === true ? t.contacts.consentGranted : contact.consentValue === false ? t.contacts.consentDenied : t.contacts.consentUnknown;

  // An anonymized contact shows NOTHING identifying and no provider/campaign/form linkability — only the
  // non-identifying facts that keep history and counts meaningful.
  const rows: { label: string; value: string | null }[] = anonymized ? [
    { label: t.contacts.received, value: dtf.format(contact.receivedAt) },
    { label: t.contacts.anonymizedOn, value: contact.anonymizedAt ? dtf.format(contact.anonymizedAt) : null },
    {
      label: t.contacts.anonymizeReason,
      value: contact.anonymizationReason
        ? t.contacts[`reason_${contact.anonymizationReason}` as keyof typeof t.contacts] as string ?? t.contacts.anonymizeReasonNone
        : t.contacts.anonymizeReasonNone,
    },
  ] : [
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
      <PageHeader title={anonymized ? t.contacts.anonymizedContact : (contact.fullName ?? t.contacts.noName)} description={t.contacts.detailTitle}
        action={<Link href="/dashboard/contacts" className="text-sm font-semibold hover:underline">← {t.contacts.back}</Link>} />

      {sp.saved ? (
        <p role="status" aria-live="polite" className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm">
          {sp.saved === "assign" ? t.contacts.assigned
            : sp.saved === "note" ? t.contacts.noteAdded
            : sp.saved === "anonymized" ? `${t.contacts.activityAnonymized} · ${t.contacts.notesRemoved}`
            : sp.saved?.startsWith("lifecycle_") ? t.contacts.statusChanged
            : t.contacts.statusChanged}
        </p>
      ) : null}
      {/* Bounded error codes only — the URL never carries note text or any other PII. */}
      {sp.e ? (
        <p role="alert" className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]">
          {sp.e === "note_empty" ? t.contacts.noteEmpty
            : sp.e === "note_long" ? t.contacts.noteTooLong
            : sp.e === "confirm" ? t.contacts.confirmFailed
            : sp.e === "lifecycle" ? t.contacts.lifecycleFailed
            : sp.e === "note_error" || sp.e === "not_found" ? t.contacts.noteError
            : t.contacts.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="info">{bizLabel(t.status, contact.status)}</Badge>
        <Badge tone={anonymized ? "muted" : contact.lifecycleState === BusinessContactLifecycle.Spam ? "warning" : "neutral"}>
          {t.contacts[`life_${contact.lifecycleState}` as const]}
        </Badge>
        {anonymized ? null : (
          <span className="text-sm text-[var(--color-muted)]">
            {t.contacts.colAssignee2}: <span className="font-medium text-[var(--color-fg)]">{assigneeLabel}</span>
          </span>
        )}
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

      {anonymized ? (
        <p className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]">{t.contacts.actionUnavailable}</p>
      ) : null}

      {canManage && allow.canChangeStatus && allow.canAssign ? (
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

      {/* Phase C — privacy lifecycle controls. Manager-only; every option is derived from the shared
          availability rule, so the UI never offers something the server would refuse. */}
      {canManage && !anonymized ? (
        <Card>
          <h2 className="text-sm font-semibold">{t.contacts.lifecycle}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              [allow.canArchive, BusinessContactLifecycle.Archived, t.contacts.archive],
              [allow.canUnarchive, BusinessContactLifecycle.Active, t.contacts.unarchive],
              [allow.canMarkSpam, BusinessContactLifecycle.Spam, t.contacts.markSpam],
              [allow.canRestoreSpam, BusinessContactLifecycle.Active, t.contacts.restoreSpam],
            ] as const).filter(([shown]) => shown).map(([, target, label]) => (
              <form key={label} action={changeContactLifecycleAction}>
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="lifecycle" value={target} />
                <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-2)]">{label}</button>
              </form>
            ))}
          </div>

          {/* Irreversible. Requires the exact bounded confirmation value, compared server-side against a
              non-localized constant so no translation can weaken it. */}
          <details className="mt-4 rounded-lg border border-[var(--color-danger)] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-danger)]">{t.contacts.anonymizeTitle}</summary>
            <p className="mt-2 text-xs text-[var(--color-muted)]">{t.contacts.irreversible}</p>
            <form action={anonymizeContactAction} className="mt-3 space-y-2">
              <input type="hidden" name="contactId" value={contact.id} />
              <div>
                <label htmlFor="reason" className="block text-xs font-semibold">{t.contacts.anonymizeReason}</label>
                <select id="reason" name="reason" defaultValue="" className="mt-1 w-full rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-2 text-sm">
                  <option value="">{t.contacts.anonymizeReasonNone}</option>
                  {ALL_ANONYMIZATION_REASONS.map((r) => (
                    <option key={r} value={r}>{t.contacts[`reason_${r}` as const]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="confirm" className="block text-xs font-semibold">{t.contacts.confirmLabel}</label>
                <input id="confirm" name="confirm" required autoComplete="off" placeholder={CONTACT_ANONYMIZATION_CONFIRMATION}
                  aria-describedby="confirm-hint"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-2 text-sm" />
                <p id="confirm-hint" className="mt-1 text-xs text-[var(--color-muted)]">{t.contacts.confirmHint}</p>
              </div>
              <button type="submit" className="rounded-lg border border-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-[var(--color-danger)]">{t.contacts.anonymize}</button>
            </form>
          </details>
        </Card>
      ) : null}

      {/* Internal notes — append-only in this phase (no edit, no delete). Only a manager may create one. */}
      <Card>
        <h2 className="text-sm font-semibold">{t.contacts.notes}</h2>
        {canManage && allow.canAddNote ? (
          <form action={addContactNoteAction} className="mt-3 space-y-2">
            <input type="hidden" name="contactId" value={contact.id} />
            <label htmlFor="body" className="sr-only">{t.contacts.addNote}</label>
            <textarea
              id="body" name="body" required rows={3} maxLength={CONTACT_NOTE_MAX_LENGTH}
              placeholder={t.contacts.notePlaceholder}
              className="w-full rounded-lg border border-[var(--color-border-strong)] bg-transparent px-3 py-2 text-sm"
            />
            <SubmitNoteButton label={t.contacts.addNote} />
          </form>
        ) : null}
        {notes.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{t.contacts.noNotes}</p>
        ) : null}
      </Card>

      {/* Activity timeline — chronological (oldest first), bounded. Actors render as a tenant-member email;
          an unmapped id renders as nothing rather than leaking a raw user id. */}
      <Card>
        <h2 className="text-sm font-semibold">{t.contacts.activity}</h2>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{t.contacts.activityEmpty}</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {timeline.map((e, i) => (
              <li key={`${e.kind}-${e.at.toISOString()}-${i}`} className="border-l-2 border-[var(--color-border)] pl-3">
                <p className="text-xs text-[var(--color-muted)]">
                  <time dateTime={e.at.toISOString()}>{dtf.format(e.at)}</time>
                  {e.actor ? <> · {t.contacts.activityBy} {e.actor}</> : null}
                </p>
                <p className="text-sm font-medium">{timelineLabel(e, t)}</p>
                {/* A note's own stored body — plain text, escaped by React, never rendered as HTML. */}
                {e.kind === "note" && e.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-muted)]">{e.body}</p>
                ) : null}
                {e.kind === "note" && e.redacted ? (
                  <p className="mt-1 text-sm italic text-[var(--color-muted)]">{t.contacts.noteRedacted}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/** Bounded label per timeline entry. Never renders a raw audit event name or provider identifier. */
function timelineLabel(e: ContactTimelineEntry, t: ReturnType<typeof businessDict>): string {
  switch (e.kind) {
    case "received": return t.contacts.activityReceived;
    case "status_changed": return e.status ? `${t.contacts.activityStatusChanged}: ${bizLabel(t.status, e.status)}` : t.contacts.activityStatusChanged;
    case "assignment_changed": return e.assigned ? t.contacts.activityAssigned : t.contacts.activityUnassigned;
    case "note": return t.contacts.activityNote;
    case "archived": return t.contacts.activityArchived;
    case "unarchived": return t.contacts.activityUnarchived;
    case "marked_spam": return t.contacts.activitySpam;
    case "spam_restored": return t.contacts.activitySpamRestored;
    case "anonymized": return t.contacts.activityAnonymized;
  }
}
