/**
 * Child Safety Reviewer Console V1 — localized copy (en/sk/de) + the SAFE action-error contract.
 * Every user-facing string in the console comes from here; server actions return only these opaque error
 * CODES (never a message/stack/id), which the client localizes.
 */
import type { Locale } from "@/i18n/config";

/** Safe, serializable error codes a review server action may return. Never a raw message/stack/id. */
export const REVIEW_ACTION_ERROR_CODES = [
  "forbidden", "not_found", "invalid_transition", "invalid_status", "note_empty", "note_too_long",
  "assignee_required", "unknown_action", "retry_later",
] as const;
export type ReviewActionErrorCode = (typeof REVIEW_ACTION_ERROR_CODES)[number];
export function isReviewActionErrorCode(v: string): v is ReviewActionErrorCode {
  return (REVIEW_ACTION_ERROR_CODES as readonly string[]).includes(v);
}

export interface ReviewerCopy {
  title: string; subtitle: string;
  unauthorized: { badge: string; title: string; body: string; cta: string };
  loading: string; errorTitle: string; errorBody: string; retry: string;
  cards: { open: string; escalated: string; critical: string; resolvedToday: string; avgResponse: string; avgResolution: string; signals24h: string; deliveries: string; topFamilies: string; none: string };
  table: { id: string; created: string; updated: string; profile: string; severity: string; urgency: string; status: string; escalation: string; assigned: string; signals: string; unassigned: string; open: string };
  list: { empty: string; emptyHint: string; results: (n: number) => string; page: (a: number, b: number) => string; prev: string; next: string; search: string; searchPlaceholder: string; clear: string; filters: string };
  sort: { label: string; newest: string; oldest: string; severity: string; urgency: string };
  filter: { all: string; any: string; status: string; severity: string; urgency: string; escalation: string; escalated: string; notEscalated: string; profile: string; from: string; to: string };
  statusLabel: Record<string, string>;
  severityLabel: Record<string, string>;
  urgencyLabel: Record<string, string>;
  detail: { back: string; overview: string; assignment: string; guardianDelivery: string; recovery: string; signals: string; escalations: string; notifications: string; auditSummary: string; executionSummary: string; timeline: string; notes: string; readOnly: string; noSignals: string; noEscalations: string; noNotifications: string; noAudit: string; noNotes: string; deliveredTo: string; ledgerSignals: string; ledgerCompleted: string; ledgerDelivered: string; ledgerEscalated: string; recoveryRepairs: string; recoveryIncomplete: string; linkedAt: string; triggeredAt: string; confidence: string };
  actions: { assign: string; assignToMe: string; reassign: string; unassign: string; addNote: string; changeStatus: string; confirm: string; cancel: string; working: string; assigneePlaceholder: string; assignTitle: string; assignBody: string; statusTitle: (s: string) => string; statusBody: (s: string) => string; noteTitle: string; statusConfirmBody: string; markdownHint: string; preview: string; write: string; notePlaceholder: string; save: string };
  statusTarget: Record<string, string>;
  tl: Record<string, string>;
  errors: Record<string, string>;
  evidence: {
    tab: string; empty: string; upload: string; uploadTitle: string; type: string; label: string; file: string; url: string; text: string;
    typeLabel: Record<string, string>; sourceLabel: Record<string, string>; integrityLabel: Record<string, string>; custodyLabel: Record<string, string>;
    chain: string; hash: string; integrity: string; sealed: string; sealedBadge: string; size: string; uploader: string; capturedAt: string;
    preview: string; download: string; verify: string; seal: string; export: string; custodyChain: string; noCustody: string;
    filterType: string; filterSource: string; search: string; searchPlaceholder: string; all: string; readOnly: string; verifying: string; working: string; labelPlaceholder: string; textPlaceholder: string; urlPlaceholder: string; addBtn: string;
  };
}

