import { getWatchedAccountsView, accountProtectionScore, previewMonitoredAccountLimit, type WatchedAccountView } from "@guardora/db";
import { PlatformIcon } from "./platform-icon";
import { toggleMonitoringAction } from "@/app/dashboard/accounts/monitoring-actions";
import type { Locale } from "@/i18n";

const T = {
  en: { heading: "Watched accounts", monitored: (u: number, l: number) => l < 0 ? `${u} monitored` : `${u} / ${l} monitored accounts`, connect: "Connect account", empty: "No accounts connected yet.", on: "Monitoring on", off: "Monitoring off", limitReached: "Monitoring limit reached. Upgrade your plan.", comments30: "Comments (30d)", risk30: "Risk (30d)", autoHide: "Auto-hide", lastSync: "Last successful sync", unavailable: "Unavailable via current permissions", open: "Open account", setupScore: "Protection setup" },
  sk: { heading: "Strážené účty", monitored: (u: number, l: number) => l < 0 ? `${u} monitorovaných` : `${u} / ${l} monitorovaných účtov`, connect: "Pripojiť účet", empty: "Zatiaľ žiadne pripojené účty.", on: "Monitorovanie zapnuté", off: "Monitorovanie vypnuté", limitReached: "Dosiahli ste limit monitorovaných účtov. Zvýšte si plán.", comments30: "Komentáre (30d)", risk30: "Rizikové (30d)", autoHide: "Auto-skrytie", lastSync: "Posledná úspešná synchronizácia", unavailable: "Nedostupné cez aktuálne oprávnenia", open: "Otvoriť účet", setupScore: "Nastavenie ochrany" },
  de: { heading: "Überwachte Konten", monitored: (u: number, l: number) => l < 0 ? `${u} überwacht` : `${u} / ${l} überwachte Konten`, connect: "Konto verbinden", empty: "Noch keine Konten verbunden.", on: "Überwachung an", off: "Überwachung aus", limitReached: "Überwachungslimit erreicht. Upgraden Sie Ihren Plan.", comments30: "Kommentare (30T)", risk30: "Risiko (30T)", autoHide: "Auto-Ausblenden", lastSync: "Letzte erfolgreiche Synchronisierung", unavailable: "Über aktuelle Berechtigungen nicht verfügbar", open: "Konto öffnen", setupScore: "Schutz-Einrichtung" },
} as const;

/**
 * V1.59 phase 2 — the Watched Accounts overview, driven ENTIRELY by real data from the V1.59 backend
 * (getWatchedAccountsView + the server-computed protection score + the monitored-account limit). Each
 * Facebook Page and each Instagram account is its OWN card (never merged). A value the DB cannot supply
 * is shown as "Unavailable via current permissions", never a fabricated number.
 */
const PLATFORM_LABEL: Record<string, string> = { facebook_page: "Facebook Page", instagram_business: "Instagram Professional" };

const PROBLEM: Record<string, { label: string; tone: string }> = {
  none: { label: "Active", tone: "ok" },
  monitoring_off: { label: "Monitoring off", tone: "neutral" },
  permissions_expired: { label: "Permissions expired", tone: "danger" },
  needs_reconnect: { label: "Needs reconnect", tone: "warn" },
  sync_failed: { label: "Sync failed", tone: "warn" },
};
const TONE: Record<string, string> = {
  ok: "border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)]",
  warn: "border-[var(--color-warn)] text-[var(--color-warn)] bg-[var(--color-warn-soft)]",
  danger: "border-[var(--color-danger)] text-[var(--color-danger)] bg-[var(--color-danger-soft)]",
  neutral: "border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface-2)]",
};
const SCORE_TONE = (level: string) => (level === "strong" || level === "good" ? "ok" : level === "fair" ? "warn" : "danger");

function fmt(d: Date | null, unavailable: string): string { return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : unavailable; }

