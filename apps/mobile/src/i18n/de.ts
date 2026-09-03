/**
 * German strings. Wording follows the web product's `de` copy where an equivalent
 * exists, so the two surfaces read identically.
 */
import type { Dictionary } from "./en";

import { deInbox } from "./de-inbox";
import { deQueue } from "./de-queue";
import { deAccounts } from "./de-accounts";

export const de: Dictionary = {
  ...deInbox,
  ...deQueue,
  nav: {
    overview: "Übersicht",
    comments: "Kommentare",
    accounts: "Konten",
    alerts: "Warnungen",
    more: "Mehr",
    activity: "Aktivität",
    rules: "Schutzregeln",
    billing: "Abrechnung",
    settings: "Einstellungen",
    team: "Team",
  },
  common: {
    back: "Zurück",
    retry: "Erneut versuchen",
    refresh: "Aktualisieren",
    viewAll: "Alle anzeigen",
    signOut: "Abmelden",
    loading: "Wird geladen",
    comingSoon: "Demnächst",
    comingSoonBody: "Dieser Bereich kommt in einem späteren Update. Auf tamanor.com funktioniert bereits alles.",
    unlimited: "Unbegrenzt",
    of: "von",
  },
  dashboard: {
    eyebrow: "Übersicht",
    greeting: "Willkommen zurück",
    subtitle: "Das passiert heute mit Ihrer Markenreputation.",
    vsPrev: "vs. Vorperiode",
    timeframe: (days: number) => `${days}T`,
    timeframeA11y: (days: number) => `Die letzten ${days} Tage anzeigen`,
    realTestMode: "Echter Testmodus",
    realTestModeHint: "Es werden nur echte verbundene Daten angezeigt.",
  },
  kpi: {
    analyzed: "Analysierte Kommentare",
    risk: "Risiko-Kommentare",
    autoHandled: "Automatisch bearbeitet",
    pending: "Zur Prüfung",
    problem: "Konten mit Problem",
    pendingHint: "Wartet auf Entscheidung",
    problemHint: "Benötigen Aufmerksamkeit",
    noBaseline: "Noch kein Vergleich",
    up: "Anstieg",
    down: "Rückgang",
  },
  accounts: {
    // M6 Accounts vocabulary, merged into the existing dashboard block so the
    // whole surface stays under one `t.accounts.*` namespace.
    ...deAccounts.accounts,
    section: "Überwachte Konten",
    comments: "Kommentare",
    risky: "Risiko",
    autoHide: "Auto-Ausblenden",
    on: "An",
    off: "Aus",
    lastSync: "Synchronisiert",
    neverSync: "Noch nicht synchronisiert",
    showingOf: (shown: number, total: number) => `${shown} von ${total} angezeigt`,
    status: {
      active: "Aktiv",
      permissions_expired: "Berechtigungen abgelaufen",
      sync_failed: "Aufmerksamkeit nötig",
      monitoring_off: "Überwachung aus",
      demo: "Demo",
    },
  },
  protection: {
    section: "Schutzniveau",
    scoreOf: (score: number) => `${score} von 100`,
    strong: "Stark",
    partial: "Teilweise",
    weak: "Verbesserung nötig",
    state: { ok: "In Ordnung", partial: "Teilweise", off: "Aus" },
    checks: {
      metaPermissionsHealthy: "Plattform-Berechtigungen",
      syncHealthy: "Synchronisierung",
      rulesActive: "Schutzregeln",
      dangerousLinksHandled: "Gefährliche Links",
      fraudProtection: "Betrugsschutz",
      reviewWorkflow: "Prüfprozess",
      actionConfigured: "Aktion konfiguriert",
    },
  },
  trend: {
    section: "Risiko-Kommentare",
    description: "Verlauf im gewählten Zeitraum.",
    empty: "Keine Risiko-Kommentare in diesem Zeitraum.",
    summary: (total: number, days: number) => `${total} Risiko-Kommentare in den letzten ${days} Tagen.`,
    peak: (count: number, day: string) => `Höchster Tag: ${count} am ${day}.`,
  },
  activity: {
    section: "Letzte Aktivität",
    empty: "Noch keine Aktivität.",
    types: {
      "sync.completed": "Synchronisierung abgeschlossen",
      "sync.failed": "Synchronisierung fehlgeschlagen",
      "auto_protect.would_auto_hide": "Kommentar zum Ausblenden markiert",
      "protection.action_executed": "Kommentar ausgeblendet",
      "incident.created": "Vorfall erstellt",
      "proposal.created": "Aktion vorgeschlagen",
      "account.connected": "Konto verbunden",
      "token.expired": "Berechtigungen abgelaufen",
    },
  },
  empty: {
    title: "Schützen wir Ihr erstes Konto",
    body: "Verbinden Sie ein soziales Konto und Tamanor überwacht Kommentare sofort auf Risiken.",
    hint: "Konten verbinden Sie auf tamanor.com — der mobile Ablauf folgt bald.",
    cta: "Konto verbinden",
  },
  access: {
    restricted:
      "Ihre Testphase oder Ihr Abo ist beendet — Sie sind im eingeschränkten Nur-Lese-Modus. Wählen Sie einen Tarif für vollen Zugriff.",
    past_due: "Ihre letzte Zahlung ist fehlgeschlagen. Aktualisieren Sie Ihre Zahlungsmethode.",
    trial_ending: (days: number) => `Testphase — noch ${days} Tage.`,
    cta: "Zur Abrechnung",
  },
  errors: {
    title: "Dashboard konnte nicht geladen werden",
    network: "Keine Verbindung. Prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",
    timeout: "Tamanor hat zu lange gebraucht. Bitte erneut versuchen.",
    server: "Auf unserer Seite ist etwas schiefgelaufen. Bitte erneut versuchen.",
    forbidden: "Sie haben mobil keinen Zugriff auf diesen Workspace.",
    config: "Dieser Build ist nicht für die Verbindung zu Tamanor konfiguriert.",
  },
  usage: {
    processedItems: "Verarbeitete Kommentare",
    accounts: "Verbundene Konten",
  },
};
