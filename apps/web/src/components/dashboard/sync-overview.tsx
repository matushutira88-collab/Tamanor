import { withTenant } from "@guardora/db";
import { Card } from "./ui";
import type { Locale } from "@/i18n";

/**
 * V1.59 phase 2b — Automatic-synchronization overview. Production runs on VERCEL CRON, not a persistent
 * worker, so this shows the PRODUCT state of automatic sync derived ENTIRELY from real account data —
 * never a fabricated "worker running/offline" status, never an ENV name or stack trace. One batched query.
 */
const COPY = {
  en: { title: "Automatic synchronization", active: "Active", runs: "Runs every 5 minutes", lastSuccess: "Last successful synchronization", lastAttempt: "Last attempt", monitored: "Monitored accounts", never: "Never synchronized",
    none: "No monitored accounts. Connect a Facebook or Instagram account to start monitoring.", waiting: "Automatic synchronization is configured. Waiting for the first successful synchronization.",
    attention: "Some accounts require attention.", expired: "Meta connection expired. Reconnect the affected account." },
  sk: { title: "Automatická synchronizácia", active: "Aktívna", runs: "Beží každých 5 minút", lastSuccess: "Posledná úspešná synchronizácia", lastAttempt: "Posledný pokus", monitored: "Monitorované účty", never: "Nikdy nesynchronizované",
    none: "Žiadne monitorované účty. Pripojte Facebook alebo Instagram účet a spustite monitoring.", waiting: "Automatická synchronizácia je nakonfigurovaná. Čaká sa na prvú úspešnú synchronizáciu.",
    attention: "Niektoré účty vyžadujú pozornosť.", expired: "Pripojenie k Meta expirovalo. Znovu pripojte dotknutý účet." },
  de: { title: "Automatische Synchronisierung", active: "Aktiv", runs: "Läuft alle 5 Minuten", lastSuccess: "Letzte erfolgreiche Synchronisierung", lastAttempt: "Letzter Versuch", monitored: "Überwachte Konten", never: "Nie synchronisiert",
    none: "Keine überwachten Konten. Verbinden Sie ein Facebook- oder Instagram-Konto, um die Überwachung zu starten.", waiting: "Automatische Synchronisierung ist konfiguriert. Warten auf die erste erfolgreiche Synchronisierung.",
    attention: "Einige Konten erfordern Aufmerksamkeit.", expired: "Meta-Verbindung abgelaufen. Verbinden Sie das betroffene Konto erneut." },
} as const;

function fmt(d: Date | null): string { return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—"; }
function maxDate(a: Date | null, b: Date | null): Date | null { if (!a) return b; if (!b) return a; return a > b ? a : b; }

export async function SyncOverview({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const c = COPY[locale];
  const accounts = await withTenant(tenantId, (db) => db.connectedAccount.findMany({
    where: { tenantId, monitoringEnabled: true, status: { not: "disconnected" } },
    select: { health: true, connectionStatus: true, tokenHealth: true, lastSuccessfulSyncAt: true, lastSyncedAt: true },
  }));

  const monitored = accounts.length;
  let latestSuccessAt: Date | null = null, latestAttemptAt: Date | null = null, withError = 0, reconnect = 0;
  for (const a of accounts) {
    latestSuccessAt = maxDate(latestSuccessAt, a.lastSuccessfulSyncAt);
    latestAttemptAt = maxDate(latestAttemptAt, a.lastSyncedAt);
    if ((["error", "degraded"] as string[]).includes(a.health as unknown as string)) withError++;
    if (["needs_reconnect", "invalid_token", "missing_permission"].includes(a.connectionStatus) || ["expired", "invalid", "revoked"].includes(a.tokenHealth)) reconnect++;
  }

  const state: { tone: string; msg: string } =
    monitored === 0 ? { tone: "neutral", msg: c.none }
    : reconnect > 0 ? { tone: "danger", msg: c.expired }
    : withError > 0 ? { tone: "warn", msg: c.attention }
    : !latestSuccessAt ? { tone: "neutral", msg: c.waiting }
    : { tone: "ok", msg: "" };
  const tone: Record<string, string> = { ok: "text-[var(--color-ok)]", warn: "text-[var(--color-warn)]", danger: "text-[var(--color-danger)]", neutral: "text-[var(--color-muted)]" };

  return (
    <div className="mt-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{c.title}</h2>
            {state.tone === "ok" ? <span className="rounded-full border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ok)]">{c.active}</span> : null}
          </div>
          <span className="text-xs text-[var(--color-muted)]">{c.runs} · {c.monitored}: {monitored}</span>
        </div>
        {state.msg ? <p className={`mt-2 text-sm ${tone[state.tone]}`}>{state.msg}</p> : null}
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-[var(--color-muted)]">{c.lastSuccess}</dt><dd className="font-medium">{latestSuccessAt ? fmt(latestSuccessAt) : c.never}</dd></div>
          <div><dt className="text-[var(--color-muted)]">{c.lastAttempt}</dt><dd className="font-medium">{fmt(latestAttemptAt)}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
