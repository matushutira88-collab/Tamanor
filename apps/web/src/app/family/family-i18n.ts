import type { Locale } from "@/i18n";

/**
 * CS-C6 — Family console i18n (SK/EN/DE). Co-located like the other feature dictionaries
 * (ato-i18n / cb-i18n) so it is NOT counted in the main 1983-key i18n-check. Every Family UI
 * string — including raw-enum → human labels — lives here; the UI never renders raw enum values.
 */
export interface FamilyDict {
  brand: string; workspaceType: string; family: string; business: string;
  nav: { overview: string; profiles: string; guardians: string; authorizations: string; signals: string; deliveries: string; settings: string };
  chooser: { title: string; subtitle: string; familyTitle: string; familyText: string; familyCta: string; businessTitle: string; businessText: string; businessCta: string; familyBullets: string[]; businessBullets: string[] };
  onboarding: {
    title: string; stepOf: (a: number, b: number) => string; next: string; back: string; finish: string;
    welcomeTitle: string; welcomeText: string; welcomeCta: string;
    profileTitle: string; profileNameLabel: string; localeLabel: string; timezoneLabel: string;
    guardianTitle: string; guardianIntro: string; guardianC1: string; guardianC2: string; guardianC3: string;
    firstProfileTitle: string; firstProfileIntro: string; labelField: string; ageBandField: string; create: string;
    privacyTitle: string; doesTitle: string; doesnotTitle: string;
    completeTitle: string; completeText: string; goToDashboard: string;
  };
  dash: { welcome: string; onboardingIncomplete: string; primaryGuardian: string; kpiProfiles: string; kpiGuardians: string; kpiSignals: string; kpiPendingAuth: string; kpiDeliveries: string; recentProfiles: string; recentSignals: string; pendingAuth: string; deliveriesSection: string; emptyTitle: string; emptyText: string };
  privacy: { messages: string; signal: string; delivery: string; integrations: string };
  profiles: { title: string; create: string; label: string; ageBand: string; status: string; relationships: string; signals: string; created: string; detailTabs: { overview: string; guardians: string; consent: string; signals: string; deliveries: string }; archive: string; archived: string; newLabel: string; emptyText: string };
  guardians: { title: string; intro: string; pipeline: string[]; incomplete: string; relationship: string; authority: string; consent: string; assessment: string; eligibility: string };
  authorizations: { title: string; signal: string; profile: string; recipient: string; status: string; scope: string; reason: string; evaluatedAt: string; validUntil: string; revoke: string; emptyText: string };
  signals: { title: string; type: string; severity: string; confidence: string; bucket: string; review: string; created: string; disclaimer: string; emptyText: string; detailTitle: string };
  deliveries: { title: string; status: string; recipient: string; profile: string; signalType: string; scope: string; preparedAt: string; availableAt: string; acknowledgedAt: string; declinedAt: string; makeAvailable: string; acknowledge: string; decline: string; revoke: string; archive: string; availableMeans: string; emptyText: string };
  settings: { title: string; workspaceName: string; language: string; timezone: string; workspaceTypeRO: string; primaryGuardian: string; limits: string; auditLink: string };
  labels: {
    ageBand: Record<string, string>; protectionStatus: Record<string, string>; relationshipType: Record<string, string>;
    relationshipStatus: Record<string, string>; authorityStatus: Record<string, string>; consentStatus: Record<string, string>;
    assessmentStatus: Record<string, string>; eligibility: Record<string, string>; signalType: Record<string, string>;
    severity: Record<string, string>; confidence: Record<string, string>; reviewStatus: Record<string, string>;
    decisionStatus: Record<string, string>; reasonCode: Record<string, string>; disclosureScope: Record<string, string>;
    deliveryStatus: Record<string, string>;
  };
  common: { back: string; view: string; loading: string; none: string; confirm: string; cancel: string; notAvailable: string };
  // CS-C6.1 — the fail-closed page shown when the workspace kind is unknown/corrupt/unsupported.
  unsupported: { title: string; body: string; explain: string; logout: string; help: string };
  // CS-C6.1 — accessible confirmation dialogs for the 4 destructive Family actions (no window.confirm).
  dialog: {
    confirm: string; cancel: string; working: string; errorTitle: string;
    archiveProfileTitle: string; archiveProfileBody: string; archiveProfileConfirm: string;
    revokeAuthTitle: string; revokeAuthBody: string; revokeAuthConfirm: string;
    revokeDeliveryTitle: string; revokeDeliveryBody: string; revokeDeliveryConfirm: string;
    archiveDeliveryTitle: string; archiveDeliveryBody: string; archiveDeliveryConfirm: string;
    restoreProfileTitle: string; restoreProfileBody: string; restoreProfileConfirm: string;
    deactivateGuardianTitle: string; deactivateGuardianBody: string; deactivateGuardianConfirm: string;
  };
  // CS-C6.1 — Family route-level error boundary (safe, no stack/PII/tenant).
  errorBoundary: { title: string; body: string; retry: string; back: string };
  // CS-C6.1 — safe, serializable action-error groups → localized text (never raw/DB/PII details).
  actionErrors: Record<string, string>;
  // CS-C7 — profile lifecycle + guardian workflow UI (content-free).
  c7: {
    editTitle: string; edit: string; save: string; noPiiHint: string; languageAuto: string;
    restore: string; restored: string;
    searchTitle: string; searchPlaceholder: string; filterAge: string; filterStatus: string; filterLanguage: string; filterState: string; filterRole: string;
    stateActive: string; stateArchived: string; stateAll: string; anyOption: string; apply: string; clear: string;
    guardiansTitle: string; addGuardian: string; guardianMember: string; roleLabel: string; relationshipLabel: string; authorityLabel: string;
    create: string; changeRole: string; deactivate: string; reactivate: string;
    noGuardians: string; noMembers: string; guardianAddHint: string;
    timelineTitle: string; timelineEmpty: string; timelineBy: string;
    roles: Record<string, string>; authority: Record<string, string>; lifecycle: Record<string, string>; events: Record<string, string>;
  };
}

/** CS-C6.1 — the ONLY safe, serializable Family action-error groups the UI may surface. */
export const FAMILY_ACTION_ERROR_CODES = [
  "forbidden", "not_found", "invalid_state", "authorization_not_effective",
  "archived", "already_revoked", "retry_later",
] as const;
export type FamilyActionErrorCode = (typeof FAMILY_ACTION_ERROR_CODES)[number];
export function isFamilyActionErrorCode(v: unknown): v is FamilyActionErrorCode {
  return typeof v === "string" && (FAMILY_ACTION_ERROR_CODES as readonly string[]).includes(v);
}

