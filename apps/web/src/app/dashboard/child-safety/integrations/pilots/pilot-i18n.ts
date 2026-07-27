/**
 * Child Safety Partner Pilot Operations V1 — localized copy (en/sk/de), identical key structure across
 * locales (asserted by the UI test). Content-free labels only; no raw backend enum is ever rendered.
 */
import type { Locale } from "@/i18n/config";

type Dict = Record<string, string>;
export interface PilotCopy {
  title: string; subtitle: string; back: string;
  unauthorized: { title: string; body: string; cta: string };
  privacyWarnings: string[];
  sections: { overview: string; scope: string; assessments: string; readiness: string; tests: string; installations: string; contacts: string; alerts: string; history: string; controls: string; create: string };
  fields: { partner: string; application: string; environment: string; status: string; readiness: string; capabilities: string; categories: string; requestedAt: string; reviewDate: string; endDate: string; startDate: string; alertSeverity: string; volumeBand: string; rateBand: string; empty: string; noBlocking: string; evidenceRef: string; comment: string; role: string; displayName: string; businessEmail: string; when: string; count: string; version: string };
  statusLabel: Dict; checkLabel: Dict; checkStatusLabel: Dict; readinessLabel: Dict; blockingLabel: Dict;
  alertTypeLabel: Dict; severityLabel: Dict; contactRoleLabel: Dict; testTypeLabel: Dict; testResultLabel: Dict;
  assessmentLabel: Dict; bandLabel: Dict; actionLabel: Dict; nonWaivable: string;
  confirm: { activate: string; suspend: string; terminate: string; waive: string; confirm: string; cancel: string; working: string };
  errorRef: Dict;
}