/** A real, keyboard-accessible monitoring switch backed by a server action (atomic-limit enforced). */
function MonitoringSwitch({ view, atLimit, c }: { view: WatchedAccountView; atLimit: boolean; c: (typeof T)[Locale] }) {
  const disabled = !view.monitoringEnabled && atLimit; // can't enable a new one past the plan limit
  return (
    <form action={toggleMonitoringAction} className="flex items-center gap-2">
      <input type="hidden" name="accountId" value={view.id} />
      <input type="hidden" name="enable" value={String(!view.monitoringEnabled)} />
      <button type="submit" disabled={disabled} role="switch" aria-checked={view.monitoringEnabled}
        aria-label={view.monitoringEnabled ? c.on : c.off}
        title={disabled ? c.limitReached : view.monitoringEnabled ? c.on : c.off}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${view.monitoringEnabled ? "bg-[var(--color-ok)]" : "bg-[var(--color-border-strong)]"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${view.monitoringEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
      <span className="text-xs text-[var(--color-muted)]">{view.monitoringEnabled ? c.on : c.off}</span>
    </form>
  );
}

function Card({ view, parentName, atLimit, c }: { view: WatchedAccountView; parentName: string | null; atLimit: boolean; c: (typeof T)[Locale] }) {
  const p = PROBLEM[view.problem] ?? PROBLEM.none;
  const score = accountProtectionScore(view);
  const autoHideLabel = view.protection.autoHideEnabled && view.protection.autoHideMode === "automatic" ? "Automatic" : view.protection.autoHideMode === "manual_approval" ? "Manual approval" : "Recommend";
  return (
    <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={view.platform as never} />
          <div>
            <span className="block text-sm font-semibold">{view.externalName ?? "—"}</span>
            <span className="block text-xs text-[var(--color-muted)]">{PLATFORM_LABEL[view.platform] ?? view.platform}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[p!.tone]}`}>{p!.label}</span>
      </div>

      {view.platform === "instagram_business" && parentName ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">Facebook Page: {parentName}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <MonitoringSwitch view={view} atLimit={atLimit} c={c} />
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[SCORE_TONE(score.level)]}`}>{c.setupScore}: {score.score}/100</span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-[var(--color-muted)]">{c.comments30}</dt><dd className="font-medium tabular-nums">{view.commentsInWindow}</dd></div>
        <div><dt className="text-[var(--color-muted)]">{c.risk30}</dt><dd className="font-medium tabular-nums">{view.riskCommentsInWindow}</dd></div>
        <div><dt className="text-[var(--color-muted)]">{c.autoHide}</dt><dd className="font-medium">{autoHideLabel}</dd></div>
        <div className="col-span-3"><dt className="text-[var(--color-muted)]">{c.lastSync}</dt><dd className="font-medium">{fmt(view.lastSuccessfulSyncAt, c.unavailable)}</dd></div>
      </dl>

      <div className="mt-3 text-right">
        <a href={`/dashboard/accounts/${view.id}`} className="text-xs font-medium text-[var(--color-brand)] hover:underline">{c.open} →</a>
      </div>
    </li>
  );
}

export async function WatchedAccountsSection({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const c = T[locale];
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [view, usage] = await Promise.all([
    getWatchedAccountsView(tenantId, since),
    previewMonitoredAccountLimit(tenantId, 0),
  ]);
  const nameById = new Map(view.map((v) => [v.id, v.externalName]));
  const atLimit = usage.limit >= 0 && usage.remaining <= 0;

  return (
    <section aria-labelledby="watched-accounts-heading" className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="watched-accounts-heading" className="text-sm font-semibold">{c.heading}</h2>
          <p className="text-xs text-[var(--color-muted)]">{c.monitored(usage.used, usage.limit)}</p>
        </div>
        <a href="/dashboard/accounts/meta/select" className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{c.connect}</a>
      </div>
      {view.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center">
          <p className="text-sm text-[var(--color-muted)]">{c.empty}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {view.map((v) => <Card key={v.id} view={v} parentName={v.parentAccountId ? (nameById.get(v.parentAccountId) ?? null) : null} atLimit={atLimit} c={c} />)}
        </ul>
      )}
    </section>
  );
}