const tlEn = { incident_created: "Incident opened", signal_linked: "Safety signal linked", severity_increased: "Severity raised", urgency_increased: "Urgency raised", escalation_triggered: "Escalation triggered", notification_sent: "Internal notification sent", guardian_delivery: "Guardian delivery", recovery_repair: "Recovery repair", reviewer_assigned: "Reviewer assigned", reviewer_unassigned: "Reviewer unassigned", status_changed: "Status changed", reviewer_note: "Reviewer note added", event: "Event" };
const tlSk = { incident_created: "Incident otvorený", signal_linked: "Bezpečnostný signál prepojený", severity_increased: "Závažnosť zvýšená", urgency_increased: "Naliehavosť zvýšená", escalation_triggered: "Eskalácia spustená", notification_sent: "Interné upozornenie odoslané", guardian_delivery: "Doručenie opatrovníkovi", recovery_repair: "Oprava obnovy", reviewer_assigned: "Recenzent priradený", reviewer_unassigned: "Recenzent odobraný", status_changed: "Stav zmenený", reviewer_note: "Pridaná poznámka recenzenta", event: "Udalosť" };
const tlDe = { incident_created: "Vorfall eröffnet", signal_linked: "Sicherheitssignal verknüpft", severity_increased: "Schweregrad erhöht", urgency_increased: "Dringlichkeit erhöht", escalation_triggered: "Eskalation ausgelöst", notification_sent: "Interne Benachrichtigung gesendet", guardian_delivery: "Zustellung an Erziehungsberechtigten", recovery_repair: "Wiederherstellungsreparatur", reviewer_assigned: "Prüfer zugewiesen", reviewer_unassigned: "Prüfer entfernt", status_changed: "Status geändert", reviewer_note: "Prüfernotiz hinzugefügt", event: "Ereignis" };

const statusEn = { open: "Open", under_review: "Under review", action_required: "Action required", monitoring: "Monitoring", waiting: "Waiting", resolved: "Resolved", dismissed: "Dismissed", reopened: "Reopened", closed: "Closed" };
const statusSk = { open: "Otvorené", under_review: "V posudzovaní", action_required: "Vyžaduje akciu", monitoring: "Monitorovanie", waiting: "Čaká sa", resolved: "Vyriešené", dismissed: "Zamietnuté", reopened: "Znovu otvorené", closed: "Uzavreté" };
const statusDe = { open: "Offen", under_review: "In Prüfung", action_required: "Aktion erforderlich", monitoring: "Überwachung", waiting: "Wartet", resolved: "Gelöst", dismissed: "Abgewiesen", reopened: "Wieder geöffnet", closed: "Geschlossen" };

const sevEn = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const sevSk = { critical: "Kritická", high: "Vysoká", medium: "Stredná", low: "Nízka" };
const sevDe = { critical: "Kritisch", high: "Hoch", medium: "Mittel", low: "Niedrig" };
const urgEn = { immediate: "Immediate", elevated: "Elevated", routine: "Routine" };
const urgSk = { immediate: "Okamžitá", elevated: "Zvýšená", routine: "Bežná" };
const urgDe = { immediate: "Sofort", elevated: "Erhöht", routine: "Routine" };

