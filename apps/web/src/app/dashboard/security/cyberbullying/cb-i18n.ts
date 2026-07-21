import type { Locale } from "@/i18n/config";

/**
 * C4 — EN/SK/DE copy for the Cyberbullying dashboard, inbox, and read-only detail.
 * Compile-enforced (Record<Locale, CbCopy>) so no locale is missing a key. Honest
 * wording: incident · detected signal · under review · alleged actor · confirmed
 * after review. Never: guilty / perpetrator / confirmed attacker.
 */
export interface CbCopy {
  moduleName: string;
  moduleDesc: string;
  available: string;
  openIncidents: (n: number) => string;
  openDashboard: string;
  overviewTitle: string;
  overviewSubtitle: string;
  inboxTitle: string;
  inboxSubtitle: string;
  detailTitle: string;
  backToInbox: string;
  system: string;
  reason: string;
  detectOnly: string;
  allegedNote: string;
  timeframe: Record<"7" | "30" | "90", string>;
  kpi: Record<"open" | "underReview" | "actionRequired" | "resolved" | "withoutEvidence" | "createdInWindow" | "linkedDetections" | "avgOpenAge", string>;
  status: Record<string, string>;
  reportSource: Record<string, string>;
  participantRole: Record<string, string>;
  timelineEvent: Record<string, string>;
  evidenceMeta: Record<"type" | "source" | "captureMethod" | "capturedAt" | "mimeType" | "sizeBytes" | "integrity" | "scan" | "retention" | "legalHold", string>;
  col: Record<"id" | "subject" | "status" | "category" | "source" | "allegedActor" | "detections" | "evidence" | "created" | "updated", string>;
  filter: Record<"status" | "source" | "subject" | "evidence" | "detections" | "timeframe" | "search" | "all" | "hasEvidence" | "noEvidence" | "hasDetections" | "manualOnly" | "reset" | "sort", string>;
  sort: Record<"newest" | "oldest" | "recentlyUpdated" | "statusPriority", string>;
  section: Record<"overview" | "subject" | "summary" | "allegedActor" | "participants" | "detections" | "evidence" | "timeline", string>;
  empty: { noIncidentsTitle: string; noIncidentsBody: string; filterTitle: string; filterBody: string; noDetections: string; noEvidence: string; noTimeline: string };
  error: { title: string; body: string; notFound: string };
  pageOf: (p: number, total: number) => string;
  prev: string;
  next: string;
}

const STATUS_EN = { open: "Open", under_review: "Under review", acknowledged: "Acknowledged", confirmed: "Confirmed after review", action_required: "Action required", resolved: "Resolved", dismissed: "Dismissed", archived: "Archived" };
const STATUS_SK = { open: "Otvorené", under_review: "V posudzovaní", acknowledged: "Prevzaté", confirmed: "Potvrdené po review", action_required: "Vyžaduje akciu", resolved: "Vyriešené", dismissed: "Zamietnuté", archived: "Archivované" };
const STATUS_DE = { open: "Offen", under_review: "In Prüfung", acknowledged: "Bestätigt erhalten", confirmed: "Nach Prüfung bestätigt", action_required: "Maßnahme erforderlich", resolved: "Gelöst", dismissed: "Abgewiesen", archived: "Archiviert" };
const SOURCE_EN = { manual_report: "Manual report", detection: "From detections" };
const SOURCE_SK = { manual_report: "Manuálny report", detection: "Z detekcií" };
const SOURCE_DE = { manual_report: "Manuelle Meldung", detection: "Aus Erkennungen" };
const ROLE_EN = { protected_subject: "Protected subject", reporter: "Reporter", alleged_actor: "Alleged actor", reviewer: "Reviewer", trusted_contact: "Trusted contact" };
const ROLE_SK = { protected_subject: "Chránená osoba", reporter: "Nahlasovateľ", alleged_actor: "Údajný aktér", reviewer: "Posudzovateľ", trusted_contact: "Dôveryhodný kontakt" };
const ROLE_DE = { protected_subject: "Geschützte Person", reporter: "Melder", alleged_actor: "Mutmaßlicher Akteur", reviewer: "Prüfer", trusted_contact: "Vertrauensperson" };
const TL_EN = { created: "Incident created", review_started: "Review started", acknowledged: "Acknowledged", confirmed: "Confirmed after review", dismissed: "Dismissed", action_required: "Action required", resolved: "Resolved", archived: "Archived", reopened: "Reopened", detection_linked: "Detection linked", evidence_linked: "Evidence linked", participant_added: "Participant added", participant_removed: "Participant removed" };
const TL_SK = { created: "Incident vytvorený", review_started: "Posudzovanie začaté", acknowledged: "Prevzaté", confirmed: "Potvrdené po review", dismissed: "Zamietnuté", action_required: "Vyžaduje akciu", resolved: "Vyriešené", archived: "Archivované", reopened: "Znovu otvorené", detection_linked: "Pripojená detekcia", evidence_linked: "Pripojený dôkaz", participant_added: "Pridaný účastník", participant_removed: "Odobraný účastník" };
const TL_DE = { created: "Vorfall erstellt", review_started: "Prüfung gestartet", acknowledged: "Bestätigt erhalten", confirmed: "Nach Prüfung bestätigt", dismissed: "Abgewiesen", action_required: "Maßnahme erforderlich", resolved: "Gelöst", archived: "Archiviert", reopened: "Wiedereröffnet", detection_linked: "Erkennung verknüpft", evidence_linked: "Nachweis verknüpft", participant_added: "Teilnehmer hinzugefügt", participant_removed: "Teilnehmer entfernt" };

