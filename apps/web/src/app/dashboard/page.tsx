import Link from "next/link";
import { TrackView } from "@/components/analytics/track-view";
import { accountProtectionScore, type WatchedAccountView } from "@guardora/db";
import type { CheckState } from "@/components/dashboard/protection-score";
import { PageHeader, Card, SectionHeader, EmptyState, PrimaryButton } from "@/components/dashboard/ui";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AccountCard } from "@/components/dashboard/account-card";
import { ProtectionScore } from "@/components/dashboard/protection-score";
import { AreaTrend } from "@/components/dashboard/trend-chart";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { loadOnboarding } from "./onboarding-actions";
import { getDictionary } from "@/i18n";
import { PLATFORM_META, Platform, RiskLevel } from "@guardora/core";
import { requireSession } from "@/server/auth";
import { getT } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
import {
  withTenant,
  getDashboardKpis,
  getDashboardKpiDeltas,
  getRiskByCategory,
  getWatchedAccountsView,
} from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { formatDate, formatDateTime } from "@/lib/format";
import { bucketByDay } from "@/lib/trend";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const TIMEFRAMES = [7, 30, 90] as const;
type Tf = (typeof TIMEFRAMES)[number];

const COPY = {
  en: {
    eyebrow: "Overview", greeting: "Welcome back", subtitle: "Here’s what’s happening with your brand reputation today.",
    connect: "Connect account", viewAll: "View all", vsPrev: "vs. previous period",
    kAnalyzed: "Analyzed comments", kRisk: "Risk comments", kAutoHidden: "Auto-handled", kPending: "Pending review", kProblem: "Accounts with problem",
    pendingHint: "Awaiting decision", problemHint: "Need attention",
    watched: "Watched accounts", acComments: "Comments", acRisky: "Risky", acAutoHide: "Auto-hide", on: "On", off: "Off",
    stActive: "Active", stAttention: "Needs attention", stExpired: "Permissions expired", stMonitorOff: "Monitoring off", stMock: "Demo",
    lastSync: "Synced", neverSync: "Not synced yet",
    riskChart: "Risk comments", riskChartDesc: "Trend over the selected period.", noRisk: "No risk comments in this period.",
    activity: "Recent activity", noActivity: "No recent activity yet.", viewActivity: "View all activity",
    protection: "Protection level", improve: "How to improve protection", ok: "OK", partial: "Partial", offL: "Off",
    chk: { metaPermissionsHealthy: "Platform permissions", syncHealthy: "Synchronization", rulesActive: "Protection rules", dangerousLinksHandled: "Dangerous links", fraudProtection: "Fraud protection", reviewWorkflow: "Review workflow", actionConfigured: "Action configured" },
  },
  sk: {
    eyebrow: "Prehľad", greeting: "Vitajte späť", subtitle: "Tu je prehľad ochrany vašej reputácie dnes.",
    connect: "Pripojiť účet", viewAll: "Zobraziť všetky", vsPrev: "vs. predch. obdobie",
    kAnalyzed: "Analyzované komentáre", kRisk: "Rizikové komentáre", kAutoHidden: "Automaticky ošetrené", kPending: "Čakajúce na rozhodnutie", kProblem: "Účty s problémom",
    pendingHint: "Čaká na rozhodnutie", problemHint: "Vyžadujú pozornosť",
    watched: "Strážené účty", acComments: "Komentáre", acRisky: "Rizikové", acAutoHide: "Auto-skrývanie", on: "Zapnuté", off: "Vypnuté",
    stActive: "Aktívny", stAttention: "Vyžaduje pozornosť", stExpired: "Oprávnenie expirovalo", stMonitorOff: "Monitorovanie vypnuté", stMock: "Demo",
    lastSync: "Synchronizované", neverSync: "Zatiaľ nesynchronizované",
    riskChart: "Rizikové komentáre", riskChartDesc: "Vývoj za zvolené obdobie.", noRisk: "Za toto obdobie žiadne rizikové komentáre.",
    activity: "Aktuálna aktivita", noActivity: "Zatiaľ žiadna aktivita.", viewActivity: "Zobraziť všetku aktivitu",
    protection: "Úroveň ochrany", improve: "Ako zvýšiť úroveň ochrany", ok: "V poriadku", partial: "Čiastočne", offL: "Vypnuté",
    chk: { metaPermissionsHealthy: "Oprávnenia platforiem", syncHealthy: "Synchronizácia", rulesActive: "Pravidlá ochrany", dangerousLinksHandled: "Nebezpečné odkazy", fraudProtection: "Ochrana pred podvodmi", reviewWorkflow: "Proces kontroly", actionConfigured: "Nastavená akcia" },
  },
  de: {
    eyebrow: "Übersicht", greeting: "Willkommen zurück", subtitle: "Das passiert heute mit Ihrer Markenreputation.",
    connect: "Konto verbinden", viewAll: "Alle anzeigen", vsPrev: "vs. Vorperiode",
    kAnalyzed: "Analysierte Kommentare", kRisk: "Risiko-Kommentare", kAutoHidden: "Automatisch bearbeitet", kPending: "Zur Prüfung", kProblem: "Konten mit Problem",
    pendingHint: "Wartet auf Entscheidung", problemHint: "Benötigen Aufmerksamkeit",
    watched: "Überwachte Konten", acComments: "Kommentare", acRisky: "Risiko", acAutoHide: "Auto-Ausblenden", on: "An", off: "Aus",
    stActive: "Aktiv", stAttention: "Aufmerksamkeit nötig", stExpired: "Berechtigungen abgelaufen", stMonitorOff: "Überwachung aus", stMock: "Demo",
    lastSync: "Synchronisiert", neverSync: "Noch nicht synchronisiert",
    riskChart: "Risiko-Kommentare", riskChartDesc: "Verlauf im gewählten Zeitraum.", noRisk: "Keine Risiko-Kommentare in diesem Zeitraum.",
    activity: "Letzte Aktivität", noActivity: "Noch keine Aktivität.", viewActivity: "Alle Aktivitäten",
    protection: "Schutzniveau", improve: "Schutz verbessern", ok: "In Ordnung", partial: "Teilweise", offL: "Aus",
    chk: { metaPermissionsHealthy: "Plattform-Berechtigungen", syncHealthy: "Synchronisierung", rulesActive: "Schutzregeln", dangerousLinksHandled: "Gefährliche Links", fraudProtection: "Betrugsschutz", reviewWorkflow: "Prüfprozess", actionConfigured: "Aktion konfiguriert" },
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

const ACTIVITY_LABEL = {
  en: { "sync.completed": "Synchronization completed", "sync.failed": "Synchronization failed", "auto_protect.would_auto_hide": "Comment flagged for auto-hide", "protection.action_executed": "Comment hidden", "incident.created": "Incident created", "proposal.created": "Action proposed", "account.connected": "Account connected", "token.expired": "Permissions expired" },
  sk: { "sync.completed": "Synchronizácia dokončená", "sync.failed": "Synchronizácia zlyhala", "auto_protect.would_auto_hide": "Komentár označený na skrytie", "protection.action_executed": "Komentár skrytý", "incident.created": "Vytvorený incident", "proposal.created": "Navrhnutá akcia", "account.connected": "Účet pripojený", "token.expired": "Oprávnenia expirovali" },
  de: { "sync.completed": "Synchronisierung abgeschlossen", "sync.failed": "Synchronisierung fehlgeschlagen", "auto_protect.would_auto_hide": "Kommentar zum Ausblenden markiert", "protection.action_executed": "Kommentar ausgeblendet", "incident.created": "Vorfall erstellt", "proposal.created": "Aktion vorgeschlagen", "account.connected": "Konto verbunden", "token.expired": "Berechtigungen abgelaufen" },
};
const ACTIVITY_EVENTS = Object.keys(ACTIVITY_LABEL.en);
const ACTIVITY_TONE: Record<string, string> = {
  "sync.completed": "ok", "sync.failed": "danger", "auto_protect.would_auto_hide": "brand",
  "protection.action_executed": "brand", "incident.created": "danger", "proposal.created": "warn",
  "account.connected": "ok", "token.expired": "warn",
};

/** Percent change cur vs prev; null when prev is 0 (no honest baseline). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function accountBadge(a: WatchedAccountView, c: Copy): { tone: string; label: string } {
  switch (a.problem) {
    case "permissions_expired": return { tone: "danger", label: c.stExpired };
    case "needs_reconnect": return { tone: "danger", label: c.stExpired };
    case "sync_failed": return { tone: "warn", label: c.stAttention };
    case "monitoring_off": return { tone: "neutral", label: c.stMonitorOff };
    default: return a.status === "mock_connected" ? { tone: "brand", label: c.stMock } : { tone: "ok", label: c.stActive };
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tf?: string }> }) {
  const session = await requireSession();
  const t = await getT();
  const locale = await getLocale();
  const c = COPY[locale];
  const realMode = await getRealModeFilter(session.tenantId);
  // V1.66 — this member's OWN onboarding (auto-completes first when every required step is real).
  // Fail-open inside loadOnboarding: onboarding must never be able to take the dashboard down.
  const onboarding = await loadOnboarding(session.tenantId, session.userId);
  const dict = getDictionary(locale);

  const tfRaw = Number((await searchParams).tf);
  const tf: Tf = (TIMEFRAMES as readonly number[]).includes(tfRaw) ? (tfRaw as Tf) : 30;
  const now = Date.now();
  const since = new Date(now - tf * DAY);
  const prevSince = new Date(now - 2 * tf * DAY);

  const where = { tenantId: session.tenantId, ...realMode.brandWhere };

  const [kpi, deltas, categories, watched, trendRows, activity] = await Promise.all([
    getDashboardKpis(session.tenantId, since),
    getDashboardKpiDeltas(session.tenantId, prevSince, since),
    getRiskByCategory(session.tenantId, since),
    getWatchedAccountsView(session.tenantId, since),
    withTenant(session.tenantId, (db) => db.reputationItem.findMany({
      where: { ...where, riskLevel: { in: [RiskLevel.High, RiskLevel.Critical] }, createdAt: { gte: since } },
      select: { createdAt: true },
    })),
    withTenant(session.tenantId, (db) => db.auditLog.findMany({
      where: { tenantId: session.tenantId, event: { in: ACTIVITY_EVENTS } },
      orderBy: { createdAt: "desc" }, take: 6, select: { id: true, event: true, createdAt: true },
    })),
  ]);

  const firstName = session.userName.split(" ")[0] ?? session.userName;

  // Empty workspace (no accounts, no comments) → onboarding.
  if (watched.length === 0 && kpi.analyzedComments === 0) {
    return (
      <>
        <TrackView event="dashboard_opened" />
        <PageHeader eyebrow={c.eyebrow} title={`${c.greeting}, ${firstName}`} description={c.subtitle}
          action={<Link href="/dashboard/accounts"><PrimaryButton type="button">{c.connect}</PrimaryButton></Link>} />
        {realMode.isRealMode ? (
          <div className="mb-4 rounded-lg border border-[var(--color-brand)] px-3 py-2 text-sm">
            🧪 <span className="font-medium">{t.dash.realTestMode}</span> · <span className="text-[var(--color-muted)]">{t.dash.realTestModeHint}</span>
          </div>
        ) : null}
        {/* V1.66 — on an empty workspace the setup guide leads and the empty state supports it: a member
            with nothing connected should continue through onboarding, not stare at a blank dashboard. */}
        <OnboardingPanel state={onboarding} dict={dict} />
        <EmptyState title={t.ui.emptyDashboardTitle} body={t.ui.emptyDashboardBody} hint={t.ui.emptyDashboardHint}
          action={<Link href="/dashboard/accounts"><PrimaryButton type="button">{c.connect}</PrimaryButton></Link>} />
      </>
    );
  }

  const trend = bucketByDay(trendRows.map((r) => r.createdAt), tf);
  const catTotal = categories.reduce((s, r) => s + r.count, 0);

  const dAnalyzed = deltaPct(kpi.analyzedComments, deltas.analyzedComments);
  const dRisk = deltaPct(kpi.riskComments, deltas.riskComments);
  const dAuto = deltaPct(kpi.autoHidden, deltas.autoHidden);

  const protection = aggregateProtection(watched, c);

  const tfHref = (d: Tf) => (`/dashboard?tf=${d}` as const);

  return (
    <>
      <TrackView event="dashboard_opened" />
      <PageHeader
        eyebrow={c.eyebrow}
        title={`${c.greeting}, ${firstName}`}
        description={c.subtitle}
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
              {TIMEFRAMES.map((d) => (
                <Link key={d} href={tfHref(d)} aria-current={tf === d ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${d === tf ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>
                  {d}d
                </Link>
              ))}
            </div>
            <Link href="/dashboard/accounts"><PrimaryButton type="button">{c.connect}</PrimaryButton></Link>
          </div>
        }
      />

      {realMode.isRealMode ? (
        <div className="mb-4 rounded-lg border border-[var(--color-brand)] px-3 py-2 text-sm">
          🧪 <span className="font-medium">{t.dash.realTestMode}</span> · <span className="text-[var(--color-muted)]">{t.dash.realTestModeHint}</span>
        </div>
      ) : null}

      {/* V1.66 — per-member setup surface: welcome dialog, live checklist, or a quiet resume entry.
          Placed above the KPIs so the next action is the first thing a half-set-up member sees; it never
          blocks the dashboard below it. */}
      <OnboardingPanel state={onboarding} dict={dict} />

      {/* KPI cards — real numbers (getDashboardKpis), honest deltas on the three event metrics. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label={c.kAnalyzed} value={String(kpi.analyzedComments)} tone="brand" icon={<IconInbox />}
          delta={dAnalyzed === null ? null : { pct: dAnalyzed, good: dAnalyzed >= 0 }} hint={c.vsPrev} href="/dashboard/comments" />
        <KpiCard label={c.kRisk} value={String(kpi.riskComments)} tone="danger" icon={<IconAlert />}
          delta={dRisk === null ? null : { pct: dRisk, good: dRisk <= 0 }} hint={c.vsPrev} href="/dashboard/comments?risk=high" />
        <KpiCard label={c.kAutoHidden} value={String(kpi.autoHidden)} tone="ok" icon={<IconShield />}
          delta={dAuto === null ? null : { pct: dAuto, good: dAuto >= 0 }} hint={c.vsPrev} href="/dashboard/action-queue?state=executed" />
        <KpiCard label={c.kPending} value={String(kpi.pending)} tone="warn" icon={<IconClock />} hint={c.pendingHint} href="/dashboard/action-queue" />
        <KpiCard label={c.kProblem} value={String(kpi.accountsWithProblem)} tone={kpi.accountsWithProblem > 0 ? "danger" : "ok"} icon={<IconPlug />} hint={c.problemHint} href="/dashboard/accounts" />
      </div>

      {/* Watched accounts */}
      {watched.length > 0 ? (
        <div className="mt-8">
          <SectionHeader title={c.watched}
            action={<Link href="/dashboard/accounts" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{c.viewAll} →</Link>} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watched.slice(0, 6).map((a) => (
              <AccountCard key={a.id}
                platform={a.platform}
                name={a.externalName ?? PLATFORM_META[a.platform as Platform]?.label ?? a.platform}
                metaLabel={PLATFORM_META[a.platform as Platform]?.label ?? a.platform}
                comments={a.commentsInWindow}
                risky={a.riskCommentsInWindow}
                autoHideOn={a.protection.autoHideEnabled}
                autoHideLabel={a.protection.autoHideEnabled ? c.on : c.off}
                state={accountBadge(a, c)}
                footer={a.lastSuccessfulSyncAt ? `${c.lastSync} · ${formatDate(a.lastSuccessfulSyncAt)}` : c.neverSync}
                href="/dashboard/accounts"
                strings={{ comments: c.acComments, risky: c.acRisky, autoHide: c.acAutoHide }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Risk chart + activity */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <SectionHeader title={c.riskChart} description={c.riskChartDesc}
            action={<Link href="/dashboard/reputation" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{c.viewAll} →</Link>} />
          {trendRows.length === 0 ? (
            <p className="py-14 text-center text-sm text-[var(--color-muted)]">{c.noRisk}</p>
          ) : (
            <>
              <AreaTrend buckets={trend} />
              {catTotal > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                  {categories.slice(0, 6).map((r) => (
                    <Link key={r.category} href={`/dashboard/comments?risk=${encodeURIComponent(r.category)}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm transition hover:bg-[var(--color-brand-soft)]">
                      {withEmoji("category", r.category, tEnum(t, "category", r.category))}
                      <span className="text-xs font-semibold text-[var(--color-muted)]">{r.count}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <SectionHeader title={c.activity}
            action={<Link href="/dashboard/timeline" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{c.viewActivity} →</Link>} />
          {activity.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-muted)]">{c.noActivity}</p>
          ) : (
            <ul className="space-y-3">
              {activity.map((e) => (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-${ACTIVITY_TONE[e.event] ?? "brand"})]`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--color-fg)]">{(ACTIVITY_LABEL[locale] as Record<string, string>)[e.event] ?? e.event}</span>
                    <span className="text-xs text-[var(--color-muted)]">{formatDateTime(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Protection level */}
      {protection ? (
        <div className="mt-8">
          <Card>
            <SectionHeader title={c.protection}
              action={<Link href="/dashboard/control-center" className="text-xs font-medium text-[var(--color-brand)] hover:underline">{c.improve} →</Link>} />
            <ProtectionScore score={protection.score} checks={protection.checks} ringColor={protection.ringColor} />
          </Card>
        </div>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------------------
   Aggregate the per-account protection scores (accountProtectionScore, itself
   backed by the tested core computeProtectionScore) into ONE dashboard headline
   + a weakest-link checklist: a component reads "OK" only when it holds for
   every monitored account, "Partial" when it holds for some, "Off" for none.
-------------------------------------------------------------------------- */
function aggregateProtection(
  watched: WatchedAccountView[],
  c: Copy,
): { score: number; checks: { label: string; state: CheckState; valueLabel: string }[]; ringColor: string } | null {
  const monitored = watched.filter((a) => a.monitoringEnabled);
  if (monitored.length === 0) return null;

  const scored = monitored.map((a) => accountProtectionScore(a));
  const score = Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length);

  // Component keys are stable from core; labels localized via COPY.chk (fall back to core's English).
  const chk = c.chk as Record<string, string>;
  const keys = scored[0]!.components.map((k) => k.key);
  const checks = keys.map((key) => {
    const okCount = scored.filter((p) => p.components.find((k) => k.key === key)?.ok).length;
    const label = chk[key] ?? scored[0]!.components.find((k) => k.key === key)!.label;
    const state: CheckState = okCount === scored.length ? "ok" : okCount > 0 ? "partial" : "off";
    const valueLabel = state === "ok" ? c.ok : state === "partial" ? c.partial : c.offL;
    return { label, state, valueLabel };
  });

  const ringColor = score >= 80 ? "var(--color-ok)" : score >= 50 ? "var(--color-warn)" : "var(--color-danger)";
  return { score, checks, ringColor };
}

function IconInbox() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L5.5 5Z" /></svg>; }
function IconAlert() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>; }
function IconShield() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>; }
function IconPlug() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" /></svg>; }