const errEn = { forbidden: "You don't have permission to do that.", not_found: "That incident could not be found.", invalid_transition: "That status change isn't allowed from the current state.", invalid_status: "Unknown status.", note_empty: "A note can't be empty.", note_too_long: "That note is too long.", assignee_required: "Choose someone to assign.", unknown_action: "Unknown action.", retry_later: "Something went wrong. Please try again." };
const errSk = { forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Tento incident sa nenašiel.", invalid_transition: "Táto zmena stavu nie je z aktuálneho stavu povolená.", invalid_status: "Neznámy stav.", note_empty: "Poznámka nemôže byť prázdna.", note_too_long: "Táto poznámka je príliš dlhá.", assignee_required: "Vyberte, komu priradiť.", unknown_action: "Neznáma akcia.", retry_later: "Niečo sa pokazilo. Skúste to znova." };
const errDe = { forbidden: "Sie haben keine Berechtigung dafür.", not_found: "Dieser Vorfall wurde nicht gefunden.", invalid_transition: "Diese Statusänderung ist aus dem aktuellen Zustand nicht zulässig.", invalid_status: "Unbekannter Status.", note_empty: "Eine Notiz darf nicht leer sein.", note_too_long: "Diese Notiz ist zu lang.", assignee_required: "Wählen Sie eine Person zum Zuweisen.", unknown_action: "Unbekannte Aktion.", retry_later: "Etwas ist schiefgelaufen. Bitte erneut versuchen." };

const targetEn = { under_review: "Mark under review", waiting: "Mark waiting", resolved: "Resolve", dismissed: "Dismiss", reopened: "Reopen" };
const targetSk = { under_review: "Označiť v posudzovaní", waiting: "Označiť čaká sa", resolved: "Vyriešiť", dismissed: "Zamietnuť", reopened: "Znovu otvoriť" };
const targetDe = { under_review: "Als in Prüfung markieren", waiting: "Als wartend markieren", resolved: "Lösen", dismissed: "Abweisen", reopened: "Wieder öffnen" };

export const REVIEWER_COPY: Record<Locale, ReviewerCopy> = {
  en: {
    title: "Child Safety Reviewer Console", subtitle: "Investigate and act on canonical child-safety incidents.",
    unauthorized: { badge: "403 · Access denied", title: "Reviewer access required", body: "This console is limited to workspace owners, administrators, and safety reviewers.", cta: "Back to dashboard" },
    loading: "Loading…", errorTitle: "Something went wrong", errorBody: "The reviewer console couldn't load. Please try again.", retry: "Try again",
    cards: { open: "Open incidents", escalated: "Escalated", critical: "Critical", resolvedToday: "Resolved today", avgResponse: "Avg response", avgResolution: "Avg resolution", signals24h: "Signals (24h)", deliveries: "Guardian deliveries", topFamilies: "Top risk families", none: "None" },
    table: { id: "Incident", created: "Created", updated: "Updated", profile: "Profile", severity: "Severity", urgency: "Urgency", status: "Status", escalation: "Escalation", assigned: "Assigned", signals: "Signals", unassigned: "Unassigned", open: "Open" },
    list: { empty: "No incidents", emptyHint: "No child-safety incidents match your filters.", results: (n) => `${n} incident${n === 1 ? "" : "s"}`, page: (a, b) => `Page ${a} of ${b}`, prev: "Previous", next: "Next", search: "Search", searchPlaceholder: "Incident id or profile id…", clear: "Clear", filters: "Filters" },
    sort: { label: "Sort", newest: "Newest", oldest: "Oldest", severity: "Highest severity", urgency: "Highest urgency" },
    filter: { all: "All", any: "Any", status: "Status", severity: "Severity", urgency: "Urgency", escalation: "Escalation", escalated: "Escalated", notEscalated: "Not escalated", profile: "Profile id", from: "From", to: "To" },
    statusLabel: statusEn, severityLabel: sevEn, urgencyLabel: urgEn,
    detail: { back: "All incidents", overview: "Overview", assignment: "Assignment", guardianDelivery: "Guardian delivery", recovery: "Recovery", signals: "Linked signals", escalations: "Escalations", notifications: "Internal notifications", auditSummary: "Audit references", executionSummary: "Execution ledger", timeline: "Timeline", notes: "Reviewer notes", readOnly: "Read-only", noSignals: "No linked signals.", noEscalations: "No escalations.", noNotifications: "No notifications.", noAudit: "No audit references.", noNotes: "No notes yet.", deliveredTo: "Deliveries", ledgerSignals: "Signals tracked", ledgerCompleted: "Completed", ledgerDelivered: "Delivered", ledgerEscalated: "Escalated", recoveryRepairs: "Repairs", recoveryIncomplete: "Incomplete", linkedAt: "Linked", triggeredAt: "Triggered", confidence: "Confidence" },
    actions: { assign: "Assign", assignToMe: "Assign to me", reassign: "Reassign", unassign: "Unassign", addNote: "Add note", changeStatus: "Change status", confirm: "Confirm", cancel: "Cancel", working: "Working…", assigneePlaceholder: "Reviewer user id", assignTitle: "Assign reviewer", assignBody: "Assign this incident to a reviewer. This is recorded in the incident's history.", statusTitle: (s) => `${s}?`, statusBody: (s) => `Change this incident's status to “${s}”. This is recorded in the incident's history.`, noteTitle: "Add reviewer note", statusConfirmBody: "This is recorded in the incident's history and cannot be undone except by reopening.", markdownHint: "Markdown supported · internal only · cannot be edited or deleted", preview: "Preview", write: "Write", notePlaceholder: "Add an internal note…", save: "Save note" },
    statusTarget: targetEn, tl: tlEn, errors: errEn,
  evidence: {
    tab: "Evidence", empty: "No evidence yet.", upload: "Add evidence", uploadTitle: "Add evidence", type: "Type", label: "Label", file: "File", url: "URL", text: "Text",
    typeLabel: { uploaded_file: "File", screenshot: "Screenshot", external_url: "External URL", manual: "Manual", system: "System" },
    sourceLabel: { reviewer_upload: "Reviewer upload", system: "System", external: "External" },
    integrityLabel: { unverified: "Unverified", verified: "Verified", failed: "Failed" },
    custodyLabel: { created: "Created", verified: "Verified", reviewed: "Reviewed", referenced: "Referenced", exported: "Exported", sealed: "Sealed" },
    chain: "#", hash: "Hash", integrity: "Integrity", sealed: "Sealed", sealedBadge: "Sealed", size: "Size", uploader: "Uploader", capturedAt: "Captured",
    preview: "Preview", download: "Download", verify: "Verify", seal: "Seal", export: "Export package", custodyChain: "Chain of custody", noCustody: "No custody events.",
    filterType: "Type", filterSource: "Source", search: "Search", searchPlaceholder: "Label or id…", all: "All", readOnly: "Read-only", verifying: "Verifying…", working: "Working…", labelPlaceholder: "Short label (optional)", textPlaceholder: "Reviewer evidence text…", urlPlaceholder: "https://…", addBtn: "Add",
  },
  },
  sk: {
    title: "Konzola recenzenta ochrany detí", subtitle: "Prešetrujte a konajte pri kanonických incidentoch ochrany detí.",
    unauthorized: { badge: "403 · Prístup zamietnutý", title: "Vyžaduje sa prístup recenzenta", body: "Táto konzola je len pre vlastníkov, administrátorov a bezpečnostných recenzentov.", cta: "Späť na dashboard" },
    loading: "Načítava sa…", errorTitle: "Niečo sa pokazilo", errorBody: "Konzolu recenzenta sa nepodarilo načítať. Skúste to znova.", retry: "Skúsiť znova",
    cards: { open: "Otvorené incidenty", escalated: "Eskalované", critical: "Kritické", resolvedToday: "Dnes vyriešené", avgResponse: "Priem. reakcia", avgResolution: "Priem. vyriešenie", signals24h: "Signály (24h)", deliveries: "Doručenia opatrovníkom", topFamilies: "Najčastejšie rodiny rizík", none: "Žiadne" },
    table: { id: "Incident", created: "Vytvorené", updated: "Aktualizované", profile: "Profil", severity: "Závažnosť", urgency: "Naliehavosť", status: "Stav", escalation: "Eskalácia", assigned: "Priradené", signals: "Signály", unassigned: "Nepriradené", open: "Otvoriť" },
    list: { empty: "Žiadne incidenty", emptyHint: "Vašim filtrom nezodpovedajú žiadne incidenty ochrany detí.", results: (n) => `${n} incidentov`, page: (a, b) => `Strana ${a} z ${b}`, prev: "Predchádzajúca", next: "Ďalšia", search: "Hľadať", searchPlaceholder: "ID incidentu alebo profilu…", clear: "Vymazať", filters: "Filtre" },
    sort: { label: "Zoradiť", newest: "Najnovšie", oldest: "Najstaršie", severity: "Najvyššia závažnosť", urgency: "Najvyššia naliehavosť" },
    filter: { all: "Všetky", any: "Akékoľvek", status: "Stav", severity: "Závažnosť", urgency: "Naliehavosť", escalation: "Eskalácia", escalated: "Eskalované", notEscalated: "Neeskalované", profile: "ID profilu", from: "Od", to: "Do" },
    statusLabel: statusSk, severityLabel: sevSk, urgencyLabel: urgSk,
    detail: { back: "Všetky incidenty", overview: "Prehľad", assignment: "Priradenie", guardianDelivery: "Doručenie opatrovníkovi", recovery: "Obnova", signals: "Prepojené signály", escalations: "Eskalácie", notifications: "Interné upozornenia", auditSummary: "Odkazy na audit", executionSummary: "Vykonávací denník", timeline: "Časová os", notes: "Poznámky recenzenta", readOnly: "Iba na čítanie", noSignals: "Žiadne prepojené signály.", noEscalations: "Žiadne eskalácie.", noNotifications: "Žiadne upozornenia.", noAudit: "Žiadne odkazy na audit.", noNotes: "Zatiaľ žiadne poznámky.", deliveredTo: "Doručenia", ledgerSignals: "Sledované signály", ledgerCompleted: "Dokončené", ledgerDelivered: "Doručené", ledgerEscalated: "Eskalované", recoveryRepairs: "Opravy", recoveryIncomplete: "Nedokončené", linkedAt: "Prepojené", triggeredAt: "Spustené", confidence: "Dôvera" },
    actions: { assign: "Priradiť", assignToMe: "Priradiť mne", reassign: "Priradiť inému", unassign: "Odobrať", addNote: "Pridať poznámku", changeStatus: "Zmeniť stav", confirm: "Potvrdiť", cancel: "Zrušiť", working: "Pracuje sa…", assigneePlaceholder: "ID používateľa recenzenta", assignTitle: "Priradiť recenzenta", assignBody: "Priraďte tento incident recenzentovi. Zaznamená sa to do histórie incidentu.", statusTitle: (s) => `${s}?`, statusBody: (s) => `Zmeniť stav tohto incidentu na „${s}“. Zaznamená sa to do histórie incidentu.`, noteTitle: "Pridať poznámku recenzenta", statusConfirmBody: "Zaznamená sa to do histórie incidentu a nedá sa vrátiť späť okrem znovuotvorenia.", markdownHint: "Podporuje Markdown · iba interné · nedá sa upraviť ani zmazať", preview: "Náhľad", write: "Písať", notePlaceholder: "Pridať internú poznámku…", save: "Uložiť poznámku" },
    statusTarget: targetSk, tl: tlSk, errors: errSk,
  evidence: {
    tab: "Dôkazy", empty: "Zatiaľ žiadne dôkazy.", upload: "Pridať dôkaz", uploadTitle: "Pridať dôkaz", type: "Typ", label: "Označenie", file: "Súbor", url: "URL", text: "Text",
    typeLabel: { uploaded_file: "Súbor", screenshot: "Snímka obrazovky", external_url: "Externá URL", manual: "Manuálny", system: "Systémový" },
    sourceLabel: { reviewer_upload: "Nahranie recenzentom", system: "Systém", external: "Externý" },
    integrityLabel: { unverified: "Neoverené", verified: "Overené", failed: "Zlyhalo" },
    custodyLabel: { created: "Vytvorené", verified: "Overené", reviewed: "Prezreté", referenced: "Odkázané", exported: "Exportované", sealed: "Zapečatené" },
    chain: "#", hash: "Hash", integrity: "Integrita", sealed: "Zapečatené", sealedBadge: "Zapečatené", size: "Veľkosť", uploader: "Nahral", capturedAt: "Zachytené",
    preview: "Náhľad", download: "Stiahnuť", verify: "Overiť", seal: "Zapečatiť", export: "Exportovať balík", custodyChain: "Reťaz dôkazov", noCustody: "Žiadne udalosti.",
    filterType: "Typ", filterSource: "Zdroj", search: "Hľadať", searchPlaceholder: "Označenie alebo id…", all: "Všetky", readOnly: "Iba na čítanie", verifying: "Overuje sa…", working: "Pracuje sa…", labelPlaceholder: "Krátke označenie (voliteľné)", textPlaceholder: "Text dôkazu recenzenta…", urlPlaceholder: "https://…", addBtn: "Pridať",
  },
  },
  de: {
    title: "Kinderschutz-Prüferkonsole", subtitle: "Kanonische Kinderschutz-Vorfälle untersuchen und bearbeiten.",
    unauthorized: { badge: "403 · Zugriff verweigert", title: "Prüferzugriff erforderlich", body: "Diese Konsole ist auf Workspace-Eigentümer, Administratoren und Sicherheitsprüfer beschränkt.", cta: "Zurück zum Dashboard" },
    loading: "Wird geladen…", errorTitle: "Etwas ist schiefgelaufen", errorBody: "Die Prüferkonsole konnte nicht geladen werden. Bitte erneut versuchen.", retry: "Erneut versuchen",
    cards: { open: "Offene Vorfälle", escalated: "Eskaliert", critical: "Kritisch", resolvedToday: "Heute gelöst", avgResponse: "Ø Reaktion", avgResolution: "Ø Lösung", signals24h: "Signale (24h)", deliveries: "Zustellungen", topFamilies: "Top-Risikofamilien", none: "Keine" },
    table: { id: "Vorfall", created: "Erstellt", updated: "Aktualisiert", profile: "Profil", severity: "Schweregrad", urgency: "Dringlichkeit", status: "Status", escalation: "Eskalation", assigned: "Zugewiesen", signals: "Signale", unassigned: "Nicht zugewiesen", open: "Öffnen" },
    list: { empty: "Keine Vorfälle", emptyHint: "Keine Kinderschutz-Vorfälle entsprechen Ihren Filtern.", results: (n) => `${n} Vorfälle`, page: (a, b) => `Seite ${a} von ${b}`, prev: "Zurück", next: "Weiter", search: "Suchen", searchPlaceholder: "Vorfall- oder Profil-ID…", clear: "Löschen", filters: "Filter" },
    sort: { label: "Sortieren", newest: "Neueste", oldest: "Älteste", severity: "Höchster Schweregrad", urgency: "Höchste Dringlichkeit" },
    filter: { all: "Alle", any: "Beliebig", status: "Status", severity: "Schweregrad", urgency: "Dringlichkeit", escalation: "Eskalation", escalated: "Eskaliert", notEscalated: "Nicht eskaliert", profile: "Profil-ID", from: "Von", to: "Bis" },
    statusLabel: statusDe, severityLabel: sevDe, urgencyLabel: urgDe,
    detail: { back: "Alle Vorfälle", overview: "Übersicht", assignment: "Zuweisung", guardianDelivery: "Zustellung", recovery: "Wiederherstellung", signals: "Verknüpfte Signale", escalations: "Eskalationen", notifications: "Interne Benachrichtigungen", auditSummary: "Audit-Referenzen", executionSummary: "Ausführungsprotokoll", timeline: "Zeitachse", notes: "Prüfernotizen", readOnly: "Schreibgeschützt", noSignals: "Keine verknüpften Signale.", noEscalations: "Keine Eskalationen.", noNotifications: "Keine Benachrichtigungen.", noAudit: "Keine Audit-Referenzen.", noNotes: "Noch keine Notizen.", deliveredTo: "Zustellungen", ledgerSignals: "Erfasste Signale", ledgerCompleted: "Abgeschlossen", ledgerDelivered: "Zugestellt", ledgerEscalated: "Eskaliert", recoveryRepairs: "Reparaturen", recoveryIncomplete: "Unvollständig", linkedAt: "Verknüpft", triggeredAt: "Ausgelöst", confidence: "Konfidenz" },
    actions: { assign: "Zuweisen", assignToMe: "Mir zuweisen", reassign: "Neu zuweisen", unassign: "Zuweisung aufheben", addNote: "Notiz hinzufügen", changeStatus: "Status ändern", confirm: "Bestätigen", cancel: "Abbrechen", working: "Wird ausgeführt…", assigneePlaceholder: "Prüfer-Benutzer-ID", assignTitle: "Prüfer zuweisen", assignBody: "Diesen Vorfall einem Prüfer zuweisen. Dies wird im Verlauf des Vorfalls erfasst.", statusTitle: (s) => `${s}?`, statusBody: (s) => `Status dieses Vorfalls auf „${s}“ ändern. Dies wird im Verlauf erfasst.`, noteTitle: "Prüfernotiz hinzufügen", statusConfirmBody: "Dies wird im Verlauf erfasst und kann nur durch Wiedereröffnen rückgängig gemacht werden.", markdownHint: "Markdown unterstützt · nur intern · kann nicht bearbeitet oder gelöscht werden", preview: "Vorschau", write: "Schreiben", notePlaceholder: "Interne Notiz hinzufügen…", save: "Notiz speichern" },
    statusTarget: targetDe, tl: tlDe, errors: errDe,
  evidence: {
    tab: "Beweise", empty: "Noch keine Beweise.", upload: "Beweis hinzufügen", uploadTitle: "Beweis hinzufügen", type: "Typ", label: "Bezeichnung", file: "Datei", url: "URL", text: "Text",
    typeLabel: { uploaded_file: "Datei", screenshot: "Screenshot", external_url: "Externe URL", manual: "Manuell", system: "System" },
    sourceLabel: { reviewer_upload: "Prüfer-Upload", system: "System", external: "Extern" },
    integrityLabel: { unverified: "Ungeprüft", verified: "Verifiziert", failed: "Fehlgeschlagen" },
    custodyLabel: { created: "Erstellt", verified: "Verifiziert", reviewed: "Geprüft", referenced: "Referenziert", exported: "Exportiert", sealed: "Versiegelt" },
    chain: "#", hash: "Hash", integrity: "Integrität", sealed: "Versiegelt", sealedBadge: "Versiegelt", size: "Größe", uploader: "Hochgeladen von", capturedAt: "Erfasst",
    preview: "Vorschau", download: "Herunterladen", verify: "Verifizieren", seal: "Versiegeln", export: "Paket exportieren", custodyChain: "Beweiskette", noCustody: "Keine Ereignisse.",
    filterType: "Typ", filterSource: "Quelle", search: "Suchen", searchPlaceholder: "Bezeichnung oder ID…", all: "Alle", readOnly: "Schreibgeschützt", verifying: "Wird verifiziert…", working: "Wird ausgeführt…", labelPlaceholder: "Kurze Bezeichnung (optional)", textPlaceholder: "Prüfer-Beweistext…", urlPlaceholder: "https://…", addBtn: "Hinzufügen",
  },
  },
};
