import Link from "next/link";
import { PageHeader, Card, Badge, SectionHeader, EmptyState } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { canViewCyberbullying, getCyberbullyingIncidentDetail } from "@/server/cyberbullying-inbox";
import { CB_COPY, statusTone } from "../../cb-i18n";
import { transitionIncidentAction, reopenIncidentAction, assignReviewerAction, unassignReviewerAction, addReviewerNoteAction } from "./actions";

export const dynamic = "force-dynamic";

const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const INPUT = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]";

export default async function CyberbullyingIncidentDetailPage({ params, searchParams }: { params: Promise<{ incidentId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const locale = await getLocale();
  const session = await requireVerifiedSession();
  if (!canViewCyberbullying(session.role)) return <AccessDeniedState locale={locale} />;
  const cap = await requireDashboardCapability("cyberbullyingProtection");
  if (!cap.allowed) return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;

  const t = CB_COPY[locale];
  const { incidentId } = await params;
  const { ok, err } = await searchParams;
  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  const inc = await getCyberbullyingIncidentDetail(actor, incidentId);

  const back = <Link href="/dashboard/security/cyberbullying/incidents" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">← {t.backToInbox}</Link>;

  if (!inc) {
    return (
      <>
        <PageHeader eyebrow="Security · Cyberbullying" title={t.detailTitle} action={back} />
        <EmptyState title={t.error.notFound} body={t.error.body} />
      </>
    );
  }

  const meta = (k: string, v: string | number | boolean | null | undefined) => (
    <div className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
      <span className="text-[var(--color-muted)]">{k}</span>
      <span className="text-right text-[var(--color-fg)]">{v === null || v === "" ? "—" : String(v)}</span>
    </div>
  );

  const a = inc.actions;
  const hasReviewActions = a.transitions.length > 0 || a.canReopen || a.canAssign || a.canReassign || a.canUnassign;
  const errMsg = err ? (t.banner[err as keyof typeof t.banner] ?? t.banner.error) : null;

  return (
    <>
      <PageHeader eyebrow="Security · Cyberbullying" title={t.detailTitle} description={t.detectOnly}
        action={<div className="flex items-center gap-3"><Badge tone={statusTone(inc.status)}>{t.status[inc.status] ?? inc.status}</Badge>{back}</div>} />

      {/* Server-action outcome banner — code only, never a raw error. */}
      {errMsg ? (
        <div className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errMsg}</div>
      ) : ok ? (
        <div className="mb-4 rounded-lg border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-sm text-[var(--color-ok)]"><span aria-hidden="true">✓</span> {t.banner.ok}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {/* Overview + subject */}
          <Card>
            <SectionHeader title={t.section.overview} />
            {meta(t.col.status, t.status[inc.status] ?? inc.status)}
            {meta(t.col.source, inc.reportSource ? t.reportSource[inc.reportSource] : "—")}
            {meta(t.col.created, new Date(inc.createdAt).toISOString().slice(0, 16).replace("T", " "))}
            {meta(t.col.updated, inc.updatedAt ? new Date(inc.updatedAt).toISOString().slice(0, 16).replace("T", " ") : "—")}
            {meta(t.section.subject, inc.subjectLabel)}
            {meta(t.assign.title, inc.assignedReviewerUserId ? (inc.assignedToMe ? t.assign.you : inc.assignedReviewerUserId) : t.assign.unassigned)}
          </Card>

          {/* Review actions — ONLY what this actor is permitted to do (server-computed). */}
          <Card>
            <SectionHeader title={t.actionsPanel.title} />
            {!hasReviewActions && !a.canAddNote ? (
              <p className="text-sm text-[var(--color-muted)]">{t.actionsPanel.none}</p>
            ) : (
              <div className="space-y-4">
                {/* Lifecycle change: select of legal, permitted targets + reason. */}
                {a.transitions.length > 0 ? (
                  <form action={transitionIncidentAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="incidentId" value={inc.id} />
                    <label className="flex-1 min-w-[10rem] text-xs font-medium text-[var(--color-muted)]">
                      {t.actionsPanel.changeStatus}
                      <select name="to" className={`${INPUT} mt-1`} defaultValue={inc.actions.transitions[0]!.to}>
                        {a.transitions.map((tr) => (
                          <option key={tr.to} value={tr.to}>{t.act[tr.to as keyof typeof t.act] ?? tr.to}{tr.requiresReason ? " *" : ""}</option>
                        ))}
                      </select>
                    </label>
                    <input name="reason" placeholder={t.actionsPanel.reasonOptional} className={`${INPUT} flex-1 min-w-[10rem]`} />
                    <button type="submit" className={BTN}>{t.actionsPanel.submit}</button>
                  </form>
                ) : null}

                {/* Reopen — elevated, reason mandatory. */}
                {a.canReopen ? (
                  <form action={reopenIncidentAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="incidentId" value={inc.id} />
                    <input name="reason" required placeholder={t.actionsPanel.reasonRequired} className={`${INPUT} flex-1 min-w-[12rem]`} />
                    <button type="submit" className={BTN}>{t.act.reopen}</button>
                  </form>
                ) : null}

                {/* Assignment — one primary reviewer. */}
                <div className="flex flex-wrap gap-2">
                  {a.canAssign ? (
                    <form action={assignReviewerAction}><input type="hidden" name="incidentId" value={inc.id} /><button type="submit" className={BTN}>{t.assign.claim}</button></form>
                  ) : null}
                  {a.canReassign ? (
                    <form action={assignReviewerAction}><input type="hidden" name="incidentId" value={inc.id} /><button type="submit" className={BTN}>{t.assign.reassign}</button></form>
                  ) : null}
                  {a.canUnassign ? (
                    <form action={unassignReviewerAction}><input type="hidden" name="incidentId" value={inc.id} /><button type="submit" className={BTN}>{t.assign.unassign}</button></form>
                  ) : null}
                </div>
              </div>
            )}
          </Card>

          {/* Summary (confidential — shown to authorized reviewer, never logged) */}
          <Card>
            <SectionHeader title={t.section.summary} />
            <p className="text-sm text-[var(--color-fg)]">{inc.summary ?? "—"}</p>
          </Card>

          {/* Alleged actor — neutral */}
          <Card>
            <SectionHeader title={t.section.allegedActor} description={t.allegedNote} />
            <p className="text-sm text-[var(--color-fg)]">{inc.allegedActorLabel ?? "—"}</p>
          </Card>

          {/* Reviewer notes — confidential, append-only, never shown to a protected subject. */}
          {inc.canSeeNotes ? (
            <Card>
              <SectionHeader title={t.notes.title} description={t.notes.subtitle} action={<Badge tone="warn">{t.notes.confidential}</Badge>} />
              {a.canAddNote ? (
                <form action={addReviewerNoteAction} className="mb-4 space-y-2">
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <textarea name="body" required rows={2} placeholder={t.notes.placeholder} className={INPUT} />
                  <button type="submit" className={BTN}>{t.notes.add}</button>
                </form>
              ) : null}
              {inc.notes.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.notes.empty}</p>
              ) : (
                <ul className="space-y-3">
                  {inc.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-[var(--color-border)] p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
                        <span>{n.isMine ? t.notes.you : n.authorUserId}</span>
                        <span>{new Date(n.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* Linked evidence — METADATA ONLY (no content, no hash, no storage key) */}
          <Card>
            <SectionHeader title={t.section.evidence} />
            {inc.evidence.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.empty.noEvidence}</p>
            ) : (
              <div className="space-y-3">
                {inc.evidence.map((e) => (
                  <div key={e.id} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone="neutral">{e.evidenceType}</Badge>
                      <Badge tone={e.scanStatus === "clean" ? "ok" : e.scanStatus === "infected" ? "danger" : "warn"}>{t.evidenceMeta.scan}: {e.scanStatus}</Badge>
                      <Badge tone={e.integrityStatus === "verified" ? "ok" : "neutral"}>{t.evidenceMeta.integrity}: {e.integrityStatus}</Badge>
                      {e.legalHold ? <Badge tone="warn">{t.evidenceMeta.legalHold}</Badge> : null}
                    </div>
                    <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                      {meta(t.evidenceMeta.source, e.sourceType)}
                      {meta(t.evidenceMeta.captureMethod, e.captureMethod)}
                      {meta(t.evidenceMeta.capturedAt, new Date(e.capturedAt).toISOString().slice(0, 16).replace("T", " "))}
                      {meta(t.evidenceMeta.mimeType, e.mimeType)}
                      {meta(t.evidenceMeta.sizeBytes, e.sizeBytes)}
                      {meta(t.evidenceMeta.retention, e.retentionUntil ? new Date(e.retentionUntil).toISOString().slice(0, 10) : "—")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Participants */}
          <Card>
            <SectionHeader title={t.section.participants} />
            <ul className="space-y-2">
              {inc.participants.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{p.subjectLabel ?? (p.hasExternalRef ? "—" : t.system)}</span>
                  <Badge tone={p.role === "alleged_actor" ? "warn" : "neutral"}>{t.participantRole[p.role] ?? p.role}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          {/* Linked detections — sanitized metadata */}
          <Card>
            <SectionHeader title={t.section.detections} />
            {inc.detections.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.empty.noDetections}</p>
            ) : (
              <ul className="space-y-2">
                {inc.detections.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-[var(--color-fg)]">{d.kind}</span>
                    <span className="flex items-center gap-1"><Badge tone="neutral">{d.severity}</Badge><Badge tone="neutral">{d.detectionStatus}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Assignment history — append-only (reviewers only). */}
          {inc.canSeeNotes ? (
            <Card>
              <SectionHeader title={t.assign.historyTitle} />
              {inc.assignmentHistory.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t.assign.historyEmpty}</p>
              ) : (
                <ul className="space-y-2.5">
                  {inc.assignmentHistory.map((h) => (
                    <li key={h.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t.assign.actionLabel[h.action as keyof typeof t.assign.actionLabel] ?? h.action}</span>
                        <span className="text-xs text-[var(--color-muted)]">{new Date(h.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                      </div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {h.assigneeUserId ? `→ ${h.assigneeUserId === actor.userId ? t.assign.you : h.assigneeUserId}` : "—"} · {t.assign.by} {h.assignedByUserId === actor.userId ? t.assign.you : h.assignedByUserId}
                        {h.reason ? ` · ${t.reason}: ${h.reason}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* Timeline — append-only, localized event labels */}
          <Card>
            <SectionHeader title={t.section.timeline} />
            {inc.timeline.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.empty.noTimeline}</p>
            ) : (
              <ul className="space-y-2.5">
                {inc.timeline.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.timelineEvent[e.eventType] ?? e.eventType}</span>
                      <span className="text-xs text-[var(--color-muted)]">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <div className="text-xs text-[var(--color-muted)]">{e.hasActor ? "" : t.system}{e.reason ? ` · ${t.reason}: ${e.reason}` : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
