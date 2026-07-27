/**
 * Child Safety Analytics V1 — localized copy (en/sk/de). Every user-facing string in the analytics
 * dashboard comes from here; all three locales share an IDENTICAL key structure (asserted by the UI test).
 * Content-free labels only — never an incident/child/guardian identifier.
 */
import type { Locale } from "@/i18n/config";

/** Safe, serializable error codes the analytics endpoints may return. Never a raw message/stack/id. */
export const ANALYTICS_ERROR_CODES = ["forbidden", "unauthenticated", "internal", "retry_later"] as const;

export interface AnalyticsCopy {
  title: string; subtitle: string;
  unauthorized: { badge: string; title: string; body: string; cta: string };
  loading: string; errorTitle: string; errorBody: string; retry: string;
  backToConsole: string;
  export: string; exportHint: string;
  suppressionNote: string; someHidden: string; none: string; empty: string;
  range: { label: string; from: string; to: string; apply: string; granularity: string };
  granularity: { day: string; week: string; month: string };
  sections: { overview: string; trends: string; distributions: string; performance: string; protectionPlans: string; guardianDelivery: string; reviewerWorkload: string };
  overview: {
    incidentsCreated: string; incidentsResolved: string; openIncidents: string; escalations: string; activeEscalations: string;
    activeProtectionPlans: string; completedProtectionPlans: string; overdueActions: string; blockedActions: string;
    evidenceCount: string; interventionCount: string;
  };
  series: { incidents: string; resolutions: string; escalations: string; interventions: string; protectionPlans: string };
  dimension: { severity: string; urgency: string; risk_family: string; status: string; escalation_status: string; plan_status: string; action_status: string; delivery_outcome: string };
  performance: { incidentToFirstReview: string; incidentToResolved: string; planActivationToCompletion: string; median: string; observations: string };
  workload: { title: string; reviewer: string; assigned: string; resolved: string; activeActions: string; overdueActions: string; medianFirstReview: string; medianResolution: string; note: string; empty: string };
  severityLabel: Record<string, string>;
  urgencyLabel: Record<string, string>;
  riskFamilyLabel: Record<string, string>;
  statusLabel: Record<string, string>;
  escalationStatusLabel: Record<string, string>;
  planStatusLabel: Record<string, string>;
  actionStatusLabel: Record<string, string>;
  deliveryOutcomeLabel: Record<string, string>;
}