const statusLabel = {
  en: { DRAFT: "Draft", SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", CHANGES_REQUIRED: "Changes required", APPROVED_FOR_SANDBOX: "Approved for sandbox", SANDBOX_ACTIVE: "Sandbox active", READINESS_REVIEW: "Readiness review", READY_FOR_PILOT: "Ready for pilot", PILOT_ACTIVE: "Pilot active", PILOT_PAUSED: "Paused", SUSPENDED: "Suspended", TERMINATED: "Terminated", REJECTED: "Rejected" },
  sk: { DRAFT: "Návrh", SUBMITTED: "Odoslané", UNDER_REVIEW: "V posudzovaní", CHANGES_REQUIRED: "Vyžaduje zmeny", APPROVED_FOR_SANDBOX: "Schválené pre sandbox", SANDBOX_ACTIVE: "Sandbox aktívny", READINESS_REVIEW: "Kontrola pripravenosti", READY_FOR_PILOT: "Pripravené na pilot", PILOT_ACTIVE: "Pilot aktívny", PILOT_PAUSED: "Pozastavené", SUSPENDED: "Pozastavené (bezpečnostne)", TERMINATED: "Ukončené", REJECTED: "Zamietnuté" },
  de: { DRAFT: "Entwurf", SUBMITTED: "Eingereicht", UNDER_REVIEW: "In Prüfung", CHANGES_REQUIRED: "Änderungen erforderlich", APPROVED_FOR_SANDBOX: "Für Sandbox freigegeben", SANDBOX_ACTIVE: "Sandbox aktiv", READINESS_REVIEW: "Bereitschaftsprüfung", READY_FOR_PILOT: "Bereit für Pilot", PILOT_ACTIVE: "Pilot aktiv", PILOT_PAUSED: "Pausiert", SUSPENDED: "Ausgesetzt", TERMINATED: "Beendet", REJECTED: "Abgelehnt" },
};
const checkLabel = {
  en: { AUTHORIZATION_CONFIRMED: "Authorization confirmed", DATA_MINIMIZATION_CONFIRMED: "Data minimization confirmed", RAW_CONTENT_EXCLUSION_CONFIRMED: "Raw-content exclusion confirmed", PRIVATE_KEY_OWNERSHIP_CONFIRMED: "Private-key ownership confirmed", SIGNATURE_COMPATIBILITY_CONFIRMED: "Signature compatibility confirmed", REPLAY_PROTECTION_CONFIRMED: "Replay protection confirmed", IDEMPOTENCY_CONFIRMED: "Idempotency confirmed", RATE_LIMIT_PLAN_CONFIRMED: "Rate-limit plan confirmed", SUBJECT_LINKING_MODEL_CONFIRMED: "Subject-linking model confirmed", INCIDENT_ROUTING_CONFIRMED: "Incident routing confirmed", SANDBOX_TEST_COMPLETED: "Sandbox test completed", OPERATIONAL_CONTACT_CONFIRMED: "Operational contact confirmed", INCIDENT_RESPONSE_CONTACT_CONFIRMED: "Incident-response contact confirmed", DATA_RETENTION_CONFIRMED: "Data retention confirmed", REGIONAL_SCOPE_CONFIRMED: "Regional scope confirmed", PILOT_EXIT_PLAN_CONFIRMED: "Pilot exit plan confirmed" },
  sk: { AUTHORIZATION_CONFIRMED: "Autorizácia potvrdená", DATA_MINIMIZATION_CONFIRMED: "Minimalizácia dát potvrdená", RAW_CONTENT_EXCLUSION_CONFIRMED: "Vylúčenie surového obsahu potvrdené", PRIVATE_KEY_OWNERSHIP_CONFIRMED: "Vlastníctvo súkromného kľúča potvrdené", SIGNATURE_COMPATIBILITY_CONFIRMED: "Kompatibilita podpisu potvrdená", REPLAY_PROTECTION_CONFIRMED: "Ochrana proti opakovaniu potvrdená", IDEMPOTENCY_CONFIRMED: "Idempotencia potvrdená", RATE_LIMIT_PLAN_CONFIRMED: "Plán limitov potvrdený", SUBJECT_LINKING_MODEL_CONFIRMED: "Model prepojenia subjektu potvrdený", INCIDENT_ROUTING_CONFIRMED: "Smerovanie incidentov potvrdené", SANDBOX_TEST_COMPLETED: "Sandbox test dokončený", OPERATIONAL_CONTACT_CONFIRMED: "Prevádzkový kontakt potvrdený", INCIDENT_RESPONSE_CONTACT_CONFIRMED: "Kontakt reakcie na incident potvrdený", DATA_RETENTION_CONFIRMED: "Uchovávanie dát potvrdené", REGIONAL_SCOPE_CONFIRMED: "Regionálny rozsah potvrdený", PILOT_EXIT_PLAN_CONFIRMED: "Plán ukončenia pilotu potvrdený" },
  de: { AUTHORIZATION_CONFIRMED: "Autorisierung bestätigt", DATA_MINIMIZATION_CONFIRMED: "Datenminimierung bestätigt", RAW_CONTENT_EXCLUSION_CONFIRMED: "Rohinhalt-Ausschluss bestätigt", PRIVATE_KEY_OWNERSHIP_CONFIRMED: "Eigentum am privaten Schlüssel bestätigt", SIGNATURE_COMPATIBILITY_CONFIRMED: "Signaturkompatibilität bestätigt", REPLAY_PROTECTION_CONFIRMED: "Replay-Schutz bestätigt", IDEMPOTENCY_CONFIRMED: "Idempotenz bestätigt", RATE_LIMIT_PLAN_CONFIRMED: "Ratenlimit-Plan bestätigt", SUBJECT_LINKING_MODEL_CONFIRMED: "Subjektverknüpfungsmodell bestätigt", INCIDENT_ROUTING_CONFIRMED: "Incident-Routing bestätigt", SANDBOX_TEST_COMPLETED: "Sandbox-Test abgeschlossen", OPERATIONAL_CONTACT_CONFIRMED: "Betriebskontakt bestätigt", INCIDENT_RESPONSE_CONTACT_CONFIRMED: "Incident-Response-Kontakt bestätigt", DATA_RETENTION_CONFIRMED: "Datenaufbewahrung bestätigt", REGIONAL_SCOPE_CONFIRMED: "Regionaler Geltungsbereich bestätigt", PILOT_EXIT_PLAN_CONFIRMED: "Pilot-Ausstiegsplan bestätigt" },
};
const checkStatusLabel = {
  en: { NOT_STARTED: "Not started", IN_REVIEW: "In review", PASSED: "Passed", FAILED: "Failed", WAIVED: "Waived" },
  sk: { NOT_STARTED: "Nezačaté", IN_REVIEW: "V posudzovaní", PASSED: "Prešlo", FAILED: "Zlyhalo", WAIVED: "Odpustené" },
  de: { NOT_STARTED: "Nicht begonnen", IN_REVIEW: "In Prüfung", PASSED: "Bestanden", FAILED: "Fehlgeschlagen", WAIVED: "Erlassen" },
};
const readinessLabel = {
  en: { READY: "Ready", BLOCKED: "Blocked", NOT_EVALUATED: "Not evaluated" },
  sk: { READY: "Pripravené", BLOCKED: "Blokované", NOT_EVALUATED: "Nevyhodnotené" },
  de: { READY: "Bereit", BLOCKED: "Blockiert", NOT_EVALUATED: "Nicht bewertet" },
};
const blockingLabel = {
  en: { AUTHORIZATION_INCOMPLETE: "Authorization incomplete", PRIVACY_REVIEW_INCOMPLETE: "Privacy review incomplete", SECURITY_REVIEW_INCOMPLETE: "Security review incomplete", REQUIRED_CHECK_FAILED: "A required check failed", REQUIRED_CHECK_MISSING: "A required check is missing", CAPABILITIES_NOT_APPROVED: "Capabilities not approved", INSTALLATION_INACTIVE: "No active installation", ACTIVE_KEY_MISSING: "No active signing key", COMPATIBILITY_TEST_MISSING: "Signature / payload compatibility test missing", IDEMPOTENCY_TEST_MISSING: "Idempotency test missing", REPLAY_TEST_MISSING: "Replay test missing", RATE_LIMIT_PROFILE_MISSING: "Rate-limit profile missing", SUBJECT_LINKING_NOT_READY: "Subject linking not ready", REQUIRED_CONTACT_MISSING: "A required contact is missing", CRITICAL_ALERT_OPEN: "An open critical alert" },
  sk: { AUTHORIZATION_INCOMPLETE: "Autorizácia nedokončená", PRIVACY_REVIEW_INCOMPLETE: "Kontrola súkromia nedokončená", SECURITY_REVIEW_INCOMPLETE: "Bezpečnostná kontrola nedokončená", REQUIRED_CHECK_FAILED: "Povinná kontrola zlyhala", REQUIRED_CHECK_MISSING: "Chýba povinná kontrola", CAPABILITIES_NOT_APPROVED: "Schopnosti neschválené", INSTALLATION_INACTIVE: "Žiadna aktívna inštalácia", ACTIVE_KEY_MISSING: "Žiadny aktívny podpisový kľúč", COMPATIBILITY_TEST_MISSING: "Chýba test kompatibility podpisu/obsahu", IDEMPOTENCY_TEST_MISSING: "Chýba test idempotencie", REPLAY_TEST_MISSING: "Chýba test opakovania", RATE_LIMIT_PROFILE_MISSING: "Chýba profil limitov", SUBJECT_LINKING_NOT_READY: "Prepojenie subjektu nie je pripravené", REQUIRED_CONTACT_MISSING: "Chýba povinný kontakt", CRITICAL_ALERT_OPEN: "Otvorené kritické upozornenie" },
  de: { AUTHORIZATION_INCOMPLETE: "Autorisierung unvollständig", PRIVACY_REVIEW_INCOMPLETE: "Datenschutzprüfung unvollständig", SECURITY_REVIEW_INCOMPLETE: "Sicherheitsprüfung unvollständig", REQUIRED_CHECK_FAILED: "Eine erforderliche Prüfung schlug fehl", REQUIRED_CHECK_MISSING: "Eine erforderliche Prüfung fehlt", CAPABILITIES_NOT_APPROVED: "Fähigkeiten nicht freigegeben", INSTALLATION_INACTIVE: "Keine aktive Installation", ACTIVE_KEY_MISSING: "Kein aktiver Signaturschlüssel", COMPATIBILITY_TEST_MISSING: "Signatur-/Nutzdaten-Kompatibilitätstest fehlt", IDEMPOTENCY_TEST_MISSING: "Idempotenztest fehlt", REPLAY_TEST_MISSING: "Replay-Test fehlt", RATE_LIMIT_PROFILE_MISSING: "Ratenlimit-Profil fehlt", SUBJECT_LINKING_NOT_READY: "Subjektverknüpfung nicht bereit", REQUIRED_CONTACT_MISSING: "Ein erforderlicher Kontakt fehlt", CRITICAL_ALERT_OPEN: "Ein offenes kritisches Warnsignal" },
};
const alertTypeLabel = {
  en: { INVALID_SIGNATURE_SPIKE: "Invalid-signature spike", REPLAY_ATTEMPT_SPIKE: "Replay-attempt spike", IDEMPOTENCY_CONFLICT_SPIKE: "Idempotency-conflict spike", RATE_LIMIT_SPIKE: "Rate-limit spike", REVOKED_KEY_USAGE: "Revoked-key usage", SUSPENDED_INSTALLATION_USAGE: "Suspended-installation usage", PROTOCOL_VERSION_MISMATCH: "Protocol-version mismatch", PILOT_SCOPE_VIOLATION: "Pilot-scope violation", SUBJECT_LINKING_FAILURE_SPIKE: "Subject-linking failure spike" },
  sk: { INVALID_SIGNATURE_SPIKE: "Nárast neplatných podpisov", REPLAY_ATTEMPT_SPIKE: "Nárast pokusov o opakovanie", IDEMPOTENCY_CONFLICT_SPIKE: "Nárast konfliktov idempotencie", RATE_LIMIT_SPIKE: "Nárast prekročení limitov", REVOKED_KEY_USAGE: "Použitie odvolaného kľúča", SUSPENDED_INSTALLATION_USAGE: "Použitie pozastavenej inštalácie", PROTOCOL_VERSION_MISMATCH: "Nezhoda verzie protokolu", PILOT_SCOPE_VIOLATION: "Porušenie rozsahu pilotu", SUBJECT_LINKING_FAILURE_SPIKE: "Nárast zlyhaní prepojenia subjektu" },
  de: { INVALID_SIGNATURE_SPIKE: "Anstieg ungültiger Signaturen", REPLAY_ATTEMPT_SPIKE: "Anstieg von Replay-Versuchen", IDEMPOTENCY_CONFLICT_SPIKE: "Anstieg von Idempotenzkonflikten", RATE_LIMIT_SPIKE: "Anstieg von Ratenlimit-Überschreitungen", REVOKED_KEY_USAGE: "Verwendung widerrufener Schlüssel", SUSPENDED_INSTALLATION_USAGE: "Verwendung ausgesetzter Installation", PROTOCOL_VERSION_MISMATCH: "Protokollversions-Konflikt", PILOT_SCOPE_VIOLATION: "Pilot-Geltungsbereichsverletzung", SUBJECT_LINKING_FAILURE_SPIKE: "Anstieg von Subjektverknüpfungsfehlern" },
};
const severityLabel = {
  en: { INFO: "Info", WARNING: "Warning", CRITICAL: "Critical" },
  sk: { INFO: "Info", WARNING: "Varovanie", CRITICAL: "Kritické" },
  de: { INFO: "Info", WARNING: "Warnung", CRITICAL: "Kritisch" },
};
const contactRoleLabel = {
  en: { TECHNICAL: "Technical", SECURITY: "Security", PRIVACY: "Privacy", INCIDENT_RESPONSE: "Incident response", LEGAL_AUTHORIZATION: "Legal / authorization" },
  sk: { TECHNICAL: "Technický", SECURITY: "Bezpečnosť", PRIVACY: "Súkromie", INCIDENT_RESPONSE: "Reakcia na incident", LEGAL_AUTHORIZATION: "Právne / autorizácia" },
  de: { TECHNICAL: "Technisch", SECURITY: "Sicherheit", PRIVACY: "Datenschutz", INCIDENT_RESPONSE: "Incident-Response", LEGAL_AUTHORIZATION: "Recht / Autorisierung" },
};
const testTypeLabel = {
  en: { SIGNATURE_COMPATIBILITY: "Signature compatibility", TIMESTAMP_WINDOW: "Timestamp window", NONCE_REPLAY: "Nonce replay", IDEMPOTENCY_DUPLICATE: "Idempotency duplicate", IDEMPOTENCY_CONFLICT: "Idempotency conflict", PAYLOAD_VALIDATION: "Payload validation", CAPABILITY_ENFORCEMENT: "Capability enforcement", SUBJECT_LINKING: "Subject linking", RATE_LIMIT_BEHAVIOR: "Rate-limit behavior" },
  sk: { SIGNATURE_COMPATIBILITY: "Kompatibilita podpisu", TIMESTAMP_WINDOW: "Časové okno", NONCE_REPLAY: "Opakovanie nonce", IDEMPOTENCY_DUPLICATE: "Duplikát idempotencie", IDEMPOTENCY_CONFLICT: "Konflikt idempotencie", PAYLOAD_VALIDATION: "Validácia obsahu", CAPABILITY_ENFORCEMENT: "Vynútenie schopnosti", SUBJECT_LINKING: "Prepojenie subjektu", RATE_LIMIT_BEHAVIOR: "Správanie limitov" },
  de: { SIGNATURE_COMPATIBILITY: "Signaturkompatibilität", TIMESTAMP_WINDOW: "Zeitstempelfenster", NONCE_REPLAY: "Nonce-Replay", IDEMPOTENCY_DUPLICATE: "Idempotenz-Duplikat", IDEMPOTENCY_CONFLICT: "Idempotenzkonflikt", PAYLOAD_VALIDATION: "Nutzdatenvalidierung", CAPABILITY_ENFORCEMENT: "Fähigkeitsdurchsetzung", SUBJECT_LINKING: "Subjektverknüpfung", RATE_LIMIT_BEHAVIOR: "Ratenlimit-Verhalten" },
};
const testResultLabel = {
  en: { PASSED: "Passed", FAILED: "Failed", SKIPPED: "Skipped" },
  sk: { PASSED: "Prešlo", FAILED: "Zlyhalo", SKIPPED: "Preskočené" },
  de: { PASSED: "Bestanden", FAILED: "Fehlgeschlagen", SKIPPED: "Übersprungen" },
};
const assessmentLabel = {
  en: { NOT_STARTED: "Not started", IN_REVIEW: "In review", APPROVED: "Approved", REJECTED: "Rejected" },
  sk: { NOT_STARTED: "Nezačaté", IN_REVIEW: "V posudzovaní", APPROVED: "Schválené", REJECTED: "Zamietnuté" },
  de: { NOT_STARTED: "Nicht begonnen", IN_REVIEW: "In Prüfung", APPROVED: "Genehmigt", REJECTED: "Abgelehnt" },
};
const bandLabel = {
  en: { VERY_LOW: "Very low", LOW: "Low", MEDIUM: "Medium", HIGH: "High" },
  sk: { VERY_LOW: "Veľmi nízke", LOW: "Nízke", MEDIUM: "Stredné", HIGH: "Vysoké" },
  de: { VERY_LOW: "Sehr niedrig", LOW: "Niedrig", MEDIUM: "Mittel", HIGH: "Hoch" },
};
const actionLabel = {
  en: { submit: "Submit", begin_review: "Begin review", request_changes: "Request changes", approve_sandbox: "Approve sandbox", activate_sandbox: "Activate sandbox", start_readiness: "Start readiness review", mark_ready: "Mark ready", activate: "Activate pilot", pause: "Pause", resume: "Resume", suspend: "Suspend", terminate: "Terminate", evaluate: "Evaluate readiness", run_test: "Run compatibility test" },
  sk: { submit: "Odoslať", begin_review: "Začať posudzovanie", request_changes: "Vyžiadať zmeny", approve_sandbox: "Schváliť sandbox", activate_sandbox: "Aktivovať sandbox", start_readiness: "Začať kontrolu pripravenosti", mark_ready: "Označiť pripravené", activate: "Aktivovať pilot", pause: "Pozastaviť", resume: "Obnoviť", suspend: "Pozastaviť (bezpečnostne)", terminate: "Ukončiť", evaluate: "Vyhodnotiť pripravenosť", run_test: "Spustiť test kompatibility" },
  de: { submit: "Einreichen", begin_review: "Prüfung beginnen", request_changes: "Änderungen anfordern", approve_sandbox: "Sandbox freigeben", activate_sandbox: "Sandbox aktivieren", start_readiness: "Bereitschaftsprüfung starten", mark_ready: "Als bereit markieren", activate: "Pilot aktivieren", pause: "Pausieren", resume: "Fortsetzen", suspend: "Aussetzen", terminate: "Beenden", evaluate: "Bereitschaft bewerten", run_test: "Kompatibilitätstest ausführen" },
};
const errorRef = {
  en: { bad_transition: "That action is not allowed from the current status.", not_ready: "Readiness is not satisfied — resolve all blockers first.", version_conflict: "The pilot changed in another tab — reload and retry.", check_not_waivable: "This is a critical check and can never be waived.", waive_requires_elevated: "Waiving a check requires an elevated role.", waiver_reason_required: "A waiver requires a bounded reason code.", pilot_already_exists: "This application already has an active pilot.", forbidden: "You do not have permission for this action.", not_found: "Not found.", terminal: "This pilot is in a terminal state and cannot change." },
  sk: { bad_transition: "Táto akcia nie je z aktuálneho stavu povolená.", not_ready: "Pripravenosť nie je splnená — najprv vyriešte všetky blokátory.", version_conflict: "Pilot sa zmenil v inej karte — obnovte a skúste znova.", check_not_waivable: "Toto je kritická kontrola a nikdy sa nedá odpustiť.", waive_requires_elevated: "Odpustenie kontroly vyžaduje vyššiu rolu.", waiver_reason_required: "Odpustenie vyžaduje ohraničený kód dôvodu.", pilot_already_exists: "Táto aplikácia už má aktívny pilot.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Nenájdené.", terminal: "Tento pilot je v koncovom stave a nedá sa zmeniť." },
  de: { bad_transition: "Diese Aktion ist im aktuellen Status nicht erlaubt.", not_ready: "Bereitschaft nicht erfüllt — zuerst alle Blocker beheben.", version_conflict: "Der Pilot wurde in einem anderen Tab geändert — neu laden und erneut versuchen.", check_not_waivable: "Dies ist eine kritische Prüfung und kann nie erlassen werden.", waive_requires_elevated: "Das Erlassen einer Prüfung erfordert eine erhöhte Rolle.", waiver_reason_required: "Ein Erlass erfordert einen begrenzten Begründungscode.", pilot_already_exists: "Diese Anwendung hat bereits einen aktiven Pilot.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Nicht gefunden.", terminal: "Dieser Pilot ist in einem Endzustand und kann nicht geändert werden." },
};

function build(l: "en" | "sk" | "de", t: Omit<PilotCopy, "statusLabel" | "checkLabel" | "checkStatusLabel" | "readinessLabel" | "blockingLabel" | "alertTypeLabel" | "severityLabel" | "contactRoleLabel" | "testTypeLabel" | "testResultLabel" | "assessmentLabel" | "bandLabel" | "actionLabel" | "errorRef">): PilotCopy {
  return { ...t, statusLabel: statusLabel[l], checkLabel: checkLabel[l], checkStatusLabel: checkStatusLabel[l], readinessLabel: readinessLabel[l], blockingLabel: blockingLabel[l], alertTypeLabel: alertTypeLabel[l], severityLabel: severityLabel[l], contactRoleLabel: contactRoleLabel[l], testTypeLabel: testTypeLabel[l], testResultLabel: testResultLabel[l], assessmentLabel: assessmentLabel[l], bandLabel: bandLabel[l], actionLabel: actionLabel[l], errorRef: errorRef[l] };
}

export const PILOT_COPY: Record<Locale, PilotCopy> = {
  en: build("en", {
    title: "Partner Pilots", subtitle: "Controlled, auditable partner onboarding and pilot lifecycle — content-free by construction.", back: "Integration console",
    unauthorized: { title: "Pilot access required", body: "This area is limited to workspace owners, administrators, safety reviewers, and (read-only) analysts.", cta: "Back to console" },
    privacyWarnings: [
      "Never enter raw communications, messages, transcripts, or media — this workflow is content-free.",
      "Never upload a private key — Tamanor stores only public keys; partners hold their own private key.",
      "Pilot approval does not by itself establish legal compliance.",
      "A risk signal describes a detected pattern, not proven guilt.",
      "No guardian or authority is contacted automatically.",
      "Activation is limited to the approved partner, application, installations, capabilities, categories, and pilot window.",
      "Sandbox and production environments are distinct.",
    ],
    sections: { overview: "Overview", scope: "Scope & approved capabilities", assessments: "Privacy / security / legal", readiness: "Readiness checklist", tests: "Compatibility tests", installations: "Installations & keys", contacts: "Operational contacts", alerts: "Operational alerts", history: "Activity history", controls: "Pilot controls", create: "New pilot" },
    fields: { partner: "Partner", application: "Application", environment: "Environment", status: "Status", readiness: "Readiness", capabilities: "Capabilities", categories: "Risk categories", requestedAt: "Requested", reviewDate: "Review date", endDate: "End date", startDate: "Start date", alertSeverity: "Alerts", volumeBand: "Monthly volume", rateBand: "Peak rate", empty: "None yet.", noBlocking: "No blocking reasons.", evidenceRef: "Evidence", comment: "Comment", role: "Role", displayName: "Name", businessEmail: "Business email", when: "When", count: "Count", version: "Version" },
    nonWaivable: "Non-waivable",
    confirm: { activate: "Activate this pilot for limited production traffic within the approved scope?", suspend: "Suspend this pilot? Production signal acceptance stops immediately.", terminate: "Terminate this pilot? This is irreversible.", waive: "Waive this check? A bounded reason is required and it will be audited.", confirm: "Confirm", cancel: "Cancel", working: "Working…" },
  }),
  sk: build("sk", {
    title: "Partnerské piloty", subtitle: "Kontrolovaný, auditovateľný proces onboardingu partnerov a životný cyklus pilotu — bez obsahu.", back: "Konzola integrácie",
    unauthorized: { title: "Vyžaduje sa prístup k pilotom", body: "Táto oblasť je len pre vlastníkov, administrátorov, bezpečnostných recenzentov a (len na čítanie) analytikov.", cta: "Späť do konzoly" },
    privacyWarnings: [
      "Nikdy nezadávajte surovú komunikáciu, správy, prepisy ani médiá — tento proces je bez obsahu.",
      "Nikdy nenahrávajte súkromný kľúč — Tamanor ukladá iba verejné kľúče; partneri majú vlastný súkromný kľúč.",
      "Schválenie pilotu samo o sebe nezakladá právny súlad.",
      "Rizikový signál opisuje zistený vzorec, nie dokázanú vinu.",
      "Žiadny opatrovník ani orgán nie je kontaktovaný automaticky.",
      "Aktivácia je obmedzená na schváleného partnera, aplikáciu, inštalácie, schopnosti, kategórie a okno pilotu.",
      "Prostredia sandbox a produkcia sú oddelené.",
    ],
    sections: { overview: "Prehľad", scope: "Rozsah a schválené schopnosti", assessments: "Súkromie / bezpečnosť / právne", readiness: "Kontrolný zoznam pripravenosti", tests: "Testy kompatibility", installations: "Inštalácie a kľúče", contacts: "Prevádzkové kontakty", alerts: "Prevádzkové upozornenia", history: "História aktivít", controls: "Ovládanie pilotu", create: "Nový pilot" },
    fields: { partner: "Partner", application: "Aplikácia", environment: "Prostredie", status: "Stav", readiness: "Pripravenosť", capabilities: "Schopnosti", categories: "Kategórie rizika", requestedAt: "Požiadané", reviewDate: "Dátum kontroly", endDate: "Dátum ukončenia", startDate: "Dátum začiatku", alertSeverity: "Upozornenia", volumeBand: "Mesačný objem", rateBand: "Špičková frekvencia", empty: "Zatiaľ žiadne.", noBlocking: "Žiadne blokujúce dôvody.", evidenceRef: "Dôkaz", comment: "Komentár", role: "Rola", displayName: "Meno", businessEmail: "Firemný email", when: "Kedy", count: "Počet", version: "Verzia" },
    nonWaivable: "Neodpustiteľné",
    confirm: { activate: "Aktivovať tento pilot pre obmedzenú produkčnú prevádzku v rámci schváleného rozsahu?", suspend: "Pozastaviť tento pilot? Prijímanie produkčných signálov sa okamžite zastaví.", terminate: "Ukončiť tento pilot? Toto je nezvratné.", waive: "Odpustiť túto kontrolu? Vyžaduje sa ohraničený dôvod a bude auditované.", confirm: "Potvrdiť", cancel: "Zrušiť", working: "Pracuje sa…" },
  }),
  de: build("de", {
    title: "Partner-Pilots", subtitle: "Kontrolliertes, prüfbares Partner-Onboarding und Pilot-Lebenszyklus — konstruktionsbedingt inhaltsfrei.", back: "Integrationskonsole",
    unauthorized: { title: "Pilot-Zugriff erforderlich", body: "Dieser Bereich ist auf Eigentümer, Administratoren, Sicherheitsprüfer und (schreibgeschützt) Analysten beschränkt.", cta: "Zurück zur Konsole" },
    privacyWarnings: [
      "Geben Sie niemals Rohkommunikation, Nachrichten, Transkripte oder Medien ein — dieser Ablauf ist inhaltsfrei.",
      "Laden Sie niemals einen privaten Schlüssel hoch — Tamanor speichert nur öffentliche Schlüssel; Partner besitzen ihren eigenen privaten Schlüssel.",
      "Eine Pilot-Freigabe begründet für sich allein keine rechtliche Konformität.",
      "Ein Risikosignal beschreibt ein erkanntes Muster, keine erwiesene Schuld.",
      "Kein Erziehungsberechtigter oder keine Behörde wird automatisch kontaktiert.",
      "Die Aktivierung ist auf den freigegebenen Partner, die Anwendung, Installationen, Fähigkeiten, Kategorien und das Pilotfenster beschränkt.",
      "Sandbox- und Produktionsumgebungen sind getrennt.",
    ],
    sections: { overview: "Übersicht", scope: "Geltungsbereich & freigegebene Fähigkeiten", assessments: "Datenschutz / Sicherheit / Recht", readiness: "Bereitschafts-Checkliste", tests: "Kompatibilitätstests", installations: "Installationen & Schlüssel", contacts: "Betriebskontakte", alerts: "Betriebswarnungen", history: "Aktivitätsverlauf", controls: "Pilot-Steuerung", create: "Neuer Pilot" },
    fields: { partner: "Partner", application: "Anwendung", environment: "Umgebung", status: "Status", readiness: "Bereitschaft", capabilities: "Fähigkeiten", categories: "Risikokategorien", requestedAt: "Angefordert", reviewDate: "Prüfdatum", endDate: "Enddatum", startDate: "Startdatum", alertSeverity: "Warnungen", volumeBand: "Monatsvolumen", rateBand: "Spitzenrate", empty: "Noch keine.", noBlocking: "Keine blockierenden Gründe.", evidenceRef: "Nachweis", comment: "Kommentar", role: "Rolle", displayName: "Name", businessEmail: "Geschäftliche E-Mail", when: "Wann", count: "Anzahl", version: "Version" },
    nonWaivable: "Nicht erlassbar",
    confirm: { activate: "Diesen Pilot für begrenzten Produktionsverkehr im freigegebenen Rahmen aktivieren?", suspend: "Diesen Pilot aussetzen? Die Annahme von Produktionssignalen stoppt sofort.", terminate: "Diesen Pilot beenden? Dies ist unumkehrbar.", waive: "Diese Prüfung erlassen? Ein begrenzter Grund ist erforderlich und wird protokolliert.", confirm: "Bestätigen", cancel: "Abbrechen", working: "Wird ausgeführt…" },
  }),
};
