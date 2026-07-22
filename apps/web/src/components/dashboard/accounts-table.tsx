import Link from "next/link";
import { getDashboardAccountsOverview, type DashboardAccountRow } from "@guardora/db";
import {
  CONNECTION_STATE_PRESENTATION, AUTO_SYNC_STATE_PRESENTATION,
  type ConnectionState, type AutoSyncState,
} from "@guardora/core";
import { PlatformIcon } from "./platform-icon";
import { MonitoringSwitch } from "./monitoring-switch";
import { AccountsSelectionProvider, AccountSelectCheckbox, AccountSelectAllCheckbox, AccountsBulkBar } from "./accounts-bulk";
import { runSyncAction, disconnect } from "@/app/dashboard/accounts/actions";
import type { Locale } from "@/i18n";

/**
 * V1.59 2b / V1.75 (P0) — the /dashboard/accounts PRODUCT table. Connection HEALTH, MONITORING and
 * auto-sync are SEPARATE, truthful columns, all derived from the ONE server-authoritative resolver
 * (getDashboardAccountsOverview → resolveConnectionState / resolveAutoSyncState). The green "Connected"
 * badge appears ONLY for CONNECTED_HEALTHY; an expired/failing/disconnected account is never green.
 * "Last successful sync" and "Last attempt" are shown separately. Row CTAs are correct per state
 * (Reconnect replaces Sync when reauth is required). Bulk select + Disconnect/Disable-monitoring bar.
 */
const T = {
  en: { platform: "Platform", account: "Account", monitoring: "Monitoring", connection: "Connection status", commentsToday: "Comments today", riskToday: "Risk today", lastSync: "Last successful sync", lastAttempt: "Last attempt",
    actions: "Actions", never: "Never synchronized", kindTest: "Test connection", kindReadOnly: "Read-only", syncWaiting: "Waiting for first synchronization", syncNotActive: "Automatic sync not active", syncFailed: "Last sync failed", on: "Monitoring active", off: "Monitoring inactive", limitReached: "You have reached the monitored account limit.",
    view: "View comments", sync: "Sync now", reconnect: "Reconnect", disconnect: "Disconnect", unavailable: "Unavailable via current permissions",
    facebook: "Facebook", instagram: "Instagram", emptyTitle: "No connected accounts", emptyBody: "Connect Facebook Pages or Instagram Business accounts to start monitoring.", connect: "Connect Meta accounts",
    connState: { CONNECTED_HEALTHY: "Connected", WAITING_FIRST_SYNC: "Waiting for first sync", DEGRADED: "Degraded", REAUTH_REQUIRED: "Reconnect required", SYNC_FAILED: "Sync failed", DISCONNECTED: "Disconnected" },
    autoSync: { ENABLED_HEALTHY: "Auto-sync running", ENABLED_DEGRADED: "Auto-sync on · degraded", ENABLED_REAUTH_REQUIRED: "Auto-sync on · reconnect needed", DISABLED: "Auto-sync off", NOT_CONFIGURED: "Auto-sync not configured" } },
  sk: { platform: "Platforma", account: "Účet", monitoring: "Monitorovanie", connection: "Stav pripojenia", commentsToday: "Komentáre dnes", riskToday: "Rizikové dnes", lastSync: "Posledná úspešná synchronizácia", lastAttempt: "Posledný pokus",
    actions: "Akcie", never: "Nikdy nesynchronizované", kindTest: "Testovacie pripojenie", kindReadOnly: "Iba na čítanie", syncWaiting: "Čaká na prvú synchronizáciu", syncNotActive: "Automatická synchronizácia nie je aktívna", syncFailed: "Posledná synchronizácia zlyhala", on: "Monitorovanie aktívne", off: "Monitorovanie neaktívne", limitReached: "Dosiahli ste limit monitorovaných účtov.",
    view: "Zobraziť komentáre", sync: "Synchronizovať", reconnect: "Znovu pripojiť", disconnect: "Odpojiť", unavailable: "Nedostupné cez aktuálne oprávnenia",
    facebook: "Facebook", instagram: "Instagram", emptyTitle: "Žiadne pripojené účty", emptyBody: "Pripojte Facebook Pages alebo Instagram Business účty a spustite monitoring.", connect: "Pripojiť Meta účty",
    connState: { CONNECTED_HEALTHY: "Pripojené", WAITING_FIRST_SYNC: "Čaká na prvú synchronizáciu", DEGRADED: "Zhoršené", REAUTH_REQUIRED: "Vyžaduje opätovné pripojenie", SYNC_FAILED: "Synchronizácia zlyhala", DISCONNECTED: "Odpojené" },
    autoSync: { ENABLED_HEALTHY: "Automatická synchronizácia beží", ENABLED_DEGRADED: "Auto-sync zapnutý · zhoršené", ENABLED_REAUTH_REQUIRED: "Auto-sync zapnutý · vyžaduje pripojenie", DISABLED: "Automatická synchronizácia vypnutá", NOT_CONFIGURED: "Automatická synchronizácia nie je nastavená" } },
  de: { platform: "Plattform", account: "Konto", monitoring: "Überwachung", connection: "Verbindungsstatus", commentsToday: "Kommentare heute", riskToday: "Risiko heute", lastSync: "Letzte erfolgreiche Synchronisierung", lastAttempt: "Letzter Versuch",
    actions: "Aktionen", never: "Nie synchronisiert", kindTest: "Testverbindung", kindReadOnly: "Nur-Lesen", syncWaiting: "Warten auf erste Synchronisierung", syncNotActive: "Automatische Synchronisierung nicht aktiv", syncFailed: "Letzte Synchronisierung fehlgeschlagen", on: "Überwachung aktiv", off: "Überwachung inaktiv", limitReached: "Sie haben das Limit überwachter Konten erreicht.",
    view: "Kommentare ansehen", sync: "Synchronisieren", reconnect: "Neu verbinden", disconnect: "Trennen", unavailable: "Über aktuelle Berechtigungen nicht verfügbar",
    facebook: "Facebook", instagram: "Instagram", emptyTitle: "Keine verbundenen Konten", emptyBody: "Verbinden Sie Facebook-Seiten oder Instagram-Business-Konten, um die Überwachung zu starten.", connect: "Meta-Konten verbinden",
    connState: { CONNECTED_HEALTHY: "Verbunden", WAITING_FIRST_SYNC: "Warten auf erste Synchronisierung", DEGRADED: "Beeinträchtigt", REAUTH_REQUIRED: "Neu verbinden erforderlich", SYNC_FAILED: "Synchronisierung fehlgeschlagen", DISCONNECTED: "Getrennt" },
    autoSync: { ENABLED_HEALTHY: "Auto-Sync läuft", ENABLED_DEGRADED: "Auto-Sync an · beeinträchtigt", ENABLED_REAUTH_REQUIRED: "Auto-Sync an · neu verbinden", DISABLED: "Auto-Sync aus", NOT_CONFIGURED: "Auto-Sync nicht konfiguriert" } },
} as const;