export const CB_COPY: Record<Locale, CbCopy> = {
  en: {
    moduleName: "Cyberbullying Protection", moduleDesc: "Victim-centric incident review — detected signals and manual reports, kept separate from brand moderation.", available: "Available",
    openIncidents: (n) => (n === 1 ? "1 open incident" : `${n} open incidents`), openDashboard: "Open dashboard",
    overviewTitle: "Cyberbullying Protection", overviewSubtitle: "Reviewed cyberbullying incidents at a glance. Detection & review only — no automatic action.",
    inboxTitle: "Incident inbox", inboxSubtitle: "Reviewed cases. A signal is not a confirmed incident; an actor is alleged until human review.",
    detailTitle: "Incident", backToInbox: "Back to inbox", system: "System", reason: "Reason", detectOnly: "Detection & review only — Tamanor never acts on a platform by itself.", allegedNote: "Alleged — not a confirmed attacker without human review.",
    timeframe: { "7": "7d", "30": "30d", "90": "90d" },
    kpi: { open: "Open incidents", underReview: "Under review", actionRequired: "Action required", resolved: "Resolved", withoutEvidence: "Without linked evidence", createdInWindow: "Created in period", linkedDetections: "Linked detections", avgOpenAge: "Avg open age (h)" },
    status: STATUS_EN, reportSource: SOURCE_EN, participantRole: ROLE_EN, timelineEvent: TL_EN,
    evidenceMeta: { type: "Type", source: "Source", captureMethod: "Capture", capturedAt: "Captured", mimeType: "MIME", sizeBytes: "Size", integrity: "Integrity", scan: "Scan", retention: "Retention until", legalHold: "Legal hold" },
    col: { id: "Incident", subject: "Protected subject", status: "Status", category: "Category", source: "Source", allegedActor: "Alleged actor", detections: "Detections", evidence: "Evidence", created: "Created", updated: "Updated" },
    filter: { status: "Status", source: "Source", subject: "Subject", evidence: "Evidence", detections: "Detections", timeframe: "Created", search: "Search", all: "All", hasEvidence: "Has evidence", noEvidence: "No evidence", hasDetections: "Has detections", manualOnly: "Manual only", reset: "Reset filters", sort: "Sort" },
    sort: { newest: "Newest", oldest: "Oldest", recentlyUpdated: "Recently updated", statusPriority: "By status" },
    section: { overview: "Overview", subject: "Protected subject", summary: "Summary", allegedActor: "Alleged actor", participants: "Participants", detections: "Linked detections", evidence: "Linked evidence", timeline: "Timeline" },
    empty: { noIncidentsTitle: "No incidents yet", noIncidentsBody: "There are no reviewed cyberbullying incidents in your workspace yet.", filterTitle: "No matching incidents", filterBody: "No incidents match these filters.", noDetections: "No linked detections — this may have been opened by a manual report.", noEvidence: "No linked evidence.", noTimeline: "No activity beyond creation yet." },
    error: { title: "Something went wrong", body: "This section could not be loaded. Please try again.", notFound: "Incident not found or you don't have access to it." },
    pageOf: (p, total) => `Page ${p} · ${total} total`, prev: "Previous", next: "Next",
  },
  sk: {
    moduleName: "Ochrana pred kyberšikanou", moduleDesc: "Posudzovanie incidentov zameraných na obeť — detegované signály a manuálne reporty, oddelené od brand moderácie.", available: "Dostupné",
    openIncidents: (n) => (n === 1 ? "1 otvorený incident" : `${n} otvorených incidentov`), openDashboard: "Otvoriť dashboard",
    overviewTitle: "Ochrana pred kyberšikanou", overviewSubtitle: "Preskúmané incidenty kyberšikany na jednom mieste. Iba detekcia a review — žiadna automatická akcia.",
    inboxTitle: "Inbox incidentov", inboxSubtitle: "Preskúmané prípady. Signál nie je potvrdený incident; aktér je údajný do ľudského review.",
    detailTitle: "Incident", backToInbox: "Späť do inboxu", system: "Systém", reason: "Dôvod", detectOnly: "Iba detekcia a review — Tamanor nikdy nekoná na platforme sám.", allegedNote: "Údajný — nie potvrdený útočník bez ľudského review.",
    timeframe: { "7": "7d", "30": "30d", "90": "90d" },
    kpi: { open: "Otvorené incidenty", underReview: "V posudzovaní", actionRequired: "Vyžaduje akciu", resolved: "Vyriešené", withoutEvidence: "Bez pripojených dôkazov", createdInWindow: "Vytvorené v období", linkedDetections: "Pripojené detekcie", avgOpenAge: "Priem. vek otvorených (h)" },
    status: STATUS_SK, reportSource: SOURCE_SK, participantRole: ROLE_SK, timelineEvent: TL_SK,
    evidenceMeta: { type: "Typ", source: "Zdroj", captureMethod: "Zachytenie", capturedAt: "Zachytené", mimeType: "MIME", sizeBytes: "Veľkosť", integrity: "Integrita", scan: "Sken", retention: "Retencia do", legalHold: "Legal hold" },
    col: { id: "Incident", subject: "Chránená osoba", status: "Stav", category: "Kategória", source: "Zdroj", allegedActor: "Údajný aktér", detections: "Detekcie", evidence: "Dôkazy", created: "Vytvorené", updated: "Aktualizované" },
    filter: { status: "Stav", source: "Zdroj", subject: "Osoba", evidence: "Dôkazy", detections: "Detekcie", timeframe: "Vytvorené", search: "Hľadať", all: "Všetko", hasEvidence: "S dôkazmi", noEvidence: "Bez dôkazov", hasDetections: "S detekciami", manualOnly: "Iba manuálne", reset: "Zrušiť filtre", sort: "Zoradiť" },
    sort: { newest: "Najnovšie", oldest: "Najstaršie", recentlyUpdated: "Nedávno upravené", statusPriority: "Podľa stavu" },
    section: { overview: "Prehľad", subject: "Chránená osoba", summary: "Zhrnutie", allegedActor: "Údajný aktér", participants: "Účastníci", detections: "Pripojené detekcie", evidence: "Pripojené dôkazy", timeline: "Časová os" },
    empty: { noIncidentsTitle: "Zatiaľ žiadne incidenty", noIncidentsBody: "Vo vašom workspace zatiaľ nie sú žiadne preskúmané incidenty kyberšikany.", filterTitle: "Žiadne zodpovedajúce incidenty", filterBody: "Žiadne incidenty nezodpovedajú týmto filtrom.", noDetections: "Žiadne pripojené detekcie — mohol vzniknúť manuálnym reportom.", noEvidence: "Žiadne pripojené dôkazy.", noTimeline: "Zatiaľ žiadna aktivita nad rámec vytvorenia." },
    error: { title: "Niečo sa pokazilo", body: "Túto sekciu sa nepodarilo načítať. Skúste to znova.", notFound: "Incident sa nenašiel alebo k nemu nemáte prístup." },
    pageOf: (p, total) => `Strana ${p} · celkom ${total}`, prev: "Predchádzajúce", next: "Ďalšie",
  },
  de: {
    moduleName: "Cybermobbing-Schutz", moduleDesc: "Opferzentrierte Vorfallprüfung — erkannte Signale und manuelle Meldungen, getrennt von der Markenmoderation.", available: "Verfügbar",
    openIncidents: (n) => (n === 1 ? "1 offener Vorfall" : `${n} offene Vorfälle`), openDashboard: "Dashboard öffnen",
    overviewTitle: "Cybermobbing-Schutz", overviewSubtitle: "Geprüfte Cybermobbing-Vorfälle auf einen Blick. Nur Erkennung & Prüfung — keine automatische Maßnahme.",
    inboxTitle: "Vorfall-Posteingang", inboxSubtitle: "Geprüfte Fälle. Ein Signal ist kein bestätigter Vorfall; ein Akteur ist bis zur Prüfung mutmaßlich.",
    detailTitle: "Vorfall", backToInbox: "Zurück zum Posteingang", system: "System", reason: "Grund", detectOnly: "Nur Erkennung & Prüfung — Tamanor handelt nie selbst auf einer Plattform.", allegedNote: "Mutmaßlich — kein bestätigter Angreifer ohne menschliche Prüfung.",
    timeframe: { "7": "7T", "30": "30T", "90": "90T" },
    kpi: { open: "Offene Vorfälle", underReview: "In Prüfung", actionRequired: "Maßnahme erforderlich", resolved: "Gelöst", withoutEvidence: "Ohne verknüpfte Nachweise", createdInWindow: "Im Zeitraum erstellt", linkedDetections: "Verknüpfte Erkennungen", avgOpenAge: "Ø Alter offen (h)" },
    status: STATUS_DE, reportSource: SOURCE_DE, participantRole: ROLE_DE, timelineEvent: TL_DE,
    evidenceMeta: { type: "Typ", source: "Quelle", captureMethod: "Erfassung", capturedAt: "Erfasst", mimeType: "MIME", sizeBytes: "Größe", integrity: "Integrität", scan: "Scan", retention: "Aufbewahrung bis", legalHold: "Legal Hold" },
    col: { id: "Vorfall", subject: "Geschützte Person", status: "Status", category: "Kategorie", source: "Quelle", allegedActor: "Mutmaßlicher Akteur", detections: "Erkennungen", evidence: "Nachweise", created: "Erstellt", updated: "Aktualisiert" },
    filter: { status: "Status", source: "Quelle", subject: "Person", evidence: "Nachweise", detections: "Erkennungen", timeframe: "Erstellt", search: "Suchen", all: "Alle", hasEvidence: "Mit Nachweis", noEvidence: "Ohne Nachweis", hasDetections: "Mit Erkennungen", manualOnly: "Nur manuell", reset: "Filter zurücksetzen", sort: "Sortieren" },
    sort: { newest: "Neueste", oldest: "Älteste", recentlyUpdated: "Kürzlich aktualisiert", statusPriority: "Nach Status" },
    section: { overview: "Übersicht", subject: "Geschützte Person", summary: "Zusammenfassung", allegedActor: "Mutmaßlicher Akteur", participants: "Teilnehmer", detections: "Verknüpfte Erkennungen", evidence: "Verknüpfte Nachweise", timeline: "Zeitachse" },
    empty: { noIncidentsTitle: "Noch keine Vorfälle", noIncidentsBody: "In Ihrem Workspace gibt es noch keine geprüften Cybermobbing-Vorfälle.", filterTitle: "Keine passenden Vorfälle", filterBody: "Keine Vorfälle entsprechen diesen Filtern.", noDetections: "Keine verknüpften Erkennungen — evtl. durch eine manuelle Meldung eröffnet.", noEvidence: "Keine verknüpften Nachweise.", noTimeline: "Noch keine Aktivität über die Erstellung hinaus." },
    error: { title: "Etwas ist schiefgelaufen", body: "Dieser Bereich konnte nicht geladen werden. Bitte erneut versuchen.", notFound: "Vorfall nicht gefunden oder kein Zugriff." },
    pageOf: (p, total) => `Seite ${p} · ${total} gesamt`, prev: "Zurück", next: "Weiter",
  },
};

const TONE_FOR_STATUS: Record<string, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  open: "brand", under_review: "brand", acknowledged: "brand", confirmed: "warn", action_required: "danger", resolved: "ok", dismissed: "neutral", archived: "neutral",
};
export function statusTone(status: string): "neutral" | "brand" | "ok" | "warn" | "danger" {
  return TONE_FOR_STATUS[status] ?? "neutral";
}
