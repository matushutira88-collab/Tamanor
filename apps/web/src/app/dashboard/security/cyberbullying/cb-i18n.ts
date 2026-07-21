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
  // C5 — operations (metrics, actions, assignment, notes).
  ops: { title: string; subtitle: string } & Record<"assignedToMe" | "waitingReview" | "awaitingAction" | "avgReviewTime", string>;
  actionsPanel: { title: string; none: string; changeStatus: string; reason: string; reasonRequired: string; reasonOptional: string; submit: string };
  act: Record<"under_review" | "acknowledged" | "confirmed" | "action_required" | "resolved" | "dismissed" | "archived" | "reopen", string>;
  assign: { title: string; unassigned: string; assignedTo: string; you: string; claim: string; reassign: string; unassign: string; historyTitle: string; historyEmpty: string; by: string; actionLabel: Record<"assigned" | "reassigned" | "unassigned", string> };
  notes: { title: string; subtitle: string; empty: string; you: string; placeholder: string; add: string; confidential: string };
  banner: { ok: string } & Record<"forbidden" | "not_found" | "transition" | "assignment" | "error", string>;
  // C6 — manual report flow.
  report: {
    cta: string; title: string; subtitle: string;
    steps: { subject: string; details: string; review: string };
    subjectStep: { label: string; helper: string; emptyTitle: string; emptyBody: string; type: string; choose: string };
    fields: { reportSource: string; category: string; summary: string; summaryHelper: string; actorLabel: string; actorLabelHelper: string; actorRef: string; actorRefHelper: string; optional: string };
    reviewStep: { title: string; notConfirmed: string; humanReview: string; allegedNeutral: string };
    buttons: { next: string; back: string; cancel: string; submit: string; submitting: string };
    success: { title: string; body: string; incident: string; status: string; pending: string; openDetail: string; backToInbox: string; newReport: string };
    errors: Record<"required" | "too_short" | "too_long" | "invalid" | "denied" | "locked" | "error", string>;
    category: Record<"harassment" | "threats" | "impersonation" | "doxxing" | "exclusion" | "other", string>;
  };
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
const TL_EN = { created: "Incident created", review_started: "Review started", acknowledged: "Acknowledged", confirmed: "Confirmed after review", dismissed: "Dismissed", action_required: "Action required", resolved: "Resolved", archived: "Archived", reopened: "Reopened", detection_linked: "Detection linked", evidence_linked: "Evidence linked", participant_added: "Participant added", participant_removed: "Participant removed", reviewer_assigned: "Reviewer assigned", reviewer_reassigned: "Reviewer reassigned", reviewer_unassigned: "Reviewer unassigned", note_added: "Reviewer note added" };
const TL_SK = { created: "Incident vytvorený", review_started: "Posudzovanie začaté", acknowledged: "Prevzaté", confirmed: "Potvrdené po review", dismissed: "Zamietnuté", action_required: "Vyžaduje akciu", resolved: "Vyriešené", archived: "Archivované", reopened: "Znovu otvorené", detection_linked: "Pripojená detekcia", evidence_linked: "Pripojený dôkaz", participant_added: "Pridaný účastník", participant_removed: "Odobraný účastník", reviewer_assigned: "Priradený posudzovateľ", reviewer_reassigned: "Zmenený posudzovateľ", reviewer_unassigned: "Odobraný posudzovateľ", note_added: "Pridaná poznámka" };
const TL_DE = { created: "Vorfall erstellt", review_started: "Prüfung gestartet", acknowledged: "Bestätigt erhalten", confirmed: "Nach Prüfung bestätigt", dismissed: "Abgewiesen", action_required: "Maßnahme erforderlich", resolved: "Gelöst", archived: "Archiviert", reopened: "Wiedereröffnet", detection_linked: "Erkennung verknüpft", evidence_linked: "Nachweis verknüpft", participant_added: "Teilnehmer hinzugefügt", participant_removed: "Teilnehmer entfernt", reviewer_assigned: "Prüfer zugewiesen", reviewer_reassigned: "Prüfer neu zugewiesen", reviewer_unassigned: "Prüfer entfernt", note_added: "Prüfernotiz hinzugefügt" };

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
    ops: { title: "Review workload", subtitle: "Your operational queue — server-computed, subject-scoped.", assignedToMe: "Assigned to me", waitingReview: "Waiting review", awaitingAction: "Awaiting action", avgReviewTime: "Avg review time (h)" },
    actionsPanel: { title: "Review actions", none: "You have read-only access to this incident.", changeStatus: "Change status", reason: "Reason", reasonRequired: "Reason (required)", reasonOptional: "Reason (optional)", submit: "Apply" },
    act: { under_review: "Start review", acknowledged: "Acknowledge", confirmed: "Confirm", action_required: "Mark action required", resolved: "Resolve", dismissed: "Dismiss", archived: "Archive", reopen: "Reopen" },
    assign: { title: "Assignment", unassigned: "Unassigned", assignedTo: "Assigned to", you: "you", claim: "Assign to me", reassign: "Reassign to me", unassign: "Unassign", historyTitle: "Assignment history", historyEmpty: "No assignment activity yet.", by: "by", actionLabel: { assigned: "Assigned", reassigned: "Reassigned", unassigned: "Unassigned" } },
    notes: { title: "Reviewer notes", subtitle: "Internal & confidential — never shown to the protected subject. Append-only.", empty: "No reviewer notes yet.", you: "you", placeholder: "Add an internal note (not evidence)…", add: "Add note", confidential: "Confidential" },
    banner: { ok: "Done.", forbidden: "You don't have permission for that action.", not_found: "Incident not found or out of scope.", transition: "That status change isn't allowed from the current state.", assignment: "That assignment change isn't allowed.", error: "The action could not be completed." },
    report: {
      cta: "Report incident", title: "Report a cyberbullying incident", subtitle: "File a manual report for an existing protected subject. It opens an incident for human review — no automatic action is taken.",
      steps: { subject: "Protected subject", details: "Incident details", review: "Review & submit" },
      subjectStep: { label: "Protected subject", helper: "Choose the person this report is about. Only subjects you may report for are shown.", emptyTitle: "No protected subjects available", emptyBody: "There are no protected subjects you can report for yet. A protected subject must be created first before a report can be filed.", type: "Type", choose: "Select a subject…" },
      fields: { reportSource: "Report source", category: "Category", summary: "What happened", summaryHelper: "Confidential summary for reviewers. Don't paste passwords or unrelated personal data.", actorLabel: "Alleged actor label", actorLabelHelper: "Optional. A neutral label for the reported person or account — not a verdict.", actorRef: "Alleged actor reference", actorRefHelper: "Optional. A handle, profile link or account reference.", optional: "optional" },
      reviewStep: { title: "Review before submitting", notConfirmed: "This incident is not confirmed. Submitting sends it for human review.", humanReview: "The details below will be reviewed by an authorized person.", allegedNeutral: "The alleged actor is only a reported person or account — never a confirmed attacker." },
      buttons: { next: "Continue", back: "Back", cancel: "Cancel", submit: "Submit report", submitting: "Submitting…" },
      success: { title: "Report received", body: "The incident has been created and is waiting for review.", incident: "Incident", status: "Status", pending: "Waiting for review", openDetail: "Open incident", backToInbox: "Back to inbox", newReport: "File another report" },
      errors: { required: "This field is required.", too_short: "This is too short.", too_long: "This is too long.", invalid: "This value isn't valid.", denied: "You don't have permission to file a report.", locked: "This feature isn't included in your plan.", error: "The report could not be submitted. Please try again." },
      category: { harassment: "Harassment", threats: "Threats", impersonation: "Impersonation", doxxing: "Doxxing", exclusion: "Exclusion", other: "Other" },
    },
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
    ops: { title: "Vyťaženie review", subtitle: "Vaša operačná fronta — počítané na serveri, v rozsahu vašich osôb.", assignedToMe: "Priradené mne", waitingReview: "Čaká na review", awaitingAction: "Čaká na akciu", avgReviewTime: "Priem. čas review (h)" },
    actionsPanel: { title: "Akcie review", none: "K tomuto incidentu máte iba čitateľský prístup.", changeStatus: "Zmeniť stav", reason: "Dôvod", reasonRequired: "Dôvod (povinný)", reasonOptional: "Dôvod (voliteľný)", submit: "Použiť" },
    act: { under_review: "Začať review", acknowledged: "Prevziať", confirmed: "Potvrdiť", action_required: "Označiť akciu potrebnú", resolved: "Vyriešiť", dismissed: "Zamietnuť", archived: "Archivovať", reopen: "Znovu otvoriť" },
    assign: { title: "Priradenie", unassigned: "Nepriradené", assignedTo: "Priradené", you: "vy", claim: "Priradiť mne", reassign: "Prepísať na mňa", unassign: "Zrušiť priradenie", historyTitle: "História priradení", historyEmpty: "Zatiaľ žiadna aktivita priradení.", by: "vykonal", actionLabel: { assigned: "Priradené", reassigned: "Prepísané", unassigned: "Zrušené" } },
    notes: { title: "Poznámky posudzovateľa", subtitle: "Interné a dôverné — nikdy sa nezobrazia chránenej osobe. Len pridávanie.", empty: "Zatiaľ žiadne poznámky.", you: "vy", placeholder: "Pridať internú poznámku (nie dôkaz)…", add: "Pridať poznámku", confidential: "Dôverné" },
    banner: { ok: "Hotovo.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Incident sa nenašiel alebo je mimo rozsahu.", transition: "Táto zmena stavu nie je z aktuálneho stavu povolená.", assignment: "Táto zmena priradenia nie je povolená.", error: "Akciu sa nepodarilo dokončiť." },
    report: {
      cta: "Nahlásiť incident", title: "Nahlásiť incident kyberšikany", subtitle: "Podajte manuálne hlásenie pre existujúcu chránenú osobu. Otvorí sa incident na ľudské preskúmanie — nevykoná sa žiadna automatická akcia.",
      steps: { subject: "Chránená osoba", details: "Údaje incidentu", review: "Kontrola a odoslanie" },
      subjectStep: { label: "Chránená osoba", helper: "Vyberte osobu, ktorej sa hlásenie týka. Zobrazujú sa iba osoby, ktoré môžete nahlásiť.", emptyTitle: "Žiadne dostupné chránené osoby", emptyBody: "Zatiaľ nie sú žiadne chránené osoby, ktoré môžete nahlásiť. Najprv musí byť vytvorená chránená osoba, až potom je možné podať hlásenie.", type: "Typ", choose: "Vyberte osobu…" },
      fields: { reportSource: "Zdroj hlásenia", category: "Kategória", summary: "Čo sa stalo", summaryHelper: "Dôverné zhrnutie pre posudzovateľov. Nevkladajte heslá ani nesúvisiace osobné údaje.", actorLabel: "Označenie údajného aktéra", actorLabelHelper: "Voliteľné. Neutrálne označenie nahlásenej osoby alebo účtu — nie je to verdikt.", actorRef: "Odkaz na údajného aktéra", actorRefHelper: "Voliteľné. Prezývka, odkaz na profil alebo referencia účtu.", optional: "voliteľné" },
      reviewStep: { title: "Skontrolujte pred odoslaním", notConfirmed: "Tento incident nie je potvrdený. Odoslaním ho posielate na ľudské preskúmanie.", humanReview: "Nižšie uvedené údaje preskúma oprávnená osoba.", allegedNeutral: "Údajný aktér je iba nahlásená osoba alebo účet — nikdy nie potvrdený útočník." },
      buttons: { next: "Pokračovať", back: "Späť", cancel: "Zrušiť", submit: "Odoslať hlásenie", submitting: "Odosiela sa…" },
      success: { title: "Hlásenie prijaté", body: "Incident bol vytvorený a čaká na preskúmanie.", incident: "Incident", status: "Stav", pending: "Čaká na preskúmanie", openDetail: "Otvoriť incident", backToInbox: "Späť do inboxu", newReport: "Podať ďalšie hlásenie" },
      errors: { required: "Toto pole je povinné.", too_short: "Toto je príliš krátke.", too_long: "Toto je príliš dlhé.", invalid: "Táto hodnota nie je platná.", denied: "Nemáte oprávnenie podať hlásenie.", locked: "Táto funkcia nie je súčasťou vášho plánu.", error: "Hlásenie sa nepodarilo odoslať. Skúste to znova." },
      category: { harassment: "Obťažovanie", threats: "Vyhrážky", impersonation: "Zneužitie identity", doxxing: "Doxxing", exclusion: "Vylučovanie", other: "Iné" },
    },
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
    ops: { title: "Prüf-Auslastung", subtitle: "Ihre operative Warteschlange — serverseitig berechnet, personenbezogen.", assignedToMe: "Mir zugewiesen", waitingReview: "Wartet auf Prüfung", awaitingAction: "Wartet auf Maßnahme", avgReviewTime: "Ø Prüfzeit (h)" },
    actionsPanel: { title: "Prüf-Aktionen", none: "Sie haben nur Lesezugriff auf diesen Vorfall.", changeStatus: "Status ändern", reason: "Grund", reasonRequired: "Grund (erforderlich)", reasonOptional: "Grund (optional)", submit: "Anwenden" },
    act: { under_review: "Prüfung starten", acknowledged: "Bestätigen", confirmed: "Nach Prüfung bestätigen", action_required: "Maßnahme markieren", resolved: "Lösen", dismissed: "Abweisen", archived: "Archivieren", reopen: "Wiedereröffnen" },
    assign: { title: "Zuweisung", unassigned: "Nicht zugewiesen", assignedTo: "Zugewiesen an", you: "Sie", claim: "Mir zuweisen", reassign: "Auf mich übertragen", unassign: "Zuweisung aufheben", historyTitle: "Zuweisungsverlauf", historyEmpty: "Noch keine Zuweisungsaktivität.", by: "von", actionLabel: { assigned: "Zugewiesen", reassigned: "Neu zugewiesen", unassigned: "Aufgehoben" } },
    notes: { title: "Prüfernotizen", subtitle: "Intern & vertraulich — nie für die geschützte Person sichtbar. Nur Anfügen.", empty: "Noch keine Prüfernotizen.", you: "Sie", placeholder: "Interne Notiz hinzufügen (kein Nachweis)…", add: "Notiz hinzufügen", confidential: "Vertraulich" },
    banner: { ok: "Erledigt.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Vorfall nicht gefunden oder außerhalb des Bereichs.", transition: "Diese Statusänderung ist aus dem aktuellen Zustand nicht erlaubt.", assignment: "Diese Zuweisungsänderung ist nicht erlaubt.", error: "Die Aktion konnte nicht abgeschlossen werden." },
    report: {
      cta: "Vorfall melden", title: "Cybermobbing-Vorfall melden", subtitle: "Erstellen Sie eine manuelle Meldung für eine bestehende geschützte Person. Es wird ein Vorfall zur menschlichen Prüfung eröffnet — es erfolgt keine automatische Maßnahme.",
      steps: { subject: "Geschützte Person", details: "Vorfalldetails", review: "Prüfen & senden" },
      subjectStep: { label: "Geschützte Person", helper: "Wählen Sie die Person, um die es geht. Es werden nur Personen angezeigt, für die Sie melden dürfen.", emptyTitle: "Keine geschützten Personen verfügbar", emptyBody: "Es gibt noch keine geschützten Personen, für die Sie melden können. Zuerst muss eine geschützte Person angelegt werden, bevor eine Meldung erstellt werden kann.", type: "Typ", choose: "Person auswählen…" },
      fields: { reportSource: "Meldungsquelle", category: "Kategorie", summary: "Was ist passiert", summaryHelper: "Vertrauliche Zusammenfassung für Prüfer. Keine Passwörter oder unbeteiligten personenbezogenen Daten einfügen.", actorLabel: "Bezeichnung des mutmaßlichen Akteurs", actorLabelHelper: "Optional. Eine neutrale Bezeichnung der gemeldeten Person oder des Kontos — kein Urteil.", actorRef: "Referenz des mutmaßlichen Akteurs", actorRefHelper: "Optional. Ein Handle, Profillink oder eine Kontoreferenz.", optional: "optional" },
      reviewStep: { title: "Vor dem Senden prüfen", notConfirmed: "Dieser Vorfall ist nicht bestätigt. Beim Senden wird er zur menschlichen Prüfung weitergeleitet.", humanReview: "Die folgenden Angaben werden von einer autorisierten Person geprüft.", allegedNeutral: "Der mutmaßliche Akteur ist nur eine gemeldete Person oder ein Konto — nie ein bestätigter Angreifer." },
      buttons: { next: "Weiter", back: "Zurück", cancel: "Abbrechen", submit: "Meldung senden", submitting: "Wird gesendet…" },
      success: { title: "Meldung erhalten", body: "Der Vorfall wurde erstellt und wartet auf Prüfung.", incident: "Vorfall", status: "Status", pending: "Wartet auf Prüfung", openDetail: "Vorfall öffnen", backToInbox: "Zurück zum Posteingang", newReport: "Weitere Meldung erstellen" },
      errors: { required: "Dieses Feld ist erforderlich.", too_short: "Dies ist zu kurz.", too_long: "Dies ist zu lang.", invalid: "Dieser Wert ist ungültig.", denied: "Sie haben keine Berechtigung, eine Meldung zu erstellen.", locked: "Diese Funktion ist in Ihrem Tarif nicht enthalten.", error: "Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen." },
      category: { harassment: "Belästigung", threats: "Drohungen", impersonation: "Identitätsmissbrauch", doxxing: "Doxxing", exclusion: "Ausgrenzung", other: "Sonstiges" },
    },
  },
};

const TONE_FOR_STATUS: Record<string, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  open: "brand", under_review: "brand", acknowledged: "brand", confirmed: "warn", action_required: "danger", resolved: "ok", dismissed: "neutral", archived: "neutral",
};
export function statusTone(status: string): "neutral" | "brand" | "ok" | "warn" | "danger" {
  return TONE_FOR_STATUS[status] ?? "neutral";
}
