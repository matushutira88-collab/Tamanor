import Link from "next/link";
import { listProtectedProfiles, listSafetySignals, listSafetySignalDeliveries, withTenant } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { Card, SectionHeader, StatCard, Badge } from "@/components/dashboard/ui";
import { FamilyIconGlyph } from "../family-icons";
import { familyDict, famLabel } from "../family-i18n";
import { FamilyEmptyCard, FAMILY_CTA_PRIMARY, FAMILY_LINK } from "../family-ui";

export const dynamic = "force-dynamic";

function fmt(d: Date): string { return new Date(d).toISOString().slice(0, 10); }

/** Review states that mean a signal no longer needs anyone's attention. */
const CLOSED_REVIEW_STATES = ["dismissed", "archived"] as const;

export default async function FamilyDashboard() {
  const { session, actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const now = new Date();

  // Real, tenant-scoped (RLS) data — never test fixtures.
  const [profiles, signalsPage, deliveriesPage, counts] = await Promise.all([
    listProtectedProfiles(actor),
    listSafetySignals(actor, { limit: 5 }),
    listSafetySignalDeliveries(actor, { deliveryStatus: "available", limit: 5 }),
    withTenant(session.tenantId, (db) => Promise.all([
      db.guardianRelationship.count({ where: { tenantId: session.tenantId, status: "verified", revokedAt: null, archivedAt: null } }),
      // "Open" = still needs attention: everything except dismissed/archived reviews.
      db.safetySignal.count({ where: { tenantId: session.tenantId, archivedAt: null, reviewStatus: { notIn: [...CLOSED_REVIEW_STATES] } } }),
      // "Active" = authorized, not revoked/superseded/archived, and inside its validity window.
      db.safetyRecipientAuthorizationDecision.count({
        where: {
          tenantId: session.tenantId, decisionStatus: "authorized", revokedAt: null, supersededAt: null, archivedAt: null,
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      }),
    ])),
  ]);
  const [activeGuardians, openSignals, activeAuth] = counts;
  const recentProfiles = profiles.slice(0, 5);

  // Onboarding checklist — data-derived, and it disappears once the space is set up.
  const steps = [
    { done: profiles.length > 0, label: t.dash.checklistProfile, hint: t.dash.checklistProfileHint, href: "/family/profiles" },
    { done: activeGuardians > 0, label: t.dash.checklistGuardian, hint: t.dash.checklistGuardianHint, href: "/family/guardians" },
    { done: profiles.length > 0 && activeGuardians > 0, label: t.dash.checklistPrivacy, hint: t.dash.checklistPrivacyHint, href: "/family/settings" },
  ];
  const setupComplete = steps.every((s) => s.done);

  // Recent events — signals and internal deliveries merged into one reverse-chronological feed.
  const events = [
    ...signalsPage.items.map((s) => ({
      key: `s-${s.id}`, at: s.createdAt, href: "/family/signals", kind: t.dash.activitySignal,
      title: famLabel(t.labels.signalType, s.signalType),
      meta: `${famLabel(t.labels.severity, s.severity)} · ${famLabel(t.labels.reviewStatus, s.reviewStatus)}`,
      tone: s.severity === "critical" || s.severity === "high" ? "warn" : "neutral",
    })),
    ...deliveriesPage.items.map((d) => ({
      key: `d-${d.id}`, at: d.availableAt ?? d.preparedAt, href: "/family/deliveries", kind: t.dash.activityDelivery,
      title: famLabel(t.labels.signalType, d.signalType),
      meta: famLabel(t.labels.deliveryStatus, d.deliveryStatus),
      tone: "ok",
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Hero — the one-line answer to "is my family OK?", plus the primary action. */}
      <section className="gu-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] ring-1 ring-inset ring-current/15">
                <FamilyIconGlyph icon="shield" />
              </span>
              <Badge tone="brand">{t.brand}</Badge>
            </div>
            <h1 className="gu-display mt-4 text-[30px] leading-tight sm:text-[34px]">{t.dash.heroTitle}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-muted)]">{t.dash.heroBody}</p>
            <p className="mt-3 text-xs text-[var(--color-muted)]">{t.dash.primaryGuardian}: <span className="font-medium text-[var(--color-fg)]">{session.userName}</span></p>
          </div>
          <Link
            href="/family/profiles"
            className={`shrink-0 ${FAMILY_CTA_PRIMARY}`}
          >
            {t.dash.addProfile}
            <FamilyIconGlyph icon="arrow" />
          </Link>
        </div>
        <p className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-xs text-[var(--color-muted)]">{t.privacy.messages}</p>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/family/profiles" className="block"><StatCard label={t.dash.kpiProfiles} value={String(profiles.length)} tone="brand" icon={<FamilyIconGlyph icon="profiles" />} /></Link>
        <Link href="/family/guardians" className="block"><StatCard label={t.dash.kpiGuardians} value={String(activeGuardians)} tone="brand" icon={<FamilyIconGlyph icon="guardians" />} /></Link>
        <Link href="/family/authorizations" className="block"><StatCard label={t.dash.kpiActiveAuth} value={String(activeAuth)} tone="ok" icon={<FamilyIconGlyph icon="authorizations" />} /></Link>
        <Link href="/family/signals" className="block"><StatCard label={t.dash.kpiOpenSignals} value={String(openSignals)} tone={openSignals > 0 ? "warn" : "neutral"} icon={<FamilyIconGlyph icon="signals" />} /></Link>
      </div>

      {/* Onboarding checklist — only while there is something left to do. */}
      {setupComplete ? null : (
        <Card>
          <SectionHeader title={t.dash.checklistTitle} description={t.dash.checklistBody} />
          <ol className="space-y-1">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-[var(--color-surface-2)]">
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
                      s.done
                        ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)] ring-current/25"
                        : "bg-[var(--color-surface-2)] text-[var(--color-muted)] ring-[var(--color-border)]"
                    }`}
                  >
                    {s.done ? <FamilyIconGlyph icon="check" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-medium ${s.done ? "text-[var(--color-muted)] line-through" : "text-[var(--color-fg)]"}`}>{s.label}</span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{s.hint}</span>
                  </span>
                  <Badge tone={s.done ? "ok" : "neutral"}>{s.done ? t.dash.checklistDone : t.dash.checklistTodo}</Badge>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Protected profiles overview */}
        <Card>
          <SectionHeader title={t.dash.recentProfiles} action={<Link href="/family/profiles" className={FAMILY_LINK}>{t.common.view}</Link>} />
          {recentProfiles.length === 0 ? (
            <p className="py-2 text-sm text-[var(--color-muted)]">{t.profiles.emptyText}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {recentProfiles.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/family/profiles/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.guardianLabel ?? famLabel(t.labels.ageBand, p.ageBand)}</Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-muted)]">
                    <Badge tone="neutral">{famLabel(t.labels.ageBand, p.ageBand)}</Badge>
                    <Badge tone={p.archivedAt ? "neutral" : "ok"}>{p.archivedAt ? t.profiles.archived : famLabel(t.labels.protectionStatus, p.protectionStatus)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent events — signals + internal deliveries in one feed. */}
        <Card>
          <SectionHeader title={t.dash.activityTitle} action={<Link href="/family/signals" className={FAMILY_LINK}>{t.common.view}</Link>} />
          {events.length === 0 ? (
            <p className="py-2 text-sm text-[var(--color-muted)]">{t.dash.activityEmpty}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {events.map((e) => (
                <li key={e.key}>
                  <Link href={e.href} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm transition hover:opacity-80">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge tone={e.tone}>{e.title}</Badge>
                      <span className="truncate text-xs text-[var(--color-muted)]">{e.kind} · {e.meta}</span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">{fmt(e.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Nothing has ever happened here — explain why, rather than leaving an empty box. */}
      {events.length === 0 ? (
        <FamilyEmptyCard
          illustration="protected"
          title={t.empty.dashTitle}
          body={t.empty.dashBody}
          hint={t.privacy.signal}
          primary={{ href: "/family/profiles", label: t.empty.dashCta }}
          secondary={{ href: "/family/settings", label: t.empty.dashSecondary }}
        />
      ) : null}
    </div>
  );
}