const sev = {
  en: { critical: "Critical", high: "High", medium: "Medium", low: "Low" },
  sk: { critical: "Kritická", high: "Vysoká", medium: "Stredná", low: "Nízka" },
  de: { critical: "Kritisch", high: "Hoch", medium: "Mittel", low: "Niedrig" },
};
const urg = {
  en: { immediate: "Immediate", elevated: "Elevated", routine: "Routine" },
  sk: { immediate: "Okamžitá", elevated: "Zvýšená", routine: "Bežná" },
  de: { immediate: "Sofort", elevated: "Erhöht", routine: "Routine" },
};
const rf = {
  en: { sexual: "Sexual", grooming: "Grooming", violence: "Violence", coercion: "Coercion", scam: "Scam", bullying: "Bullying", identity: "Identity" },
  sk: { sexual: "Sexuálne", grooming: "Manipulácia", violence: "Násilie", coercion: "Nátlak", scam: "Podvod", bullying: "Šikana", identity: "Identita" },
  de: { sexual: "Sexuell", grooming: "Anbahnung", violence: "Gewalt", coercion: "Nötigung", scam: "Betrug", bullying: "Mobbing", identity: "Identität" },
};
const st = {
  en: { open: "Open", under_review: "Under review", action_required: "Action required", monitoring: "Monitoring", waiting: "Waiting", resolved: "Resolved", dismissed: "Dismissed", reopened: "Reopened", closed: "Closed" },
  sk: { open: "Otvorené", under_review: "V posudzovaní", action_required: "Vyžaduje akciu", monitoring: "Monitorovanie", waiting: "Čaká sa", resolved: "Vyriešené", dismissed: "Zamietnuté", reopened: "Znovu otvorené", closed: "Uzavreté" },
  de: { open: "Offen", under_review: "In Prüfung", action_required: "Aktion erforderlich", monitoring: "Überwachung", waiting: "Wartet", resolved: "Gelöst", dismissed: "Abgewiesen", reopened: "Wieder geöffnet", closed: "Geschlossen" },
};
const esc = {
  en: { triggered: "Triggered", acknowledged: "Acknowledged", resolved: "Resolved" },
  sk: { triggered: "Spustené", acknowledged: "Potvrdené", resolved: "Vyriešené" },
  de: { triggered: "Ausgelöst", acknowledged: "Bestätigt", resolved: "Gelöst" },
};
const plan = {
  en: { draft: "Draft", active: "Active", completed: "Completed", cancelled: "Cancelled", reopened: "Reopened" },
  sk: { draft: "Koncept", active: "Aktívny", completed: "Dokončený", cancelled: "Zrušený", reopened: "Znovu otvorený" },
  de: { draft: "Entwurf", active: "Aktiv", completed: "Abgeschlossen", cancelled: "Abgebrochen", reopened: "Wieder geöffnet" },
};
const act = {
  en: { pending: "Pending", in_progress: "In progress", blocked: "Blocked", completed: "Completed", skipped: "Skipped", reopened: "Reopened" },
  sk: { pending: "Čaká", in_progress: "Prebieha", blocked: "Blokované", completed: "Dokončené", skipped: "Preskočené", reopened: "Znovu otvorené" },
  de: { pending: "Ausstehend", in_progress: "In Bearbeitung", blocked: "Blockiert", completed: "Abgeschlossen", skipped: "Übersprungen", reopened: "Wieder geöffnet" },
};
const dlv = {
  en: { prepared: "Prepared", available: "Available", acknowledged: "Acknowledged", declined: "Declined", failed: "Failed", revoked: "Revoked", expired: "Expired", superseded: "Superseded", archived: "Archived" },
  sk: { prepared: "Pripravené", available: "Dostupné", acknowledged: "Potvrdené", declined: "Odmietnuté", failed: "Zlyhalo", revoked: "Odvolané", expired: "Vypršané", superseded: "Nahradené", archived: "Archivované" },
  de: { prepared: "Vorbereitet", available: "Verfügbar", acknowledged: "Bestätigt", declined: "Abgelehnt", failed: "Fehlgeschlagen", revoked: "Widerrufen", expired: "Abgelaufen", superseded: "Ersetzt", archived: "Archiviert" },
};