const en: FamilyDict = {
  brand: "Tamanor Family", workspaceType: "Workspace type", family: "Family", business: "Business",
  nav: { overview: "Overview", profiles: "Protected profiles", guardians: "Authorized people", authorizations: "Authorizations", signals: "Safety signals", deliveries: "Internal deliveries", settings: "Settings" },
  chooser: { title: "How would you like to use Tamanor?", subtitle: "Choose the mode that fits you. This decides your product and cannot be changed later.", familyTitle: "Tamanor Family", familyText: "Helps a family safely manage protected profiles, authorized people and safety information.", familyCta: "Continue as a family", businessTitle: "Tamanor Business", businessText: "Protects business accounts, comments and online reputation from spam, scams and harmful content.", businessCta: "Continue as a business", familyBullets: ["Protected profiles for family members", "Authorized recipient management", "Safety signals", "A private family space"], businessBullets: ["Manage business accounts", "Analyze risky comments", "Brand protection", "Team and agency options by plan"] },
  onboarding: {
    title: "Set up Tamanor Family", stepOf: (a, b) => `Step ${a} of ${b}`, next: "Continue", back: "Back", finish: "Finish setup",
    welcomeTitle: "Welcome to Tamanor Family", welcomeText: "Tamanor Family helps you safely manage protected profiles, authorized people and minimal safety information in a family setting.", welcomeCta: "Start setup",
    profileTitle: "Family profile", profileNameLabel: "Household / family workspace name", localeLabel: "Preferred language", timezoneLabel: "Time zone",
    guardianTitle: "Primary guardian confirmation", guardianIntro: "Please confirm the following:", guardianC1: "I manage this Family workspace.", guardianC2: "I will act in line with authorizations and consents.", guardianC3: "I understand a parent role alone does not grant access to all information — Tamanor uses authority, consent and safe-recipient rules.",
    firstProfileTitle: "First protected profile", firstProfileIntro: "Create a first protected profile. Only a safe label and an age band are needed — no social accounts, phone or messages.", labelField: "Display label", ageBandField: "Age band", create: "Create profile",
    privacyTitle: "Privacy and limits", doesTitle: "Tamanor Family now:", doesnotTitle: "Tamanor Family does NOT:",
    completeTitle: "You're all set", completeText: "Your family workspace is ready.", goToDashboard: "Go to Family dashboard",
  },
  dash: { welcome: "Your family space", onboardingIncomplete: "Finish setup", primaryGuardian: "Primary guardian", kpiProfiles: "Protected profiles", kpiGuardians: "Active authorized people", kpiSignals: "Safety signals", kpiPendingAuth: "Pending authorizations", kpiDeliveries: "Available internal deliveries", recentProfiles: "Protected profiles", recentSignals: "Recent safety signals", pendingAuth: "Pending authorization decisions", deliveriesSection: "Internal deliveries", emptyTitle: "Your family space is ready", emptyText: "Safety signals will appear here after a future authorized integration with a social or communication platform." },
  privacy: { messages: "Tamanor currently does not read private messages or monitor devices.", signal: "A safety signal contains only minimal structured information about a risk — not the content of communication.", delivery: "An internal delivery means information is made available inside Tamanor Family. It does NOT mean an email, SMS or push notification was sent.", integrations: "Integrations with social and communication platforms will only be available through official partnerships and authorized APIs." },
  profiles: { title: "Protected profiles", create: "New profile", label: "Label", ageBand: "Age band", status: "Status", relationships: "Guardians", signals: "Signals", created: "Created", detailTabs: { overview: "Overview", guardians: "Authorized people", consent: "Consent & authority", signals: "Safety signals", deliveries: "Internal deliveries" }, archive: "Archive", archived: "Archived", newLabel: "e.g. Younger child", emptyText: "No protected profiles yet. Create one to begin." },
  guardians: { title: "Authorized people", intro: "A guardian role alone is never automatically authorized. Each recipient passes an explicit chain:", pipeline: ["Relationship", "Authority", "Consent", "Safe-recipient assessment", "Authorization"], incomplete: "Setup will be completed in a later step.", relationship: "Relationship", authority: "Authority", consent: "Consent", assessment: "Assessment", eligibility: "Effective eligibility" },
  authorizations: { title: "Authorizations", signal: "Signal", profile: "Profile", recipient: "Recipient", status: "Status", scope: "Disclosure scope", reason: "Reason", evaluatedAt: "Evaluated", validUntil: "Valid until", revoke: "Revoke", emptyText: "No authorization decisions yet." },
  signals: { title: "Safety signals", type: "Risk type", severity: "Severity", confidence: "Confidence", bucket: "Time window", review: "Review", created: "Created", disclaimer: "This record contains only a minimal safety signal, not the content of communication.", emptyText: "No safety signals. Platform integrations are not active yet.", detailTitle: "Safety signal" },
  deliveries: { title: "Internal deliveries", status: "Status", recipient: "Recipient", profile: "Profile", signalType: "Risk type", scope: "Disclosure scope", preparedAt: "Prepared", availableAt: "Available", acknowledgedAt: "Acknowledged", declinedAt: "Declined", makeAvailable: "Make available", acknowledge: "Acknowledge", decline: "Decline", revoke: "Revoke", archive: "Archive", availableMeans: "\"Available\" means available inside Tamanor Family — not an email, SMS or push.", emptyText: "No internal deliveries yet." },
  settings: { title: "Settings", workspaceName: "Family workspace name", language: "Language", timezone: "Time zone", workspaceTypeRO: "Workspace type", primaryGuardian: "Primary guardian", limits: "Privacy & limitations", auditLink: "Audit log" },
  labels: {
    ageBand: { under_10: "Under 10", age_10_12: "10–12", age_13_15: "13–15", age_16_17: "16–17" },
    protectionStatus: { inactive: "Inactive", monitoring: "Monitoring", active: "Active", paused: "Paused" },
    relationshipType: { parent: "Parent", legal_guardian: "Legal guardian", trusted_adult: "Trusted adult", safety_professional: "Safety professional" },
    relationshipStatus: { pending: "Pending", verified: "Verified", suspended: "Suspended", revoked: "Revoked" },
    authorityStatus: { pending: "Pending", verified: "Verified", revoked: "Revoked", expired: "Expired", rejected: "Rejected", none: "Not set" },
    consentStatus: { not_requested: "Not requested", pending: "Pending", active: "Granted", withdrawn: "Withdrawn", expired: "Expired", disputed: "Disputed", suspended: "Suspended", none: "Not set" },
    assessmentStatus: { not_started: "Not started", pending: "Pending", approved: "Approved", rejected: "Rejected", revoked: "Revoked", expired: "Expired", none: "Not set" },
    eligibility: { eligible: "Eligible", requires_expert_review: "Needs expert review", suppressed: "Suppressed", not_verified: "Not verified", conflicted: "Conflicted" },
    signalType: { GROOMING: "Grooming", SEXUAL_SOLICITATION: "Sexual solicitation", SEXTORTION: "Sextortion", MEETING_ATTEMPT: "Meeting attempt", CYBERBULLYING: "Cyberbullying", THREAT: "Threat", IDENTITY_MANIPULATION: "Identity manipulation" },
    severity: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
    confidence: { unknown: "Unknown", low: "Low", medium: "Medium", high: "High" },
    reviewStatus: { new: "New", acknowledged: "Acknowledged", under_review: "Under review", dismissed: "Dismissed", confirmed_risk: "Confirmed risk", archived: "Archived" },
    decisionStatus: { pending: "Pending", authorized: "Authorized", denied: "Denied", revoked: "Revoked", expired: "Expired", superseded: "Superseded" },
    reasonCode: { complete_authorization_chain: "Complete authorization chain", no_active_guardian_relationship: "No active guardian relationship", no_valid_authority: "No valid authority", no_valid_consent: "No valid consent", no_approved_safe_recipient: "No approved safe recipient", inactive_membership: "Inactive membership", tenant_mismatch: "Tenant mismatch", profile_mismatch: "Profile mismatch", signal_archived: "Signal archived", consent_scope_insufficient: "Consent scope insufficient", recipient_role_not_allowed: "Recipient role not allowed", authorization_revoked: "Authorization revoked", superseded_by_new_decision: "Superseded by a new decision" },
    disclosureScope: { signal_existence: "Signal existence", risk_category: "Risk category", severity: "Severity", timing_bucket: "Time window", recommended_action_class: "Recommended action class" },
    deliveryStatus: { prepared: "Prepared", available: "Available", acknowledged: "Acknowledged", declined: "Declined", failed: "Failed", revoked: "Revoked", expired: "Expired", superseded: "Superseded", archived: "Archived" },
  },
  common: { back: "Back", view: "View", loading: "Loading…", none: "—", confirm: "Confirm", cancel: "Cancel", notAvailable: "Not available in this workspace" },
  unsupported: {
    title: "This workspace can't be opened",
    body: "Your account is signed in, but this workspace type isn't supported by the current app. Nothing was changed.",
    explain: "This can happen if the workspace was set up for a product area that isn't available here. Please sign out and sign in again, or contact support if this keeps happening.",
    logout: "Sign out", help: "Contact support",
  },
  dialog: {
    confirm: "Confirm", cancel: "Cancel", working: "Working…", errorTitle: "Action could not be completed",
    archiveProfileTitle: "Archive this protected profile?",
    archiveProfileBody: "Archiving stops new activity for this profile. Existing records are kept for history and this can be reviewed later. This does not delete anything.",
    archiveProfileConfirm: "Archive profile",
    revokeAuthTitle: "Revoke this authorization?",
    revokeAuthBody: "Revoking ends this recipient's authorization for this signal. Any related internal delivery becomes unavailable. This is recorded for audit.",
    revokeAuthConfirm: "Revoke authorization",
    revokeDeliveryTitle: "Revoke this internal delivery?",
    revokeDeliveryBody: "Revoking makes this internal delivery unavailable to the recipient inside Tamanor Family. This is recorded and cannot be undone.",
    revokeDeliveryConfirm: "Revoke delivery",
    archiveDeliveryTitle: "Archive this internal delivery?",
    archiveDeliveryBody: "Archiving removes this delivery from the active list. The record is kept for history. This does not delete anything.",
    archiveDeliveryConfirm: "Archive delivery",
    restoreProfileTitle: "Restore this profile?",
    restoreProfileBody: "Restoring brings this profile back to active. Its history and guardians are unchanged. The identifier stays the same.",
    restoreProfileConfirm: "Restore profile",
    deactivateGuardianTitle: "Deactivate this guardian?",
    deactivateGuardianBody: "Deactivating pauses this guardian relationship and removes its authorization until it is reactivated. Nothing is deleted and it can be reactivated later.",
    deactivateGuardianConfirm: "Deactivate guardian",
  },
  errorBoundary: {
    title: "Something went wrong",
    body: "This part of Tamanor Family couldn't be shown. No changes were lost. You can try again or go back to your family space.",
    retry: "Try again", back: "Back to family space",
  },
  actionErrors: {
    forbidden: "You don't have permission to do that.",
    not_found: "That item could not be found. It may have already been changed.",
    invalid_state: "This action isn't possible in the item's current state.",
    authorization_not_effective: "This authorization is not currently effective.",
    archived: "That item is already archived.",
    already_revoked: "That item has already been revoked.",
    retry_later: "Something went wrong. Please try again in a moment.",
  },
  c7: {
    editTitle: "Edit profile", edit: "Edit", save: "Save changes",
    noPiiHint: "Use a guardian-chosen label only (e.g. „Child 1“, „Older child“). Never enter a real name, birth date or any personal data.",
    languageAuto: "Automatic",
    restore: "Restore", restored: "Profile restored",
    searchTitle: "Search & filter", searchPlaceholder: "Search by label…",
    filterAge: "Age band", filterStatus: "Protection status", filterLanguage: "Language", filterState: "State", filterRole: "Guardian role",
    stateActive: "Active", stateArchived: "Archived", stateAll: "All", anyOption: "Any", apply: "Apply", clear: "Clear",
    guardiansTitle: "Guardians", addGuardian: "Add guardian", guardianMember: "Family member", roleLabel: "Role", relationshipLabel: "Relationship", authorityLabel: "Authority",
    create: "Add", changeRole: "Change role", deactivate: "Deactivate", reactivate: "Reactivate",
    noGuardians: "No guardians yet.", noMembers: "No eligible family members.", guardianAddHint: "At most one active primary guardian per profile.",
    timelineTitle: "History", timelineEmpty: "No activity yet.", timelineBy: "by",
    roles: { primary: "Primary", secondary: "Secondary", emergency: "Emergency", view_only: "View only" },
    authority: { full: "Full", limited: "Limited", read_only: "Read only" },
    lifecycle: { active: "Active", inactive: "Inactive" },
    events: {
      "child_safety.protected_profile.created": "Profile created",
      "child_safety.protected_profile.updated": "Profile edited",
      "child_safety.protected_profile.archived": "Profile archived",
      "child_safety.protected_profile.restored": "Profile restored",
      "child_safety.guardian_relationship.created": "Guardian added",
      "child_safety.guardian_relationship.role_changed": "Guardian role changed",
      "child_safety.guardian_relationship.deactivated": "Guardian deactivated",
      "child_safety.guardian_relationship.reactivated": "Guardian reactivated",
      "child_safety.guardian_relationship.revoked": "Guardian revoked",
      "child_safety.guardian_relationship.archived": "Guardian archived",
    },
  },
};

