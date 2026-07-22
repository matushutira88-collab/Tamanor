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
};

const DICTS: Record<Locale, FamilyDict> = { en, sk, de };
export function familyDict(locale: Locale): FamilyDict { return DICTS[locale] ?? en; }
/** Safe label lookup: raw enum → human string; never shows the raw value. */
export function famLabel(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return map.none ?? "—";
  return map[key] ?? key.replace(/_/g, " ");
}
