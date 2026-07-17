import Link from "next/link";
import { getRiskByCategory, withTenant } from "@guardora/db";
import { Card, SectionHeader } from "./ui";
import type { Locale } from "@/i18n";

/**
 * V1.59 phase 2b — Risk distribution (by category) + Recent activity, both from REAL data:
 *   • getRiskByCategory (tested V1.59 aggregation) — clickable segments → the filtered comments list.
 *   • the tenant's own audit log — no new backend, no fabricated events.
 * Batched (Promise.all). Tenant-scoped (RLS). Empty states are honest ("No incidents detected").
 */
const COPY = {
  en: { riskTitle: "Risk distribution", riskDesc: "Risk comments by category in the last 30 days.", noRisk: "No incidents detected.", activityTitle: "Recent activity", noActivity: "No recent activity yet." },
  sk: { riskTitle: "Rozloženie rizika", riskDesc: "Rizikové komentáre podľa kategórie za posledných 30 dní.", noRisk: "Nezistené žiadne incidenty.", activityTitle: "Aktuálna aktivita", noActivity: "Zatiaľ žiadna aktivita." },
  de: { riskTitle: "Risikoverteilung", riskDesc: "Risiko-Kommentare nach Kategorie in den letzten 30 Tagen.", noRisk: "Keine Vorfälle erkannt.", activityTitle: "Letzte Aktivität", noActivity: "Noch keine Aktivität." },
} as const;

const SEVERITY: Record<string, "danger" | "warn" | "neutral"> = {
  hate_speech: "danger", racism: "danger", harassment: "danger", scam: "danger", phishing: "danger",
  fraud: "danger", threat: "danger", violence: "danger", legal_threat: "danger", coordinated_attack: "danger", brand_impersonation: "danger",
  spam: "warn", personal_attack: "warn", misinformation: "warn", competitor_promo: "warn", profanity: "warn",
};
const BAR: Record<string, string> = { danger: "var(--color-danger)", warn: "var(--color-warn)", neutral: "var(--color-muted)" };
const humanize = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const EVENT_LABEL: Record<Locale, Record<string, string>> = {
  en: { "sync.completed": "Synchronization completed", "sync.partial": "Synchronization partially completed", "sync.failed": "Synchronization failed",
    "auto_protect.would_auto_hide": "Comment flagged for auto-hide", "protection.action_executed": "Comment hidden", "incident.created": "Incident created",
    "proposal.created": "Action proposed", "account.monitoring_enabled": "Monitoring enabled", "account.monitoring_disabled": "Monitoring disabled",
    "account.connected": "Account connected", "account.disconnected": "Account disconnected", "token.expired": "Permissions expired", "token.reconnect_recommended": "Reconnect recommended" },
  sk: { "sync.completed": "Synchronizácia dokončená", "sync.partial": "Synchronizácia čiastočne dokončená", "sync.failed": "Synchronizácia zlyhala",
    "auto_protect.would_auto_hide": "Komentár označený na skrytie", "protection.action_executed": "Komentár skrytý", "incident.created": "Vytvorený incident",
    "proposal.created": "Navrhnutá akcia", "account.monitoring_enabled": "Monitorovanie zapnuté", "account.monitoring_disabled": "Monitorovanie vypnuté",
    "account.connected": "Účet pripojený", "account.disconnected": "Účet odpojený", "token.expired": "Oprávnenia expirovali", "token.reconnect_recommended": "Odporúčané opätovné pripojenie" },
  de: { "sync.completed": "Synchronisierung abgeschlossen", "sync.partial": "Synchronisierung teilweise abgeschlossen", "sync.failed": "Synchronisierung fehlgeschlagen",
    "auto_protect.would_auto_hide": "Kommentar zum Ausblenden markiert", "protection.action_executed": "Kommentar ausgeblendet", "incident.created": "Vorfall erstellt",
    "proposal.created": "Aktion vorgeschlagen", "account.monitoring_enabled": "Überwachung aktiviert", "account.monitoring_disabled": "Überwachung deaktiviert",
    "account.connected": "Konto verbunden", "account.disconnected": "Konto getrennt", "token.expired": "Berechtigungen abgelaufen", "token.reconnect_recommended": "Erneute Verbindung empfohlen" },
};
/** Only the user-meaningful activity events (skip low-level noise like sync.started). */
const ACTIVITY_EVENTS = Object.keys(EVENT_LABEL.en);

function fmt(d: Date): string { return d.toISOString().replace("T", " ").slice(0, 16) + " UTC"; }

export async function RiskActivitySection({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const c = COPY[locale];
  const [risk, activity] = await Promise.all([
    getRiskByCategory(tenantId, since),
    withTenant(tenantId, (db) => db.auditLog.findMany({
      where: { tenantId, event: { in: ACTIVITY_EVENTS } },
      orderBy: { createdAt: "desc" }, take: 12, select: { id: true, event: true, createdAt: true },
    })),
  ]);
  const total = risk.reduce((s, r) => s + r.count, 0);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <SectionHeader title={c.riskTitle} description={c.riskDesc} />
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">{c.noRisk}</p>
        ) : (
          <ul className="space-y-2.5">
            {risk.map((r) => {
              const sev = SEVERITY[r.category] ?? "neutral";
              const pct = Math.round((r.count / total) * 100);
              return (
                <li key={r.category}>
                  <Link href={`/dashboard/comments?risk=${encodeURIComponent(r.category)}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm transition hover:bg-[var(--color-surface-2)]">
                    <span className="w-32 shrink-0 truncate">{humanize(r.category)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: BAR[sev] }} /></span>
                    <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">{r.count}</span>
                    <span className="w-9 shrink-0 text-right text-xs text-[var(--color-muted)] tabular-nums">{pct}%</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader title={c.activityTitle} />
        {activity.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted)]">{c.noActivity}</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{EVENT_LABEL[locale][a.event] ?? humanize(a.event)}</span>
                  <span className="text-xs text-[var(--color-muted)]">{fmt(a.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