const sk: FamilyDict = {
  ...en, brand: "Tamanor Rodina", workspaceType: "Typ pracovného priestoru", family: "Rodina", business: "Firma",
  nav: { overview: "Prehľad", profiles: "Chránené profily", guardians: "Oprávnené osoby", authorizations: "Autorizácie", signals: "Bezpečnostné signály", deliveries: "Interné doručenia", settings: "Nastavenia" },
  chooser: { title: "Ako chcete používať Tamanor?", subtitle: "Vyberte režim, ktorý vám vyhovuje. Určuje váš produkt a neskôr sa nedá zmeniť.", familyTitle: "Tamanor Rodina", familyText: "Pomáha rodine bezpečne spravovať ochranné profily, oprávnené osoby a bezpečnostné upozornenia.", familyCta: "Pokračovať ako rodina", businessTitle: "Tamanor Firma", businessText: "Chráni firemné účty, komentáre a online reputáciu pred spamom, podvodmi a škodlivým obsahom.", businessCta: "Pokračovať ako firma", familyBullets: ["ochranné profily členov rodiny", "správa oprávnených príjemcov", "bezpečnostné signály", "súkromné rodinné prostredie"], businessBullets: ["správa firemných účtov", "analýza rizikových komentárov", "ochrana značky", "tímové a agentúrne možnosti podľa plánu"] },
  onboarding: {
    title: "Nastavenie Tamanor Rodina", stepOf: (a, b) => `Krok ${a} z ${b}`, next: "Pokračovať", back: "Späť", finish: "Dokončiť nastavenie",
    welcomeTitle: "Vitajte v Tamanor Rodina", welcomeText: "Tamanor Rodina vám pomáha bezpečne spravovať ochranné profily, oprávnené osoby a minimálne bezpečnostné informácie v rodinnom prostredí.", welcomeCta: "Začať nastavenie",
    profileTitle: "Rodinný profil", profileNameLabel: "Názov rodinného priestoru / domácnosti", localeLabel: "Preferovaný jazyk", timezoneLabel: "Časové pásmo",
    guardianTitle: "Potvrdenie primárneho opatrovníka", guardianIntro: "Potvrďte prosím nasledovné:", guardianC1: "Spravujem tento rodinný priestor.", guardianC2: "Budem konať v súlade s oprávneniami a súhlasmi.", guardianC3: "Rozumiem, že samotná rola rodiča automaticky neznamená prístup ku všetkým informáciám — Tamanor používa pravidlá oprávnení, súhlasov a bezpečných príjemcov.",
    firstProfileTitle: "Prvý chránený profil", firstProfileIntro: "Vytvorte prvý chránený profil. Stačí bezpečný názov a veková skupina — žiadne sociálne účty, telefón ani správy.", labelField: "Zobrazovaný názov", ageBandField: "Veková skupina", create: "Vytvoriť profil",
    privacyTitle: "Súkromie a hranice", doesTitle: "Tamanor Rodina teraz:", doesnotTitle: "Tamanor Rodina teraz NErobí:",
    completeTitle: "Všetko je pripravené", completeText: "Váš rodinný priestor je pripravený.", goToDashboard: "Prejsť na rodinný prehľad",
  },
  dash: { welcome: "Vaše rodinné prostredie", onboardingIncomplete: "Dokončiť nastavenie", primaryGuardian: "Primárny opatrovník", kpiProfiles: "Chránené profily", kpiGuardians: "Aktívne oprávnené osoby", kpiSignals: "Bezpečnostné signály", kpiPendingAuth: "Čakajúce autorizácie", kpiDeliveries: "Dostupné interné doručenia", recentProfiles: "Chránené profily", recentSignals: "Najnovšie bezpečnostné signály", pendingAuth: "Čakajúce autorizačné rozhodnutia", deliveriesSection: "Interné doručenia", emptyTitle: "Vaše rodinné prostredie je pripravené", emptyText: "Bezpečnostné signály sa tu zobrazia až po budúcej autorizovanej integrácii so sociálnou alebo komunikačnou platformou." },
  privacy: { messages: "Tamanor momentálne nečíta súkromné správy ani nesleduje zariadenia.", signal: "Bezpečnostný signál obsahuje iba minimálne štruktúrované informácie o riziku, nie obsah komunikácie.", delivery: "Interné doručenie znamená sprístupnenie informácie v Tamanor Rodina. Neznamená odoslanie emailu, SMS alebo push notifikácie.", integrations: "Integrácie so sociálnymi a komunikačnými platformami budú dostupné iba prostredníctvom oficiálnych partnerstiev a autorizovaných API." },
  profiles: { title: "Chránené profily", create: "Nový profil", label: "Názov", ageBand: "Veková skupina", status: "Stav", relationships: "Opatrovníci", signals: "Signály", created: "Vytvorené", detailTabs: { overview: "Prehľad", guardians: "Oprávnené osoby", consent: "Súhlas a oprávnenie", signals: "Bezpečnostné signály", deliveries: "Interné doručenia" }, archive: "Archivovať", archived: "Archivované", newLabel: "napr. Mladšie dieťa", emptyText: "Zatiaľ žiadne chránené profily. Vytvorte prvý." },
  guardians: { title: "Oprávnené osoby", intro: "Samotná rola opatrovníka nie je nikdy automaticky autorizovaná. Každý príjemca prechádza explicitnou reťazou:", pipeline: ["Vzťah", "Oprávnenie", "Súhlas", "Posúdenie bezpečného príjemcu", "Autorizácia"], incomplete: "Nastavenie bude dokončené v ďalšom kroku.", relationship: "Vzťah", authority: "Oprávnenie", consent: "Súhlas", assessment: "Posúdenie", eligibility: "Efektívna oprávnenosť" },
  authorizations: { title: "Autorizácie", signal: "Signál", profile: "Profil", recipient: "Príjemca", status: "Stav", scope: "Rozsah sprístupnenia", reason: "Dôvod", evaluatedAt: "Vyhodnotené", validUntil: "Platné do", revoke: "Zrušiť", emptyText: "Zatiaľ žiadne autorizačné rozhodnutia." },
  signals: { title: "Bezpečnostné signály", type: "Typ rizika", severity: "Závažnosť", confidence: "Istota", bucket: "Časové obdobie", review: "Posúdenie", created: "Vytvorené", disclaimer: "Tento záznam obsahuje iba minimálny bezpečnostný signál, nie obsah komunikácie.", emptyText: "Žiadne bezpečnostné signály. Platformové integrácie zatiaľ nie sú aktívne.", detailTitle: "Bezpečnostný signál" },
  deliveries: { title: "Interné doručenia", status: "Stav", recipient: "Príjemca", profile: "Profil", signalType: "Typ rizika", scope: "Rozsah sprístupnenia", preparedAt: "Pripravené", availableAt: "Dostupné", acknowledgedAt: "Potvrdené", declinedAt: "Odmietnuté", makeAvailable: "Sprístupniť", acknowledge: "Potvrdiť", decline: "Odmietnuť", revoke: "Zrušiť", archive: "Archivovať", availableMeans: "„Dostupné“ znamená dostupné v Tamanor Rodina — nie email, SMS ani push.", emptyText: "Zatiaľ žiadne interné doručenia." },
  settings: { title: "Nastavenia", workspaceName: "Názov rodinného priestoru", language: "Jazyk", timezone: "Časové pásmo", workspaceTypeRO: "Typ priestoru", primaryGuardian: "Primárny opatrovník", limits: "Súkromie a obmedzenia", auditLink: "Audit log" },
  labels: {
    ageBand: { under_10: "Do 10", age_10_12: "10–12", age_13_15: "13–15", age_16_17: "16–17" },
    protectionStatus: { inactive: "Neaktívny", monitoring: "Sledovanie", active: "Aktívny", paused: "Pozastavený" },
    relationshipType: { parent: "Rodič", legal_guardian: "Zákonný zástupca", trusted_adult: "Dôveryhodná osoba", safety_professional: "Bezpečnostný odborník" },
    relationshipStatus: { pending: "Čaká", verified: "Overený", suspended: "Pozastavený", revoked: "Zrušený" },
    authorityStatus: { pending: "Čaká", verified: "Overené", revoked: "Zrušené", expired: "Expirované", rejected: "Zamietnuté", none: "Nenastavené" },
    consentStatus: { not_requested: "Nevyžiadaný", pending: "Čaká", active: "Udelený", withdrawn: "Odvolaný", expired: "Expirovaný", disputed: "Sporný", suspended: "Pozastavený", none: "Nenastavené" },
    assessmentStatus: { not_started: "Nezačaté", pending: "Čaká", approved: "Schválené", rejected: "Zamietnuté", revoked: "Zrušené", expired: "Expirované", none: "Nenastavené" },
    eligibility: { eligible: "Oprávnený", requires_expert_review: "Vyžaduje odborné posúdenie", suppressed: "Potlačené", not_verified: "Neoverené", conflicted: "Konflikt" },
    signalType: { GROOMING: "Grooming", SEXUAL_SOLICITATION: "Sexuálne navádzanie", SEXTORTION: "Sextortion", MEETING_ATTEMPT: "Pokus o stretnutie", CYBERBULLYING: "Kyberšikana", THREAT: "Vyhrážka", IDENTITY_MANIPULATION: "Manipulácia identity" },
    severity: { low: "Nízka", medium: "Stredná", high: "Vysoká", critical: "Kritická" },
    confidence: { unknown: "Neznáma", low: "Nízka", medium: "Stredná", high: "Vysoká" },
    reviewStatus: { new: "Nový", acknowledged: "Potvrdený", under_review: "V posudzovaní", dismissed: "Zamietnutý", confirmed_risk: "Potvrdené riziko", archived: "Archivovaný" },
    decisionStatus: { pending: "Čaká", authorized: "Autorizované", denied: "Zamietnuté", revoked: "Zrušené", expired: "Expirované", superseded: "Nahradené" },
    reasonCode: { complete_authorization_chain: "Kompletná autorizačná reťaz", no_active_guardian_relationship: "Žiadny aktívny vzťah opatrovníka", no_valid_authority: "Žiadne platné oprávnenie", no_valid_consent: "Žiadny platný súhlas", no_approved_safe_recipient: "Žiadny schválený bezpečný príjemca", inactive_membership: "Neaktívne členstvo", tenant_mismatch: "Nezhoda priestoru", profile_mismatch: "Nezhoda profilu", signal_archived: "Signál archivovaný", consent_scope_insufficient: "Nedostatočný rozsah súhlasu", recipient_role_not_allowed: "Rola príjemcu nie je povolená", authorization_revoked: "Autorizácia zrušená", superseded_by_new_decision: "Nahradené novým rozhodnutím" },
    disclosureScope: { signal_existence: "Existencia signálu", risk_category: "Kategória rizika", severity: "Závažnosť", timing_bucket: "Časové obdobie", recommended_action_class: "Odporúčaná trieda reakcie" },
    deliveryStatus: { prepared: "Pripravené", available: "Dostupné", acknowledged: "Potvrdené", declined: "Odmietnuté", failed: "Zlyhalo", revoked: "Zrušené", expired: "Expirované", superseded: "Nahradené", archived: "Archivované" },
  },
  common: { back: "Späť", view: "Zobraziť", loading: "Načítava sa…", none: "—", confirm: "Potvrdiť", cancel: "Zrušiť", notAvailable: "Nedostupné v tomto priestore" },
  unsupported: {
    title: "Tento priestor nie je možné otvoriť",
    body: "Ste prihlásený, ale tento typ pracovného priestoru aktuálna aplikácia nepodporuje. Nič sa nezmenilo.",
    explain: "Môže sa to stať, ak bol priestor nastavený pre oblasť produktu, ktorá tu nie je dostupná. Odhláste sa a prihláste znova, alebo kontaktujte podporu, ak to pretrváva.",
    logout: "Odhlásiť sa", help: "Kontaktovať podporu",
  },
  dialog: {
    confirm: "Potvrdiť", cancel: "Zrušiť", working: "Prebieha…", errorTitle: "Akciu sa nepodarilo dokončiť",
    archiveProfileTitle: "Archivovať tento chránený profil?",
    archiveProfileBody: "Archiváciou sa zastaví nová aktivita pre tento profil. Existujúce záznamy sa zachovajú pre históriu a možno ich neskôr posúdiť. Nič sa nevymaže.",
    archiveProfileConfirm: "Archivovať profil",
    revokeAuthTitle: "Zrušiť túto autorizáciu?",
    revokeAuthBody: "Zrušením sa ukončí autorizácia príjemcu pre tento signál. Súvisiace interné doručenie sa stane nedostupným. Zaznamenáva sa pre audit.",
    revokeAuthConfirm: "Zrušiť autorizáciu",
    revokeDeliveryTitle: "Zrušiť toto interné doručenie?",
    revokeDeliveryBody: "Zrušením sa interné doručenie stane pre príjemcu nedostupným v Tamanor Rodina. Zaznamenáva sa a nedá sa vrátiť späť.",
    revokeDeliveryConfirm: "Zrušiť doručenie",
    archiveDeliveryTitle: "Archivovať toto interné doručenie?",
    archiveDeliveryBody: "Archiváciou sa doručenie odstráni z aktívneho zoznamu. Záznam sa zachová pre históriu. Nič sa nevymaže.",
    archiveDeliveryConfirm: "Archivovať doručenie",
    restoreProfileTitle: "Obnoviť tento profil?",
    restoreProfileBody: "Obnovením sa profil vráti medzi aktívne. Jeho história a opatrovníci ostávajú nezmenené. Identifikátor zostáva rovnaký.",
    restoreProfileConfirm: "Obnoviť profil",
    deactivateGuardianTitle: "Deaktivovať tohto opatrovníka?",
    deactivateGuardianBody: "Deaktiváciou sa vzťah opatrovníka pozastaví a odoberie sa mu autorizácia až do reaktivácie. Nič sa nevymaže a možno ho neskôr reaktivovať.",
    deactivateGuardianConfirm: "Deaktivovať opatrovníka",
  },
  errorBoundary: {
    title: "Niečo sa pokazilo",
    body: "Túto časť Tamanor Rodina sa nepodarilo zobraziť. Žiadne zmeny sa nestratili. Môžete to skúsiť znova alebo sa vrátiť do svojho rodinného prostredia.",
    retry: "Skúsiť znova", back: "Späť do rodinného prostredia",
  },
  actionErrors: {
    forbidden: "Nemáte oprávnenie na túto akciu.",
    not_found: "Položka sa nenašla. Možno už bola zmenená.",
    invalid_state: "Táto akcia nie je možná v aktuálnom stave položky.",
    authorization_not_effective: "Táto autorizácia momentálne nie je účinná.",
    archived: "Položka je už archivovaná.",
    already_revoked: "Položka už bola zrušená.",
    retry_later: "Niečo sa pokazilo. Skúste to o chvíľu znova.",
  },
  c7: {
    editTitle: "Upraviť profil", edit: "Upraviť", save: "Uložiť zmeny",
    noPiiHint: "Použite len označenie zvolené opatrovníkom (napr. „Dieťa 1“, „Staršie dieťa“). Nikdy nezadávajte skutočné meno, dátum narodenia ani žiadne osobné údaje.",
    languageAuto: "Automaticky",
    restore: "Obnoviť", restored: "Profil obnovený",
    searchTitle: "Hľadať a filtrovať", searchPlaceholder: "Hľadať podľa označenia…",
    filterAge: "Veková skupina", filterStatus: "Stav ochrany", filterLanguage: "Jazyk", filterState: "Stav", filterRole: "Rola opatrovníka",
    stateActive: "Aktívne", stateArchived: "Archivované", stateAll: "Všetky", anyOption: "Ľubovoľné", apply: "Použiť", clear: "Vymazať",
    guardiansTitle: "Opatrovníci", addGuardian: "Pridať opatrovníka", guardianMember: "Člen rodiny", roleLabel: "Rola", relationshipLabel: "Vzťah", authorityLabel: "Oprávnenie",
    create: "Pridať", changeRole: "Zmeniť rolu", deactivate: "Deaktivovať", reactivate: "Reaktivovať",
    noGuardians: "Zatiaľ žiadni opatrovníci.", noMembers: "Žiadni vhodní členovia rodiny.", guardianAddHint: "Najviac jeden aktívny primárny opatrovník na profil.",
    timelineTitle: "História", timelineEmpty: "Zatiaľ žiadna aktivita.", timelineBy: "—",
    roles: { primary: "Primárny", secondary: "Sekundárny", emergency: "Núdzový", view_only: "Iba na čítanie" },
    authority: { full: "Plné", limited: "Obmedzené", read_only: "Iba na čítanie" },
    lifecycle: { active: "Aktívny", inactive: "Neaktívny" },
    events: {
      "child_safety.protected_profile.created": "Profil vytvorený",
      "child_safety.protected_profile.updated": "Profil upravený",
      "child_safety.protected_profile.archived": "Profil archivovaný",
      "child_safety.protected_profile.restored": "Profil obnovený",
      "child_safety.guardian_relationship.created": "Opatrovník pridaný",
      "child_safety.guardian_relationship.role_changed": "Rola opatrovníka zmenená",
      "child_safety.guardian_relationship.deactivated": "Opatrovník deaktivovaný",
      "child_safety.guardian_relationship.reactivated": "Opatrovník reaktivovaný",
      "child_safety.guardian_relationship.revoked": "Opatrovník zrušený",
      "child_safety.guardian_relationship.archived": "Opatrovník archivovaný",
    },
  },
};

