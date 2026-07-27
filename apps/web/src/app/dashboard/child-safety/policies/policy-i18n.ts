/**
 * Child Safety Policy Engine V1 — localized copy (en/sk/de). Identical key structure across all three
 * locales (asserted by the UI test). Content-free labels only; no raw backend enums are rendered directly.
 */
import type { Locale } from "@/i18n/config";

export const POLICY_ERROR_CODES = [
  "forbidden", "unauthenticated", "not_found", "internal", "too_large",
  "invalid_definition", "not_draft", "not_pending", "two_person_required", "approval_required",
  "activation_conflict", "duplicate_policy_key", "bad_policy_key", "purpose_mismatch", "unknown_action",
] as const;

export interface PolicyCopy {
  title: string; subtitle: string;
  unauthorized: { badge: string; title: string; body: string; cta: string };
  loading: string; errorTitle: string; errorBody: string; retry: string; backToConsole: string;
  privacyNotice: string; manualOnlyNotice: string; guardianNotice: string; immutableNotice: string; twoPersonNotice: string; prospectiveNotice: string;
  list: { empty: string; policyKey: string; purpose: string; activeVersion: string; status: string; lastActivation: string; versions: string; noActive: string; open: string };
  detail: { versions: string; version: string; created: string; submitted: string; activated: string; rejected: string; hash: string; engine: string; schema: string; immutable: string; supersedes: string; back: string; definition: string; noVersions: string };
  purpose: Record<string, string>;
  statusLabel: Record<string, string>;
  operator: Record<string, string>;
  effect: Record<string, string>;
  actions: { create: string; newVersion: string; edit: string; validate: string; simulate: string; submit: string; approve: string; reject: string; activate: string; confirm: string; cancel: string; working: string; save: string };
  editor: { title: string; definitionJson: string; help: string; validationOk: string; validationErrors: string; noExecutable: string };
  simulation: { title: string; run: string; addCase: string; matchedRules: string; effects: string; explanations: string; conflictTrace: string; noSideEffects: string; empty: string; caseLabel: string };
  approval: { submitTitle: string; submitBody: string; approveTitle: string; approveBody: string; rejectTitle: string; rejectBody: string; activateTitle: string; activateBody: string; reasonCode: string; confirmActivate: string };
  decisions: { title: string; context: string; policy: string; version: string; decision: string; evaluatedAt: string; empty: string; noRawInput: string };
  errors: Record<string, string>;
}