const TONE: Record<string, string> = {
  ok: "border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)]",
  warn: "border-[var(--color-warn)] text-[var(--color-warn)] bg-[var(--color-warn-soft)]",
  danger: "border-[var(--color-danger)] text-[var(--color-danger)] bg-[var(--color-danger-soft)]",
  neutral: "border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface-2)]",
};
/** Map the canonical presentation tone (ok|warn|danger|muted) to this table's tone keys. */
const toneKey = (t: string) => (t === "muted" ? "neutral" : t);
function fmt(d: Date | null, never: string): string { return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : never; }
const initials = (n: string | null) => (n ?? "?").replace(/^@/, "").slice(0, 2).toUpperCase();

/** Truthful "Last successful sync" text — a test account isn't syncing; a real account that never synced
 *  is waiting (not failed); a failed attempt says so; otherwise the last SUCCESS timestamp. */
function lastSyncText(row: DashboardAccountRow, c: (typeof T)[Locale]): string {
  switch (row.syncState) {
    case "not_active": return c.syncNotActive;
    case "waiting_first_sync": return c.syncWaiting;
    case "failed": return c.syncFailed;
    default: return fmt(row.lastSuccessAt, c.never);
  }
}
function KindChip({ row, c }: { row: DashboardAccountRow; c: (typeof T)[Locale] }) {
  if (row.accountKind === "real") return null;
  const label = row.accountKind === "test" ? c.kindTest : c.kindReadOnly;
  return <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted)]">{label}</span>;
}

function Switch({ row, c }: { row: DashboardAccountRow; c: (typeof T)[Locale] }) {
  return (
    <MonitoringSwitch
      accountId={row.id}
      enabled={row.monitoringEnabled}
      disabled={!row.monitoringEnabled && !row.monitoringCanBeEnabled}
      on={c.on} off={c.off} limit={c.limitReached}
    />
  );
}