export const ANALYTICS_COPY: Record<Locale, AnalyticsCopy> = {
  en: {
    title: "Child Safety Analytics", subtitle: "Internal operational trends across canonical child-safety incidents. Aggregated and privacy-protected.",
    unauthorized: { badge: "403 · Access denied", title: "Analytics access required", body: "This dashboard is limited to workspace owners, administrators, and safety reviewers.", cta: "Back to console" },
    loading: "Loading…", errorTitle: "Something went wrong", errorBody: "The analytics dashboard couldn't load. Please try again.", retry: "Try again",
    backToConsole: "Reviewer console",
    export: "Export CSV", exportHint: "Aggregated metrics only — no identifiers.",
    suppressionNote: "Small cohorts (fewer than 5) are hidden to protect individuals.", someHidden: "Some values hidden for privacy", none: "None", empty: "No data in this range.",
    range: { label: "Range", from: "From", to: "To", apply: "Apply", granularity: "Interval" },
    granularity: { day: "Daily", week: "Weekly", month: "Monthly" },
    sections: { overview: "Overview", trends: "Trends", distributions: "Distributions", performance: "Response performance", protectionPlans: "Protection plans", guardianDelivery: "Guardian delivery", reviewerWorkload: "Reviewer workload" },
    overview: { incidentsCreated: "Incidents created", incidentsResolved: "Incidents resolved", openIncidents: "Open incidents", escalations: "Escalations", activeEscalations: "Active escalations", activeProtectionPlans: "Active plans", completedProtectionPlans: "Completed plans", overdueActions: "Overdue actions", blockedActions: "Blocked actions", evidenceCount: "Evidence items", interventionCount: "Interventions" },
    series: { incidents: "Incidents", resolutions: "Resolutions", escalations: "Escalations", interventions: "Interventions", protectionPlans: "Protection plans" },
    dimension: { severity: "Severity", urgency: "Urgency", risk_family: "Risk family", status: "Incident status", escalation_status: "Escalation status", plan_status: "Plan status", action_status: "Action status", delivery_outcome: "Guardian delivery outcome" },
    performance: { incidentToFirstReview: "Incident → first review", incidentToResolved: "Incident → resolved", planActivationToCompletion: "Plan activation → completion", median: "Median", observations: "Observations" },
    workload: { title: "Reviewer workload", reviewer: "Reviewer", assigned: "Assigned", resolved: "Resolved", activeActions: "Active actions", overdueActions: "Overdue actions", medianFirstReview: "Median first review", medianResolution: "Median resolution", note: "Operational workload only — reviewers are never ranked or scored.", empty: "No assigned reviewers in this range." },
    severityLabel: sev.en, urgencyLabel: urg.en, riskFamilyLabel: rf.en, statusLabel: st.en, escalationStatusLabel: esc.en, planStatusLabel: plan.en, actionStatusLabel: act.en, deliveryOutcomeLabel: dlv.en,
  },
  sk: {
    title: "Analytika ochrany detí", subtitle: "Interné operačné trendy naprieč kanonickými incidentmi ochrany detí. Agregované a chrániace súkromie.",
    unauthorized: { badge: "403 · Prístup zamietnutý", title: "Vyžaduje sa prístup k analytike", body: "Tento panel je len pre vlastníkov, administrátorov a bezpečnostných recenzentov.", cta: "Späť do konzoly" },
    loading: "Načítava sa…", errorTitle: "Niečo sa pokazilo", errorBody: "Panel analytiky sa nepodarilo načítať. Skúste to znova.", retry: "Skúsiť znova",
    backToConsole: "Konzola recenzenta",
    export: "Exportovať CSV", exportHint: "Iba agregované metriky — žiadne identifikátory.",
    suppressionNote: "Malé kohorty (menej ako 5) sú skryté na ochranu jednotlivcov.", someHidden: "Niektoré hodnoty sú skryté kvôli súkromiu", none: "Žiadne", empty: "V tomto rozsahu nie sú žiadne dáta.",
    range: { label: "Rozsah", from: "Od", to: "Do", apply: "Použiť", granularity: "Interval" },
    granularity: { day: "Denne", week: "Týždenne", month: "Mesačne" },
    sections: { overview: "Prehľad", trends: "Trendy", distributions: "Rozdelenia", performance: "Výkon reakcie", protectionPlans: "Ochranné plány", guardianDelivery: "Doručenie opatrovníkovi", reviewerWorkload: "Vyťaženie recenzentov" },
    overview: { incidentsCreated: "Vytvorené incidenty", incidentsResolved: "Vyriešené incidenty", openIncidents: "Otvorené incidenty", escalations: "Eskalácie", activeEscalations: "Aktívne eskalácie", activeProtectionPlans: "Aktívne plány", completedProtectionPlans: "Dokončené plány", overdueActions: "Akcie po termíne", blockedActions: "Blokované akcie", evidenceCount: "Položky dôkazov", interventionCount: "Intervencie" },
    series: { incidents: "Incidenty", resolutions: "Vyriešenia", escalations: "Eskalácie", interventions: "Intervencie", protectionPlans: "Ochranné plány" },
    dimension: { severity: "Závažnosť", urgency: "Naliehavosť", risk_family: "Rodina rizika", status: "Stav incidentu", escalation_status: "Stav eskalácie", plan_status: "Stav plánu", action_status: "Stav akcie", delivery_outcome: "Výsledok doručenia opatrovníkovi" },
    performance: { incidentToFirstReview: "Incident → prvé posúdenie", incidentToResolved: "Incident → vyriešené", planActivationToCompletion: "Aktivácia plánu → dokončenie", median: "Medián", observations: "Pozorovania" },
    workload: { title: "Vyťaženie recenzentov", reviewer: "Recenzent", assigned: "Priradené", resolved: "Vyriešené", activeActions: "Aktívne akcie", overdueActions: "Akcie po termíne", medianFirstReview: "Medián prvého posúdenia", medianResolution: "Medián vyriešenia", note: "Iba operačné vyťaženie — recenzenti sa nikdy nehodnotia ani neradia.", empty: "V tomto rozsahu nie sú priradení recenzenti." },
    severityLabel: sev.sk, urgencyLabel: urg.sk, riskFamilyLabel: rf.sk, statusLabel: st.sk, escalationStatusLabel: esc.sk, planStatusLabel: plan.sk, actionStatusLabel: act.sk, deliveryOutcomeLabel: dlv.sk,
  },
  de: {
    title: "Kinderschutz-Analysen", subtitle: "Interne operative Trends über kanonische Kinderschutz-Vorfälle. Aggregiert und datenschutzgeschützt.",
    unauthorized: { badge: "403 · Zugriff verweigert", title: "Analysezugriff erforderlich", body: "Dieses Dashboard ist auf Workspace-Eigentümer, Administratoren und Sicherheitsprüfer beschränkt.", cta: "Zurück zur Konsole" },
    loading: "Wird geladen…", errorTitle: "Etwas ist schiefgelaufen", errorBody: "Das Analyse-Dashboard konnte nicht geladen werden. Bitte erneut versuchen.", retry: "Erneut versuchen",
    backToConsole: "Prüferkonsole",
    export: "CSV exportieren", exportHint: "Nur aggregierte Kennzahlen — keine Identifikatoren.",
    suppressionNote: "Kleine Kohorten (weniger als 5) werden zum Schutz von Personen ausgeblendet.", someHidden: "Einige Werte aus Datenschutzgründen ausgeblendet", none: "Keine", empty: "Keine Daten in diesem Zeitraum.",
    range: { label: "Zeitraum", from: "Von", to: "Bis", apply: "Anwenden", granularity: "Intervall" },
    granularity: { day: "Täglich", week: "Wöchentlich", month: "Monatlich" },
    sections: { overview: "Übersicht", trends: "Trends", distributions: "Verteilungen", performance: "Reaktionsleistung", protectionPlans: "Schutzpläne", guardianDelivery: "Zustellung", reviewerWorkload: "Prüfer-Auslastung" },
    overview: { incidentsCreated: "Erstellte Vorfälle", incidentsResolved: "Gelöste Vorfälle", openIncidents: "Offene Vorfälle", escalations: "Eskalationen", activeEscalations: "Aktive Eskalationen", activeProtectionPlans: "Aktive Pläne", completedProtectionPlans: "Abgeschlossene Pläne", overdueActions: "Überfällige Aktionen", blockedActions: "Blockierte Aktionen", evidenceCount: "Beweisobjekte", interventionCount: "Interventionen" },
    series: { incidents: "Vorfälle", resolutions: "Lösungen", escalations: "Eskalationen", interventions: "Interventionen", protectionPlans: "Schutzpläne" },
    dimension: { severity: "Schweregrad", urgency: "Dringlichkeit", risk_family: "Risikofamilie", status: "Vorfallstatus", escalation_status: "Eskalationsstatus", plan_status: "Planstatus", action_status: "Aktionsstatus", delivery_outcome: "Zustellungsergebnis" },
    performance: { incidentToFirstReview: "Vorfall → erste Prüfung", incidentToResolved: "Vorfall → gelöst", planActivationToCompletion: "Planaktivierung → Abschluss", median: "Median", observations: "Beobachtungen" },
    workload: { title: "Prüfer-Auslastung", reviewer: "Prüfer", assigned: "Zugewiesen", resolved: "Gelöst", activeActions: "Aktive Aktionen", overdueActions: "Überfällige Aktionen", medianFirstReview: "Median erste Prüfung", medianResolution: "Median Lösung", note: "Nur operative Auslastung — Prüfer werden nie bewertet oder gereiht.", empty: "Keine zugewiesenen Prüfer in diesem Zeitraum." },
    severityLabel: sev.de, urgencyLabel: urg.de, riskFamilyLabel: rf.de, statusLabel: st.de, escalationStatusLabel: esc.de, planStatusLabel: plan.de, actionStatusLabel: act.de, deliveryOutcomeLabel: dlv.de,
  },
};