const purpose = {
  en: { SIGNAL_TRIAGE: "Signal triage", INCIDENT_CLASSIFICATION: "Incident classification", ESCALATION: "Escalation", PROTECTION_PLAN: "Protection plan", INTERVENTION_AUTHORIZATION: "Intervention authorization", GUARDIAN_CONTACT_ELIGIBILITY: "Guardian-contact eligibility" },
  sk: { SIGNAL_TRIAGE: "Triáž signálov", INCIDENT_CLASSIFICATION: "Klasifikácia incidentu", ESCALATION: "Eskalácia", PROTECTION_PLAN: "Ochranný plán", INTERVENTION_AUTHORIZATION: "Autorizácia intervencie", GUARDIAN_CONTACT_ELIGIBILITY: "Oprávnenie kontaktu opatrovníka" },
  de: { SIGNAL_TRIAGE: "Signal-Triage", INCIDENT_CLASSIFICATION: "Vorfallklassifizierung", ESCALATION: "Eskalation", PROTECTION_PLAN: "Schutzplan", INTERVENTION_AUTHORIZATION: "Interventionsautorisierung", GUARDIAN_CONTACT_ELIGIBILITY: "Kontaktberechtigung Erziehungsberechtigter" },
};
const status = {
  en: { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", ACTIVE: "Active", RETIRED: "Retired", REJECTED: "Rejected" },
  sk: { DRAFT: "Koncept", PENDING_APPROVAL: "Čaká na schválenie", ACTIVE: "Aktívna", RETIRED: "Vyradená", REJECTED: "Zamietnutá" },
  de: { DRAFT: "Entwurf", PENDING_APPROVAL: "Genehmigung ausstehend", ACTIVE: "Aktiv", RETIRED: "Zurückgezogen", REJECTED: "Abgelehnt" },
};
const operator = {
  en: { EQUALS: "equals", NOT_EQUALS: "not equals", IN: "in", NOT_IN: "not in", GREATER_THAN: "greater than", GREATER_THAN_OR_EQUAL: "≥", LESS_THAN: "less than", LESS_THAN_OR_EQUAL: "≤", EXISTS: "exists", NOT_EXISTS: "not exists" },
  sk: { EQUALS: "rovná sa", NOT_EQUALS: "nerovná sa", IN: "v množine", NOT_IN: "mimo množiny", GREATER_THAN: "väčšie ako", GREATER_THAN_OR_EQUAL: "≥", LESS_THAN: "menšie ako", LESS_THAN_OR_EQUAL: "≤", EXISTS: "existuje", NOT_EXISTS: "neexistuje" },
  de: { EQUALS: "gleich", NOT_EQUALS: "ungleich", IN: "in", NOT_IN: "nicht in", GREATER_THAN: "größer als", GREATER_THAN_OR_EQUAL: "≥", LESS_THAN: "kleiner als", LESS_THAN_OR_EQUAL: "≤", EXISTS: "vorhanden", NOT_EXISTS: "nicht vorhanden" },
};
const effect = {
  en: { CREATE_INCIDENT: "Create incident", UPDATE_INCIDENT: "Update incident", SET_RECOMMENDED_SEVERITY: "Recommend severity", SET_RECOMMENDED_URGENCY: "Recommend urgency", REQUIRE_REVIEW: "Require review", REQUIRE_SUPERVISOR_REVIEW: "Require supervisor review", CREATE_ESCALATION_RECOMMENDATION: "Recommend escalation", SET_ESCALATION_LEVEL: "Set escalation level", PROPOSE_PROTECTION_PLAN: "Propose protection plan", PROPOSE_PROTECTION_ACTION: "Propose protection action", ALLOW_AUTOMATIC_INTERVENTION: "Allow automatic intervention", REQUIRE_MANUAL_INTERVENTION_APPROVAL: "Require manual intervention approval", ALLOW_GUARDIAN_CONTACT_CONSIDERATION: "Allow guardian-contact consideration", PROHIBIT_GUARDIAN_CONTACT: "Prohibit guardian contact", MANUAL_ONLY: "Manual only", NO_ACTION: "No action" },
  sk: { CREATE_INCIDENT: "Vytvoriť incident", UPDATE_INCIDENT: "Aktualizovať incident", SET_RECOMMENDED_SEVERITY: "Odporúčaná závažnosť", SET_RECOMMENDED_URGENCY: "Odporúčaná naliehavosť", REQUIRE_REVIEW: "Vyžadovať posúdenie", REQUIRE_SUPERVISOR_REVIEW: "Vyžadovať posúdenie nadriadeným", CREATE_ESCALATION_RECOMMENDATION: "Odporučiť eskaláciu", SET_ESCALATION_LEVEL: "Nastaviť úroveň eskalácie", PROPOSE_PROTECTION_PLAN: "Navrhnúť ochranný plán", PROPOSE_PROTECTION_ACTION: "Navrhnúť ochrannú akciu", ALLOW_AUTOMATIC_INTERVENTION: "Povoliť automatickú intervenciu", REQUIRE_MANUAL_INTERVENTION_APPROVAL: "Vyžadovať manuálne schválenie intervencie", ALLOW_GUARDIAN_CONTACT_CONSIDERATION: "Povoliť zváženie kontaktu opatrovníka", PROHIBIT_GUARDIAN_CONTACT: "Zakázať kontakt opatrovníka", MANUAL_ONLY: "Iba manuálne", NO_ACTION: "Žiadna akcia" },
  de: { CREATE_INCIDENT: "Vorfall erstellen", UPDATE_INCIDENT: "Vorfall aktualisieren", SET_RECOMMENDED_SEVERITY: "Schweregrad empfehlen", SET_RECOMMENDED_URGENCY: "Dringlichkeit empfehlen", REQUIRE_REVIEW: "Prüfung erforderlich", REQUIRE_SUPERVISOR_REVIEW: "Aufsichtsprüfung erforderlich", CREATE_ESCALATION_RECOMMENDATION: "Eskalation empfehlen", SET_ESCALATION_LEVEL: "Eskalationsstufe setzen", PROPOSE_PROTECTION_PLAN: "Schutzplan vorschlagen", PROPOSE_PROTECTION_ACTION: "Schutzmaßnahme vorschlagen", ALLOW_AUTOMATIC_INTERVENTION: "Automatische Intervention erlauben", REQUIRE_MANUAL_INTERVENTION_APPROVAL: "Manuelle Interventionsfreigabe erforderlich", ALLOW_GUARDIAN_CONTACT_CONSIDERATION: "Kontakterwägung erlauben", PROHIBIT_GUARDIAN_CONTACT: "Kontakt verbieten", MANUAL_ONLY: "Nur manuell", NO_ACTION: "Keine Aktion" },
};
const errs = {
  en: { forbidden: "You don't have permission to do that.", unauthenticated: "Please sign in.", not_found: "Not found.", internal: "Something went wrong. Please try again.", too_large: "That request is too large.", invalid_definition: "The policy definition is invalid.", not_draft: "Only a draft may be edited or submitted.", not_pending: "Only a pending version may be approved, rejected, or activated.", two_person_required: "A different person must approve this version (two-person control).", approval_required: "An independent approval is required before activation.", activation_conflict: "Activation conflicted with another change. Please retry.", duplicate_policy_key: "That policy key already exists.", bad_policy_key: "Invalid policy key.", purpose_mismatch: "The definition purpose does not match the policy.", unknown_action: "Unknown action." },
  sk: { forbidden: "Na túto akciu nemáte oprávnenie.", unauthenticated: "Prihláste sa.", not_found: "Nenájdené.", internal: "Niečo sa pokazilo. Skúste znova.", too_large: "Požiadavka je príliš veľká.", invalid_definition: "Definícia politiky je neplatná.", not_draft: "Upraviť alebo odoslať možno iba koncept.", not_pending: "Schváliť, zamietnuť alebo aktivovať možno iba čakajúcu verziu.", two_person_required: "Túto verziu musí schváliť iná osoba (dvojpersonálna kontrola).", approval_required: "Pred aktiváciou sa vyžaduje nezávislé schválenie.", activation_conflict: "Aktivácia bola v konflikte s inou zmenou. Skúste znova.", duplicate_policy_key: "Takýto kľúč politiky už existuje.", bad_policy_key: "Neplatný kľúč politiky.", purpose_mismatch: "Účel definície sa nezhoduje s politikou.", unknown_action: "Neznáma akcia." },
  de: { forbidden: "Sie haben keine Berechtigung dafür.", unauthenticated: "Bitte anmelden.", not_found: "Nicht gefunden.", internal: "Etwas ist schiefgelaufen. Bitte erneut versuchen.", too_large: "Anfrage zu groß.", invalid_definition: "Die Richtliniendefinition ist ungültig.", not_draft: "Nur ein Entwurf kann bearbeitet oder eingereicht werden.", not_pending: "Nur eine ausstehende Version kann genehmigt, abgelehnt oder aktiviert werden.", two_person_required: "Eine andere Person muss diese Version genehmigen (Vier-Augen-Prinzip).", approval_required: "Vor der Aktivierung ist eine unabhängige Genehmigung erforderlich.", activation_conflict: "Aktivierung stand im Konflikt mit einer anderen Änderung. Bitte erneut versuchen.", duplicate_policy_key: "Dieser Richtlinienschlüssel existiert bereits.", bad_policy_key: "Ungültiger Richtlinienschlüssel.", purpose_mismatch: "Der Zweck der Definition passt nicht zur Richtlinie.", unknown_action: "Unbekannte Aktion." },
};

function build(locale: "en" | "sk" | "de", t: {
  title: string; subtitle: string; unauthorized: PolicyCopy["unauthorized"]; loading: string; errorTitle: string; errorBody: string; retry: string; backToConsole: string;
  privacyNotice: string; manualOnlyNotice: string; guardianNotice: string; immutableNotice: string; twoPersonNotice: string; prospectiveNotice: string;
  list: PolicyCopy["list"]; detail: PolicyCopy["detail"]; actions: PolicyCopy["actions"]; editor: PolicyCopy["editor"]; simulation: PolicyCopy["simulation"]; approval: PolicyCopy["approval"]; decisions: PolicyCopy["decisions"];
}): PolicyCopy {
  return { ...t, purpose: purpose[locale], statusLabel: status[locale], operator: operator[locale], effect: effect[locale], errors: errs[locale] };
}

export const POLICY_COPY: Record<Locale, PolicyCopy> = {
  en: build("en", {
    title: "Child Safety Policy Engine", subtitle: "Versioned, immutable, deterministic decision policies over canonical facts.",
    unauthorized: { badge: "403 · Access denied", title: "Policy access required", body: "Policy management is limited to workspace owners, administrators, and safety reviewers.", cta: "Back to console" },
    loading: "Loading…", errorTitle: "Something went wrong", errorBody: "The policy console couldn't load. Please try again.", retry: "Try again", backToConsole: "Reviewer console",
    privacyNotice: "The policy engine reads only bounded canonical facts — never raw communications, evidence, or notes.",
    manualOnlyNotice: "Serious cases can be marked manual-only; the engine never executes an intervention itself.",
    guardianNotice: "Policy can never bypass guardian authorization — existing authority checks remain mandatory.",
    immutableNotice: "This version is immutable and cannot be edited.",
    twoPersonNotice: "Two-person control: the submitter cannot approve or solely activate their own version.",
    prospectiveNotice: "Policy changes apply to future evaluations only; historical decisions keep their original version.",
    list: { empty: "No policies yet.", policyKey: "Policy key", purpose: "Purpose", activeVersion: "Active version", status: "Status", lastActivation: "Last activation", versions: "Versions", noActive: "No active version", open: "Open" },
    detail: { versions: "Versions", version: "Version", created: "Created", submitted: "Submitted", activated: "Activated", rejected: "Rejected", hash: "Definition hash", engine: "Engine", schema: "Schema", immutable: "Immutable", supersedes: "Supersedes", back: "All policies", definition: "Definition", noVersions: "No versions." },
    actions: { create: "Create policy", newVersion: "New version", edit: "Edit draft", validate: "Validate", simulate: "Simulate", submit: "Submit for approval", approve: "Approve", reject: "Reject", activate: "Activate", confirm: "Confirm", cancel: "Cancel", working: "Working…", save: "Save" },
    editor: { title: "Draft definition", definitionJson: "Policy definition (JSON)", help: "A bounded, validated rule structure. No scripts or expressions are allowed.", validationOk: "Definition is valid.", validationErrors: "Validation errors", noExecutable: "Policies are data — executable code is never accepted." },
    simulation: { title: "Simulation", run: "Run simulation", addCase: "Add case", matchedRules: "Matched rules", effects: "Merged effects", explanations: "Explanations", conflictTrace: "Conflict resolution", noSideEffects: "Simulation is side-effect free — nothing is created, escalated, or contacted.", empty: "No simulation yet.", caseLabel: "Case" },
    approval: { submitTitle: "Submit for approval", submitBody: "Submit this draft for independent approval. It becomes immutable.", approveTitle: "Approve version", approveBody: "Approve this version. A different person must approve than the one who submitted it.", rejectTitle: "Reject version", rejectBody: "Reject this version. It becomes immutable.", activateTitle: "Activate version", activateBody: "Activate this approved version. The current active version will be retired. This applies to future evaluations only.", reasonCode: "Reason code", confirmActivate: "Activate now" },
    decisions: { title: "Decision history", context: "Context", policy: "Policy", version: "Version", decision: "Decision", evaluatedAt: "Evaluated", empty: "No decisions recorded yet.", noRawInput: "Decision records store only a fingerprint and bounded codes — never raw facts." },
  }),
  sk: build("sk", {
    title: "Engine politík ochrany detí", subtitle: "Verzované, nemenné, deterministické rozhodovacie politiky nad kanonickými faktami.",
    unauthorized: { badge: "403 · Prístup zamietnutý", title: "Vyžaduje sa prístup k politikám", body: "Správa politík je len pre vlastníkov, administrátorov a bezpečnostných recenzentov.", cta: "Späť do konzoly" },
    loading: "Načítava sa…", errorTitle: "Niečo sa pokazilo", errorBody: "Konzolu politík sa nepodarilo načítať. Skúste znova.", retry: "Skúsiť znova", backToConsole: "Konzola recenzenta",
    privacyNotice: "Engine číta iba ohraničené kanonické fakty — nikdy nie surovú komunikáciu, dôkazy ani poznámky.",
    manualOnlyNotice: "Vážne prípady možno označiť iba na manuálne riešenie; engine nikdy sám nevykoná intervenciu.",
    guardianNotice: "Politika nikdy neobíde autorizáciu opatrovníka — existujúce kontroly zostávajú povinné.",
    immutableNotice: "Táto verzia je nemenná a nedá sa upraviť.",
    twoPersonNotice: "Dvojpersonálna kontrola: predkladateľ nemôže schváliť ani sám aktivovať vlastnú verziu.",
    prospectiveNotice: "Zmeny politiky platia iba pre budúce vyhodnotenia; historické rozhodnutia si ponechávajú pôvodnú verziu.",
    list: { empty: "Zatiaľ žiadne politiky.", policyKey: "Kľúč politiky", purpose: "Účel", activeVersion: "Aktívna verzia", status: "Stav", lastActivation: "Posledná aktivácia", versions: "Verzie", noActive: "Žiadna aktívna verzia", open: "Otvoriť" },
    detail: { versions: "Verzie", version: "Verzia", created: "Vytvorené", submitted: "Odoslané", activated: "Aktivované", rejected: "Zamietnuté", hash: "Hash definície", engine: "Engine", schema: "Schéma", immutable: "Nemenné", supersedes: "Nahrádza", back: "Všetky politiky", definition: "Definícia", noVersions: "Žiadne verzie." },
    actions: { create: "Vytvoriť politiku", newVersion: "Nová verzia", edit: "Upraviť koncept", validate: "Overiť", simulate: "Simulovať", submit: "Odoslať na schválenie", approve: "Schváliť", reject: "Zamietnuť", activate: "Aktivovať", confirm: "Potvrdiť", cancel: "Zrušiť", working: "Pracuje sa…", save: "Uložiť" },
    editor: { title: "Definícia konceptu", definitionJson: "Definícia politiky (JSON)", help: "Ohraničená, overená štruktúra pravidiel. Skripty ani výrazy nie sú povolené.", validationOk: "Definícia je platná.", validationErrors: "Chyby overenia", noExecutable: "Politiky sú dáta — spustiteľný kód sa nikdy neprijíma." },
    simulation: { title: "Simulácia", run: "Spustiť simuláciu", addCase: "Pridať prípad", matchedRules: "Zhodné pravidlá", effects: "Zlúčené efekty", explanations: "Vysvetlenia", conflictTrace: "Riešenie konfliktov", noSideEffects: "Simulácia je bez vedľajších účinkov — nič sa nevytvorí, neeskaluje ani nekontaktuje.", empty: "Zatiaľ žiadna simulácia.", caseLabel: "Prípad" },
    approval: { submitTitle: "Odoslať na schválenie", submitBody: "Odošlite tento koncept na nezávislé schválenie. Stane sa nemenným.", approveTitle: "Schváliť verziu", approveBody: "Schváľte túto verziu. Schváliť musí iná osoba než tá, ktorá ju odoslala.", rejectTitle: "Zamietnuť verziu", rejectBody: "Zamietnite túto verziu. Stane sa nemennou.", activateTitle: "Aktivovať verziu", activateBody: "Aktivujte túto schválenú verziu. Súčasná aktívna verzia bude vyradená. Platí iba pre budúce vyhodnotenia.", reasonCode: "Kód dôvodu", confirmActivate: "Aktivovať teraz" },
    decisions: { title: "História rozhodnutí", context: "Kontext", policy: "Politika", version: "Verzia", decision: "Rozhodnutie", evaluatedAt: "Vyhodnotené", empty: "Zatiaľ žiadne rozhodnutia.", noRawInput: "Záznamy rozhodnutí ukladajú iba odtlačok a ohraničené kódy — nikdy surové fakty." },
  }),
  de: build("de", {
    title: "Kinderschutz-Richtlinien-Engine", subtitle: "Versionierte, unveränderliche, deterministische Entscheidungsrichtlinien über kanonische Fakten.",
    unauthorized: { badge: "403 · Zugriff verweigert", title: "Richtlinienzugriff erforderlich", body: "Die Richtlinienverwaltung ist auf Eigentümer, Administratoren und Sicherheitsprüfer beschränkt.", cta: "Zurück zur Konsole" },
    loading: "Wird geladen…", errorTitle: "Etwas ist schiefgelaufen", errorBody: "Die Richtlinienkonsole konnte nicht geladen werden. Bitte erneut versuchen.", retry: "Erneut versuchen", backToConsole: "Prüferkonsole",
    privacyNotice: "Die Engine liest nur begrenzte kanonische Fakten — niemals rohe Kommunikation, Beweise oder Notizen.",
    manualOnlyNotice: "Schwerwiegende Fälle können als nur-manuell markiert werden; die Engine führt selbst nie eine Intervention aus.",
    guardianNotice: "Eine Richtlinie kann die Autorisierung des Erziehungsberechtigten nie umgehen — bestehende Prüfungen bleiben verpflichtend.",
    immutableNotice: "Diese Version ist unveränderlich und kann nicht bearbeitet werden.",
    twoPersonNotice: "Vier-Augen-Prinzip: Der Einreichende kann seine eigene Version nicht genehmigen oder allein aktivieren.",
    prospectiveNotice: "Richtlinienänderungen gelten nur für künftige Auswertungen; historische Entscheidungen behalten ihre ursprüngliche Version.",
    list: { empty: "Noch keine Richtlinien.", policyKey: "Richtlinienschlüssel", purpose: "Zweck", activeVersion: "Aktive Version", status: "Status", lastActivation: "Letzte Aktivierung", versions: "Versionen", noActive: "Keine aktive Version", open: "Öffnen" },
    detail: { versions: "Versionen", version: "Version", created: "Erstellt", submitted: "Eingereicht", activated: "Aktiviert", rejected: "Abgelehnt", hash: "Definitions-Hash", engine: "Engine", schema: "Schema", immutable: "Unveränderlich", supersedes: "Ersetzt", back: "Alle Richtlinien", definition: "Definition", noVersions: "Keine Versionen." },
    actions: { create: "Richtlinie erstellen", newVersion: "Neue Version", edit: "Entwurf bearbeiten", validate: "Validieren", simulate: "Simulieren", submit: "Zur Genehmigung einreichen", approve: "Genehmigen", reject: "Ablehnen", activate: "Aktivieren", confirm: "Bestätigen", cancel: "Abbrechen", working: "Wird ausgeführt…", save: "Speichern" },
    editor: { title: "Entwurfsdefinition", definitionJson: "Richtliniendefinition (JSON)", help: "Eine begrenzte, validierte Regelstruktur. Skripte oder Ausdrücke sind nicht erlaubt.", validationOk: "Definition ist gültig.", validationErrors: "Validierungsfehler", noExecutable: "Richtlinien sind Daten — ausführbarer Code wird nie akzeptiert." },
    simulation: { title: "Simulation", run: "Simulation starten", addCase: "Fall hinzufügen", matchedRules: "Getroffene Regeln", effects: "Zusammengeführte Effekte", explanations: "Erläuterungen", conflictTrace: "Konfliktauflösung", noSideEffects: "Die Simulation ist nebenwirkungsfrei — nichts wird erstellt, eskaliert oder kontaktiert.", empty: "Noch keine Simulation.", caseLabel: "Fall" },
    approval: { submitTitle: "Zur Genehmigung einreichen", submitBody: "Diesen Entwurf zur unabhängigen Genehmigung einreichen. Er wird unveränderlich.", approveTitle: "Version genehmigen", approveBody: "Diese Version genehmigen. Eine andere Person als der Einreichende muss genehmigen.", rejectTitle: "Version ablehnen", rejectBody: "Diese Version ablehnen. Sie wird unveränderlich.", activateTitle: "Version aktivieren", activateBody: "Diese genehmigte Version aktivieren. Die aktuelle aktive Version wird zurückgezogen. Gilt nur für künftige Auswertungen.", reasonCode: "Begründungscode", confirmActivate: "Jetzt aktivieren" },
    decisions: { title: "Entscheidungsverlauf", context: "Kontext", policy: "Richtlinie", version: "Version", decision: "Entscheidung", evaluatedAt: "Ausgewertet", empty: "Noch keine Entscheidungen erfasst.", noRawInput: "Entscheidungsdatensätze speichern nur einen Fingerabdruck und begrenzte Codes — niemals rohe Fakten." },
  }),
};