function PlatformBadge({ platform, c }: { platform: string; c: (typeof T)[Locale] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <PlatformIcon platform={platform as never} size={18} />
      <span>{platform === "instagram_business" ? c.instagram : c.facebook}</span>
    </span>
  );
}
function AccountCell({ row }: { row: DashboardAccountRow }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[11px] font-semibold text-[var(--color-muted)]">{initials(row.name)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{row.name ?? "—"}</span>
        {row.username ? <span className="block truncate text-xs text-[var(--color-muted)]">{row.username}</span> : null}
      </span>
    </span>
  );
}
/** Connection badge — GREEN only for CONNECTED_HEALTHY; tone + label come from the ONE resolver. */
function ConnBadge({ row, c }: { row: DashboardAccountRow; c: (typeof T)[Locale] }) {
  const state = row.connectionState as ConnectionState;
  const tone = toneKey(CONNECTION_STATE_PRESENTATION[state].tone);
  const auto = row.autoSyncState as AutoSyncState;
  const autoTone = toneKey(AUTO_SYNC_STATE_PRESENTATION[auto].tone);
  return (
    <span className="flex flex-col items-start gap-1" data-testid="conn-state" data-state={state}>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{c.connState[state]}</span>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE[autoTone]}`} data-testid="auto-sync-state" data-auto={auto}>{c.autoSync[auto]}</span>
    </span>
  );
}
function LastSyncCell({ row, c }: { row: DashboardAccountRow; c: (typeof T)[Locale] }) {
  return (
    <span className="block">
      <span className="block">{lastSyncText(row, c)}</span>
      {row.lastAttemptAt ? <span className="block text-[10px] text-[var(--color-muted)]" data-testid="last-attempt">{c.lastAttempt}: {fmt(row.lastAttemptAt, c.never)}</span> : null}
    </span>
  );
}
function Actions({ row, c }: { row: DashboardAccountRow; c: (typeof T)[Locale] }) {
  // A reconnect-required (or disconnected) account BLOCKS manual sync — the truthful action is Reconnect.
  const reauth = row.connectionState === "REAUTH_REQUIRED" || row.connectionState === "DISCONNECTED";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link href={`/dashboard/comments?account=${row.id}`} className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium hover:border-[var(--color-brand)]">{c.view}</Link>
      {reauth
        ? <a href="/api/connectors/meta/start" data-testid="cta-reconnect" className="rounded-lg border border-[var(--color-danger)] px-2 py-1 text-[11px] font-medium text-[var(--color-danger)]">{c.reconnect}</a>
        : <form action={runSyncAction.bind(null, row.id)}><button type="submit" data-testid="cta-sync" className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium hover:border-[var(--color-brand)]">{c.sync}</button></form>}
      <form action={disconnect.bind(null, row.id)}><button type="submit" data-testid="cta-disconnect" className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">{c.disconnect}</button></form>
    </div>
  );
}

export async function AccountsTable({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const c = T[locale];
  const { rows, capacity } = await getDashboardAccountsOverview(tenantId);
  const monitored = rows.filter((r) => r.monitoringEnabled).length;
  const usageLabel = capacity.limit < 0 ? `${monitored} ${c.monitoring.toLowerCase()}` : `${capacity.used} / ${capacity.limit}`;
  const allIds = rows.map((r) => r.id);

  const header = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--color-muted)]">{c.monitoring}: {usageLabel}</p>
      <a href="/dashboard/accounts/meta/select" className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{c.connect}</a>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-8 text-center">
        <p className="text-sm font-medium">{c.emptyTitle}</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{c.emptyBody}</p>
        <a href="/dashboard/accounts/meta/select" className="mt-4 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{c.connect}</a>
      </div>
    );
  }

  return (
    <AccountsSelectionProvider>
      {header}
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border)] md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2"><AccountSelectAllCheckbox ids={allIds} locale={locale} /></th>
              <th scope="col" className="px-3 py-2 font-medium">{c.platform}</th>
              <th scope="col" className="px-3 py-2 font-medium">{c.account}</th>
              <th scope="col" className="px-3 py-2 font-medium">{c.monitoring}</th>
              <th scope="col" className="px-3 py-2 font-medium">{c.connection}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{c.commentsToday}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{c.riskToday}</th>
              <th scope="col" className="px-3 py-2 font-medium">{c.lastSync}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{c.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2.5"><AccountSelectCheckbox id={row.id} locale={locale} /></td>
                <td className="px-3 py-2.5"><PlatformBadge platform={row.platform} c={c} /></td>
                <td className="px-3 py-2.5"><span className="flex flex-wrap items-center gap-1.5"><AccountCell row={row} /><KindChip row={row} c={c} /></span></td>
                <td className="px-3 py-2.5"><Switch row={row} c={c} /></td>
                <td className="px-3 py-2.5"><ConnBadge row={row} c={c} /></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.commentsToday}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.riskToday}</td>
                <td className="px-3 py-2.5 text-xs"><LastSyncCell row={row} c={c} /></td>
                <td className="px-3 py-2.5"><Actions row={row} c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards (same dataset) */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-2"><AccountSelectCheckbox id={row.id} locale={locale} /><AccountCell row={row} /></span>
              <Switch row={row} c={c} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <PlatformBadge platform={row.platform} c={c} />
              <ConnBadge row={row} c={c} />
              <KindChip row={row} c={c} />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-[var(--color-muted)]">{c.commentsToday}</dt><dd className="font-medium tabular-nums">{row.commentsToday}</dd></div>
              <div><dt className="text-[var(--color-muted)]">{c.riskToday}</dt><dd className="font-medium tabular-nums">{row.riskToday}</dd></div>
              <div><dt className="text-[var(--color-muted)]">{c.lastSync}</dt><dd className="font-medium"><LastSyncCell row={row} c={c} /></dd></div>
            </dl>
            <div className="mt-3"><Actions row={row} c={c} /></div>
          </li>
        ))}
      </ul>

      <AccountsBulkBar locale={locale} />
    </AccountsSelectionProvider>
  );
}