const de: FamilyDict = {
  ...en, brand: "Tamanor Familie", workspaceType: "Arbeitsbereichstyp", family: "Familie", business: "Business",
  nav: { overview: "Übersicht", profiles: "Geschützte Profile", guardians: "Berechtigte Personen", authorizations: "Autorisierungen", signals: "Sicherheitssignale", deliveries: "Interne Zustellungen", settings: "Einstellungen" },
  chooser: { title: "Wie möchten Sie Tamanor nutzen?", subtitle: "Wählen Sie den passenden Modus. Er bestimmt Ihr Produkt und kann später nicht geändert werden.", familyTitle: "Tamanor Familie", familyText: "Hilft einer Familie, geschützte Profile, berechtigte Personen und Sicherheitsinformationen sicher zu verwalten.", familyCta: "Als Familie fortfahren", businessTitle: "Tamanor Business", businessText: "Schützt Geschäftskonten, Kommentare und die Online-Reputation vor Spam, Betrug und schädlichen Inhalten.", businessCta: "Als Unternehmen fortfahren", familyBullets: ["Geschützte Profile für Familienmitglieder", "Verwaltung berechtigter Empfänger", "Sicherheitssignale", "Ein privater Familienraum"], businessBullets: ["Geschäftskonten verwalten", "Riskante Kommentare analysieren", "Markenschutz", "Team- und Agenturoptionen je nach Plan"] },
  onboarding: {
    title: "Tamanor Familie einrichten", stepOf: (a, b) => `Schritt ${a} von ${b}`, next: "Weiter", back: "Zurück", finish: "Einrichtung abschließen",
    welcomeTitle: "Willkommen bei Tamanor Familie", welcomeText: "Tamanor Familie hilft Ihnen, geschützte Profile, berechtigte Personen und minimale Sicherheitsinformationen im Familienumfeld sicher zu verwalten.", welcomeCta: "Einrichtung starten",
    profileTitle: "Familienprofil", profileNameLabel: "Name des Haushalts / Familienbereichs", localeLabel: "Bevorzugte Sprache", timezoneLabel: "Zeitzone",
    guardianTitle: "Bestätigung des Hauptbetreuers", guardianIntro: "Bitte bestätigen Sie Folgendes:", guardianC1: "Ich verwalte diesen Familienbereich.", guardianC2: "Ich handle im Einklang mit Autorisierungen und Einwilligungen.", guardianC3: "Mir ist bewusst, dass eine Elternrolle allein keinen Zugriff auf alle Informationen gewährt — Tamanor nutzt Regeln zu Befugnis, Einwilligung und sicheren Empfängern.",
    firstProfileTitle: "Erstes geschütztes Profil", firstProfileIntro: "Erstellen Sie ein erstes geschütztes Profil. Nur ein sicheres Label und eine Altersgruppe sind nötig — keine sozialen Konten, Telefon oder Nachrichten.", labelField: "Anzeigename", ageBandField: "Altersgruppe", create: "Profil erstellen",
    privacyTitle: "Datenschutz und Grenzen", doesTitle: "Tamanor Familie jetzt:", doesnotTitle: "Tamanor Familie tut jetzt NICHT:",
    completeTitle: "Alles bereit", completeText: "Ihr Familienbereich ist bereit.", goToDashboard: "Zum Familien-Dashboard",
  },
  dash: { welcome: "Ihr Familienbereich", onboardingIncomplete: "Einrichtung abschließen", primaryGuardian: "Hauptbetreuer", kpiProfiles: "Geschützte Profile", kpiGuardians: "Aktive berechtigte Personen", kpiSignals: "Sicherheitssignale", kpiPendingAuth: "Ausstehende Autorisierungen", kpiDeliveries: "Verfügbare interne Zustellungen", recentProfiles: "Geschützte Profile", recentSignals: "Neueste Sicherheitssignale", pendingAuth: "Ausstehende Autorisierungsentscheidungen", deliveriesSection: "Interne Zustellungen", emptyTitle: "Ihr Familienbereich ist bereit", emptyText: "Sicherheitssignale erscheinen hier nach einer künftigen autorisierten Integration mit einer sozialen oder Kommunikationsplattform." },
  privacy: { messages: "Tamanor liest derzeit keine privaten Nachrichten und überwacht keine Geräte.", signal: "Ein Sicherheitssignal enthält nur minimale strukturierte Informationen über ein Risiko — nicht den Inhalt der Kommunikation.", delivery: "Eine interne Zustellung bedeutet, dass Informationen innerhalb von Tamanor Familie bereitgestellt werden. Es bedeutet NICHT, dass eine E-Mail, SMS oder Push gesendet wurde.", integrations: "Integrationen mit sozialen und Kommunikationsplattformen sind nur über offizielle Partnerschaften und autorisierte APIs verfügbar." },
  profiles: { title: "Geschützte Profile", create: "Neues Profil", label: "Label", ageBand: "Altersgruppe", status: "Status", relationships: "Betreuer", signals: "Signale", created: "Erstellt", detailTabs: { overview: "Übersicht", guardians: "Berechtigte Personen", consent: "Einwilligung & Befugnis", signals: "Sicherheitssignale", deliveries: "Interne Zustellungen" }, archive: "Archivieren", archived: "Archiviert", newLabel: "z. B. Jüngeres Kind", emptyText: "Noch keine geschützten Profile. Erstellen Sie eines." },
  guardians: { title: "Berechtigte Personen", intro: "Eine Betreuerrolle allein ist nie automatisch autorisiert. Jeder Empfänger durchläuft eine explizite Kette:", pipeline: ["Beziehung", "Befugnis", "Einwilligung", "Bewertung sicherer Empfänger", "Autorisierung"], incomplete: "Die Einrichtung wird in einem späteren Schritt abgeschlossen.", relationship: "Beziehung", authority: "Befugnis", consent: "Einwilligung", assessment: "Bewertung", eligibility: "Effektive Berechtigung" },
  authorizations: { title: "Autorisierungen", signal: "Signal", profile: "Profil", recipient: "Empfänger", status: "Status", scope: "Offenlegungsumfang", reason: "Grund", evaluatedAt: "Bewertet", validUntil: "Gültig bis", revoke: "Widerrufen", emptyText: "Noch keine Autorisierungsentscheidungen." },
  signals: { title: "Sicherheitssignale", type: "Risikotyp", severity: "Schweregrad", confidence: "Konfidenz", bucket: "Zeitfenster", review: "Prüfung", created: "Erstellt", disclaimer: "Dieser Datensatz enthält nur ein minimales Sicherheitssignal, nicht den Inhalt der Kommunikation.", emptyText: "Keine Sicherheitssignale. Plattform-Integrationen sind noch nicht aktiv.", detailTitle: "Sicherheitssignal" },
  deliveries: { title: "Interne Zustellungen", status: "Status", recipient: "Empfänger", profile: "Profil", signalType: "Risikotyp", scope: "Offenlegungsumfang", preparedAt: "Vorbereitet", availableAt: "Verfügbar", acknowledgedAt: "Bestätigt", declinedAt: "Abgelehnt", makeAvailable: "Bereitstellen", acknowledge: "Bestätigen", decline: "Ablehnen", revoke: "Widerrufen", archive: "Archivieren", availableMeans: "„Verfügbar“ bedeutet verfügbar in Tamanor Familie — keine E-Mail, SMS oder Push.", emptyText: "Noch keine internen Zustellungen." },
  settings: { title: "Einstellungen", workspaceName: "Name des Familienbereichs", language: "Sprache", timezone: "Zeitzone", workspaceTypeRO: "Bereichstyp", primaryGuardian: "Hauptbetreuer", limits: "Datenschutz & Einschränkungen", auditLink: "Audit-Log" },
  labels: {
    ageBand: { under_10: "Unter 10", age_10_12: "10–12", age_13_15: "13–15", age_16_17: "16–17" },
    protectionStatus: { inactive: "Inaktiv", monitoring: "Beobachtung", active: "Aktiv", paused: "Pausiert" },
    relationshipType: { parent: "Elternteil", legal_guardian: "Gesetzl. Vertreter", trusted_adult: "Vertrauensperson", safety_professional: "Sicherheitsfachkraft" },
    relationshipStatus: { pending: "Ausstehend", verified: "Verifiziert", suspended: "Ausgesetzt", revoked: "Widerrufen" },
    authorityStatus: { pending: "Ausstehend", verified: "Verifiziert", revoked: "Widerrufen", expired: "Abgelaufen", rejected: "Abgelehnt", none: "Nicht gesetzt" },
    consentStatus: { not_requested: "Nicht angefordert", pending: "Ausstehend", active: "Erteilt", withdrawn: "Zurückgezogen", expired: "Abgelaufen", disputed: "Strittig", suspended: "Ausgesetzt", none: "Nicht gesetzt" },
    assessmentStatus: { not_started: "Nicht begonnen", pending: "Ausstehend", approved: "Genehmigt", rejected: "Abgelehnt", revoked: "Widerrufen", expired: "Abgelaufen", none: "Nicht gesetzt" },
    eligibility: { eligible: "Berechtigt", requires_expert_review: "Expertenprüfung nötig", suppressed: "Unterdrückt", not_verified: "Nicht verifiziert", conflicted: "Konflikt" },
    signalType: { GROOMING: "Grooming", SEXUAL_SOLICITATION: "Sexuelle Anbahnung", SEXTORTION: "Sextortion", MEETING_ATTEMPT: "Treffversuch", CYBERBULLYING: "Cybermobbing", THREAT: "Drohung", IDENTITY_MANIPULATION: "Identitätsmanipulation" },
    severity: { low: "Niedrig", medium: "Mittel", high: "Hoch", critical: "Kritisch" },
    confidence: { unknown: "Unbekannt", low: "Niedrig", medium: "Mittel", high: "Hoch" },
    reviewStatus: { new: "Neu", acknowledged: "Bestätigt", under_review: "In Prüfung", dismissed: "Verworfen", confirmed_risk: "Bestätigtes Risiko", archived: "Archiviert" },
    decisionStatus: { pending: "Ausstehend", authorized: "Autorisiert", denied: "Abgelehnt", revoked: "Widerrufen", expired: "Abgelaufen", superseded: "Ersetzt" },
    reasonCode: { complete_authorization_chain: "Vollständige Autorisierungskette", no_active_guardian_relationship: "Keine aktive Betreuungsbeziehung", no_valid_authority: "Keine gültige Befugnis", no_valid_consent: "Keine gültige Einwilligung", no_approved_safe_recipient: "Kein genehmigter sicherer Empfänger", inactive_membership: "Inaktive Mitgliedschaft", tenant_mismatch: "Bereichs-Konflikt", profile_mismatch: "Profil-Konflikt", signal_archived: "Signal archiviert", consent_scope_insufficient: "Einwilligungsumfang unzureichend", recipient_role_not_allowed: "Empfängerrolle nicht erlaubt", authorization_revoked: "Autorisierung widerrufen", superseded_by_new_decision: "Durch neue Entscheidung ersetzt" },
    disclosureScope: { signal_existence: "Signalexistenz", risk_category: "Risikokategorie", severity: "Schweregrad", timing_bucket: "Zeitfenster", recommended_action_class: "Empfohlene Aktionsklasse" },
    deliveryStatus: { prepared: "Vorbereitet", available: "Verfügbar", acknowledged: "Bestätigt", declined: "Abgelehnt", failed: "Fehlgeschlagen", revoked: "Widerrufen", expired: "Abgelaufen", superseded: "Ersetzt", archived: "Archiviert" },
  },
  common: { back: "Zurück", view: "Ansehen", loading: "Wird geladen…", none: "—", confirm: "Bestätigen", cancel: "Abbrechen", notAvailable: "In diesem Bereich nicht verfügbar" },
  unsupported: {
    title: "Dieser Bereich kann nicht geöffnet werden",
    body: "Sie sind angemeldet, aber dieser Arbeitsbereichstyp wird von der aktuellen App nicht unterstützt. Es wurde nichts geändert.",
    explain: "Das kann passieren, wenn der Bereich für einen Produktbereich eingerichtet wurde, der hier nicht verfügbar ist. Bitte melden Sie sich ab und wieder an, oder kontaktieren Sie den Support, falls dies weiterhin auftritt.",
    logout: "Abmelden", help: "Support kontaktieren",
  },
  dialog: {
    confirm: "Bestätigen", cancel: "Abbrechen", working: "Wird ausgeführt…", errorTitle: "Aktion konnte nicht abgeschlossen werden",
    archiveProfileTitle: "Dieses geschützte Profil archivieren?",
    archiveProfileBody: "Durch das Archivieren wird neue Aktivität für dieses Profil gestoppt. Bestehende Datensätze bleiben für die Historie erhalten und können später geprüft werden. Es wird nichts gelöscht.",
    archiveProfileConfirm: "Profil archivieren",
    revokeAuthTitle: "Diese Autorisierung widerrufen?",
    revokeAuthBody: "Durch den Widerruf endet die Autorisierung des Empfängers für dieses Signal. Eine zugehörige interne Zustellung wird nicht mehr verfügbar. Dies wird für die Prüfung protokolliert.",
    revokeAuthConfirm: "Autorisierung widerrufen",
    revokeDeliveryTitle: "Diese interne Zustellung widerrufen?",
    revokeDeliveryBody: "Durch den Widerruf wird diese interne Zustellung für den Empfänger in Tamanor Familie nicht mehr verfügbar. Dies wird protokolliert und kann nicht rückgängig gemacht werden.",
    revokeDeliveryConfirm: "Zustellung widerrufen",
    archiveDeliveryTitle: "Diese interne Zustellung archivieren?",
    archiveDeliveryBody: "Durch das Archivieren wird diese Zustellung aus der aktiven Liste entfernt. Der Datensatz bleibt für die Historie erhalten. Es wird nichts gelöscht.",
    archiveDeliveryConfirm: "Zustellung archivieren",
    restoreProfileTitle: "Dieses Profil wiederherstellen?",
    restoreProfileBody: "Durch die Wiederherstellung wird dieses Profil wieder aktiv. Seine Historie und Betreuer bleiben unverändert. Die Kennung bleibt gleich.",
    restoreProfileConfirm: "Profil wiederherstellen",
    deactivateGuardianTitle: "Diesen Betreuer deaktivieren?",
    deactivateGuardianBody: "Durch das Deaktivieren wird diese Betreuungsbeziehung pausiert und ihre Autorisierung bis zur Reaktivierung entfernt. Es wird nichts gelöscht und sie kann später reaktiviert werden.",
    deactivateGuardianConfirm: "Betreuer deaktivieren",
  },
  errorBoundary: {
    title: "Etwas ist schiefgelaufen",
    body: "Dieser Teil von Tamanor Familie konnte nicht angezeigt werden. Es sind keine Änderungen verloren gegangen. Sie können es erneut versuchen oder zu Ihrem Familienbereich zurückkehren.",
    retry: "Erneut versuchen", back: "Zurück zum Familienbereich",
  },
  actionErrors: {
    forbidden: "Sie haben keine Berechtigung dafür.",
    not_found: "Dieses Element wurde nicht gefunden. Es wurde möglicherweise bereits geändert.",
    invalid_state: "Diese Aktion ist im aktuellen Zustand des Elements nicht möglich.",
    authorization_not_effective: "Diese Autorisierung ist derzeit nicht wirksam.",
    archived: "Dieses Element ist bereits archiviert.",
    already_revoked: "Dieses Element wurde bereits widerrufen.",
    retry_later: "Etwas ist schiefgelaufen. Bitte versuchen Sie es gleich erneut.",
  },
  c7: {
    editTitle: "Profil bearbeiten", edit: "Bearbeiten", save: "Änderungen speichern",
    noPiiHint: "Verwenden Sie nur eine vom Betreuer gewählte Bezeichnung (z. B. „Kind 1“, „Älteres Kind“). Geben Sie niemals einen echten Namen, ein Geburtsdatum oder personenbezogene Daten ein.",
    languageAuto: "Automatisch",
    restore: "Wiederherstellen", restored: "Profil wiederhergestellt",
    searchTitle: "Suchen & filtern", searchPlaceholder: "Nach Bezeichnung suchen…",
    filterAge: "Altersgruppe", filterStatus: "Schutzstatus", filterLanguage: "Sprache", filterState: "Zustand", filterRole: "Betreuerrolle",
    stateActive: "Aktiv", stateArchived: "Archiviert", stateAll: "Alle", anyOption: "Beliebig", apply: "Anwenden", clear: "Zurücksetzen",
    guardiansTitle: "Betreuer", addGuardian: "Betreuer hinzufügen", guardianMember: "Familienmitglied", roleLabel: "Rolle", relationshipLabel: "Beziehung", authorityLabel: "Befugnis",
    create: "Hinzufügen", changeRole: "Rolle ändern", deactivate: "Deaktivieren", reactivate: "Reaktivieren",
    noGuardians: "Noch keine Betreuer.", noMembers: "Keine geeigneten Familienmitglieder.", guardianAddHint: "Höchstens ein aktiver Hauptbetreuer pro Profil.",
    timelineTitle: "Verlauf", timelineEmpty: "Noch keine Aktivität.", timelineBy: "—",
    roles: { primary: "Hauptbetreuer", secondary: "Zweitbetreuer", emergency: "Notfall", view_only: "Nur Ansicht" },
    authority: { full: "Voll", limited: "Eingeschränkt", read_only: "Nur Lesen" },
    lifecycle: { active: "Aktiv", inactive: "Inaktiv" },
    events: {
      "child_safety.protected_profile.created": "Profil erstellt",
      "child_safety.protected_profile.updated": "Profil bearbeitet",
      "child_safety.protected_profile.archived": "Profil archiviert",
      "child_safety.protected_profile.restored": "Profil wiederhergestellt",
      "child_safety.guardian_relationship.created": "Betreuer hinzugefügt",
      "child_safety.guardian_relationship.role_changed": "Betreuerrolle geändert",
      "child_safety.guardian_relationship.deactivated": "Betreuer deaktiviert",
      "child_safety.guardian_relationship.reactivated": "Betreuer reaktiviert",
      "child_safety.guardian_relationship.revoked": "Betreuer widerrufen",
      "child_safety.guardian_relationship.archived": "Betreuer archiviert",
    },
  },
};

const DICTS: Record<Locale, FamilyDict> = { en, sk, de };
export function familyDict(locale: Locale): FamilyDict { return DICTS[locale] ?? en; }
/** Safe label lookup: raw enum → human string; never shows the raw value. */
export function famLabel(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return map.none ?? "—";
  return map[key] ?? key.replace(/_/g, " ");
}
