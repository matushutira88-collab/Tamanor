/**
 * BUSINESS — Connected Platforms & Contacts V1 — co-located i18n (SK/EN/DE). Kept out of the central i18n-check
 * like the other feature dicts (ato-i18n / cb-i18n / family-*). Content-free: labels only, no PII, no ids.
 */
import type { Locale } from "@/i18n";
import {
  BusinessContactStatus, BusinessContactSource, BusinessProvider, BusinessConnectionStatus,
  BusinessConnectionCapability, type MetaLeadCapabilityState, type MetaPageOnboardingOutcome,
} from "@guardora/core";

export interface BusinessDict {
  contacts: {
    title: string; desc: string; total: (n: number) => string;
    filterStatus: string; filterSource: string; all: string;
    colName: string; colContact: string; colSource: string; colCampaign: string; colReceived: string; colStatus: string; colAssignee: string;
    noName: string; unassigned: string; empty: string; loading: string;
    denied: string; error: string;
    changeStatus: string; assign: string; unassign: string; save: string; back: string;
    detailTitle: string; email: string; phone: string; company: string; message: string; campaign: string; form: string; received: string; consent: string;
    consentGranted: string; consentDenied: string; consentUnknown: string;
    statusChanged: string; assigned: string;
    /** BUSINESS-CRM-V2 — search, notes and the activity timeline. */
    search: string; searchPlaceholder: string; searchApply: string; searchClear: string; noResults: string;
    colAssignee2: string; colLatestActivity: string; unassignedShort: string;
    notes: string; addNote: string; notePlaceholder: string; noteAdded: string; noNotes: string;
    noteEmpty: string; noteTooLong: string; noteError: string;
    activity: string; activityReceived: string; activityStatusChanged: string; activityAssigned: string;
    activityUnassigned: string; activityNote: string; activityBy: string; activityEmpty: string;
    /** BUSINESS-CRM-V2 Phase B — bulk selection + CSV export. */
    selectRow: string; selectPage: string; selectedCount: (n: number) => string; clearSelection: string;
    bulkStatus: string; bulkAssign: string; bulkUnassign: string; apply: string;
    exportCsv: string; exportLimited: (n: number) => string;
    bulkAffected: (n: number) => string; bulkFailed: (n: number) => string;
    bulkNoneSelected: string; bulkTooMany: string; bulkInvalid: string; bulkAssigneeInvalid: string;
    bulkDenied: string; bulkFailedGeneric: string; rateLimited: string;
  };
  platforms: {
    title: string; desc: string;
    capabilities: string; lastVerified: string; lastSync: string; never: string;
    connect: string; reconnect: string; disconnect: string;
    configRequired: string; approvalRequired: string; notAvailable: string;
    disconnected: string; denied: string;
    /** BUSINESS-LEADGEN-SUBSCRIPTION-V1 — one-click Page↔app `leadgen` webhook repair. */
    connectLeadWebhook: string; leadWebhookConnected: string; leadWebhookFailed: string;
    /** BUSINESS-LEADGEN-MULTIPAGE-V1 — per-Facebook-Page Lead Ads readiness. */
    leadPagesSummary: (ready: number, total: number) => string;
    leadPagesNone: string; leadPagesScopeNote: string; unnamedPage: string;
  };
  status: Record<BusinessContactStatus, string>;
  source: Record<BusinessContactSource, string>;
  provider: Record<BusinessProvider, string>;
  connStatus: Record<BusinessConnectionStatus, string>;
  capability: Record<BusinessConnectionCapability, string>;
  metaLead: { title: string } & Record<MetaLeadCapabilityState, string>;
  /** BUSINESS-LEADGEN-ONBOARDING-V1 — post-connect, per-Page result summary. */
  onboarding: { title: string; detailCta: string; pages: string } & Record<MetaPageOnboardingOutcome, string>;
}

const en: BusinessDict = {
  contacts: {
    title: "Contacts", desc: "Business leads captured from your connected platforms.", total: (n) => `${n} contacts`,
    filterStatus: "Status", filterSource: "Source", all: "All",
    colName: "Name", colContact: "Contact", colSource: "Source", colCampaign: "Campaign / form", colReceived: "Received", colStatus: "Status", colAssignee: "Assigned",
    noName: "Unnamed lead", unassigned: "Unassigned", empty: "No contacts yet. Leads from connected platforms will appear here.", loading: "Loading contacts…",
    denied: "You don't have permission to view contacts.", error: "Something went wrong loading contacts.",
    changeStatus: "Change status", assign: "Assign to", unassign: "Unassign", save: "Save", back: "Back to contacts",
    detailTitle: "Contact detail", email: "Email", phone: "Phone", company: "Company", message: "Message", campaign: "Campaign", form: "Form", received: "Received", consent: "Consent",
    consentGranted: "Granted", consentDenied: "Not granted", consentUnknown: "Not provided",
    statusChanged: "Status updated.", assigned: "Assignment updated.",
    search: "Search", searchPlaceholder: "Name, email, phone or company", searchApply: "Search", searchClear: "Clear",
    noResults: "No contacts match your search.",
    colAssignee2: "Assigned to", colLatestActivity: "Last activity", unassignedShort: "Unassigned",
    notes: "Internal notes", addNote: "Add note", notePlaceholder: "Write an internal note (visible to your team only)",
    noteAdded: "Note added.", noNotes: "No notes yet.",
    noteEmpty: "A note cannot be empty.", noteTooLong: "A note can be at most 2,000 characters.",
    noteError: "The note could not be saved.",
    activity: "Activity", activityReceived: "Contact received", activityStatusChanged: "Status changed",
    activityAssigned: "Assigned", activityUnassigned: "Unassigned", activityNote: "Note added",
    activityBy: "by", activityEmpty: "No activity yet.",
    selectRow: "Select contact", selectPage: "Select all on this page", selectedCount: (n) => `${n} selected`,
    clearSelection: "Clear selection",
    bulkStatus: "Set status", bulkAssign: "Assign to", bulkUnassign: "Unassign", apply: "Apply",
    exportCsv: "Export CSV", exportLimited: (n) => `Export limited to the first ${n} contacts.`,
    bulkAffected: (n) => `${n} contacts updated`, bulkFailed: (n) => `${n} contacts could not be updated`,
    bulkNoneSelected: "Select at least one contact first.",
    bulkTooMany: "You can update at most 100 contacts at a time.",
    bulkInvalid: "The selection was not valid. Please reselect and try again.",
    bulkAssigneeInvalid: "That team member is not available in this workspace.",
    bulkDenied: "You don't have permission to perform this action.",
    bulkFailedGeneric: "The operation could not be completed.",
    rateLimited: "Too many requests. Please wait a moment and try again.",
  },
  platforms: {
    title: "Connected platforms", desc: "Connect your ad and social platforms to ingest leads. Comment moderation stays a separate capability of the same connection.",
    capabilities: "Capabilities", lastVerified: "Last verified", lastSync: "Last sync", never: "Never",
    connect: "Connect", reconnect: "Reconnect", disconnect: "Disconnect",
    configRequired: "Configuration required", approvalRequired: "Provider approval required", notAvailable: "Not available in this checkpoint",
    disconnected: "Disconnected.", denied: "You don't have permission to manage platforms.",
    connectLeadWebhook: "Connect Lead Ads webhook",
    leadWebhookConnected: "Lead Ads webhook connected.",
    leadWebhookFailed: "Could not connect the Lead Ads webhook. Please try again.",
    leadPagesSummary: (ready, total) => `${ready} of ${total} Facebook Pages ready`,
    leadPagesNone: "No Facebook Page connected yet.",
    leadPagesScopeNote: "Lead Ads applies to Facebook Pages only. Instagram accounts are not lead sources.",
    unnamedPage: "Unnamed Page",
  },
  status: { new: "New", contacted: "Contacted", handled: "Handled", customer: "Customer", rejected: "Rejected" },
  source: { facebook: "Facebook", instagram: "Instagram", google_ads: "Google Ads", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", web_form: "Web form" },
  provider: { meta: "Meta (Facebook & Instagram)", google: "Google Ads & YouTube", tiktok: "TikTok", linkedin: "LinkedIn" },
  connStatus: {
    not_configured: "Not configured", pending: "Pending", active: "Connected", reauth_required: "Reauthorization required",
    disconnected: "Disconnected", error: "Error", awaiting_provider_approval: "Awaiting provider approval",
  },
  capability: { lead_ingestion: "Lead ingestion", comment_moderation: "Comment moderation", brand_monitoring: "Brand monitoring" },
  metaLead: {
    title: "Lead Ads",
    available: "Active — leads are ingested automatically", config_missing: "Meta app not configured",
    entitlement_locked: "Not included in your plan", no_linked_account: "No linked Meta account",
    connection_inactive: "Connection inactive", credential_unavailable: "Credential unavailable — reconnect required",
    permission_missing: "Lead permission not granted",
    webhook_subscription_missing: "Lead Ads webhook is not connected",
    awaiting_provider_approval: "Awaiting Meta app review",
  },
  onboarding: {
    title: "Meta connection result", detailCta: "See each Page", pages: "Pages",
    lead_ads_ready: "Connected and Lead Ads ready",
    leads_permission_missing: "Connected, but lead access was not granted",
    webhook_not_verified: "Connected, but the Lead Ads webhook is not verified yet",
    provider_approval_required: "Connected, but Meta app review is still required",
    comments_only: "Connected for comment monitoring",
    verification_unavailable: "Connected — Lead Ads check temporarily unavailable",
  },
};

const sk: BusinessDict = {
  contacts: {
    title: "Kontakty", desc: "Obchodné leady zachytené z vašich pripojených platforiem.", total: (n) => `${n} kontaktov`,
    filterStatus: "Stav", filterSource: "Zdroj", all: "Všetky",
    colName: "Meno", colContact: "Kontakt", colSource: "Zdroj", colCampaign: "Kampaň / formulár", colReceived: "Prijaté", colStatus: "Stav", colAssignee: "Priradené",
    noName: "Lead bez mena", unassigned: "Nepriradené", empty: "Zatiaľ žiadne kontakty. Leady z pripojených platforiem sa zobrazia tu.", loading: "Načítavam kontakty…",
    denied: "Nemáte oprávnenie zobraziť kontakty.", error: "Pri načítaní kontaktov nastala chyba.",
    changeStatus: "Zmeniť stav", assign: "Priradiť", unassign: "Zrušiť priradenie", save: "Uložiť", back: "Späť na kontakty",
    detailTitle: "Detail kontaktu", email: "E-mail", phone: "Telefón", company: "Spoločnosť", message: "Správa", campaign: "Kampaň", form: "Formulár", received: "Prijaté", consent: "Súhlas",
    consentGranted: "Udelený", consentDenied: "Neudelený", consentUnknown: "Neuvedený",
    statusChanged: "Stav aktualizovaný.", assigned: "Priradenie aktualizované.",
    search: "Hľadať", searchPlaceholder: "Meno, e-mail, telefón alebo spoločnosť", searchApply: "Hľadať", searchClear: "Zrušiť",
    noResults: "Vášmu hľadaniu nezodpovedá žiadny kontakt.",
    colAssignee2: "Priradené", colLatestActivity: "Posledná aktivita", unassignedShort: "Nepriradené",
    notes: "Interné poznámky", addNote: "Pridať poznámku", notePlaceholder: "Napíšte internú poznámku (viditeľnú len pre váš tím)",
    noteAdded: "Poznámka bola pridaná.", noNotes: "Zatiaľ žiadne poznámky.",
    noteEmpty: "Poznámka nemôže byť prázdna.", noteTooLong: "Poznámka môže mať najviac 2 000 znakov.",
    noteError: "Poznámku sa nepodarilo uložiť.",
    activity: "Aktivita", activityReceived: "Kontakt prijatý", activityStatusChanged: "Stav zmenený",
    activityAssigned: "Priradené", activityUnassigned: "Priradenie zrušené", activityNote: "Poznámka pridaná",
    activityBy: "od", activityEmpty: "Zatiaľ žiadna aktivita.",
    selectRow: "Vybrať kontakt", selectPage: "Vybrať všetky na tejto strane", selectedCount: (n) => `Vybraných: ${n}`,
    clearSelection: "Zrušiť výber",
    bulkStatus: "Nastaviť stav", bulkAssign: "Priradiť", bulkUnassign: "Zrušiť priradenie", apply: "Použiť",
    exportCsv: "Exportovať CSV", exportLimited: (n) => `Export je obmedzený na prvých ${n} kontaktov.`,
    bulkAffected: (n) => `Aktualizovaných kontaktov: ${n}`, bulkFailed: (n) => `Neaktualizovaných kontaktov: ${n}`,
    bulkNoneSelected: "Najprv vyberte aspoň jeden kontakt.",
    bulkTooMany: "Naraz môžete aktualizovať najviac 100 kontaktov.",
    bulkInvalid: "Výber nebol platný. Vyberte kontakty znova a skúste to opäť.",
    bulkAssigneeInvalid: "Tento člen tímu nie je v tomto pracovnom priestore dostupný.",
    bulkDenied: "Nemáte oprávnenie vykonať túto akciu.",
    bulkFailedGeneric: "Operáciu sa nepodarilo dokončiť.",
    rateLimited: "Príliš veľa požiadaviek. Chvíľu počkajte a skúste to znova.",
  },
  platforms: {
    title: "Pripojené platformy", desc: "Pripojte reklamné a sociálne platformy na získavanie leadov. Moderovanie komentárov je samostatná funkcia toho istého pripojenia.",
    capabilities: "Funkcie", lastVerified: "Naposledy overené", lastSync: "Posledná synchronizácia", never: "Nikdy",
    connect: "Pripojiť", reconnect: "Znovu pripojiť", disconnect: "Odpojiť",
    configRequired: "Vyžaduje sa konfigurácia", approvalRequired: "Vyžaduje sa schválenie poskytovateľom", notAvailable: "V tomto kroku nedostupné",
    disconnected: "Odpojené.", denied: "Nemáte oprávnenie spravovať platformy.",
    connectLeadWebhook: "Pripojiť webhook Lead Ads",
    leadWebhookConnected: "Webhook Lead Ads bol pripojený.",
    leadWebhookFailed: "Webhook Lead Ads sa nepodarilo pripojiť. Skúste to znova.",
    leadPagesSummary: (ready, total) => `Pripravených ${ready} z ${total} Facebook stránok`,
    leadPagesNone: "Zatiaľ nie je pripojená žiadna Facebook stránka.",
    leadPagesScopeNote: "Lead Ads sa vzťahuje len na Facebook stránky. Instagram účty nie sú zdrojom leadov.",
    unnamedPage: "Stránka bez názvu",
  },
  status: { new: "Nový", contacted: "Kontaktovaný", handled: "Vybavený", customer: "Zákazník", rejected: "Zamietnutý" },
  source: { facebook: "Facebook", instagram: "Instagram", google_ads: "Google Ads", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", web_form: "Web formulár" },
  provider: { meta: "Meta (Facebook a Instagram)", google: "Google Ads a YouTube", tiktok: "TikTok", linkedin: "LinkedIn" },
  connStatus: {
    not_configured: "Nenakonfigurované", pending: "Čaká sa", active: "Pripojené", reauth_required: "Vyžaduje sa opätovná autorizácia",
    disconnected: "Odpojené", error: "Chyba", awaiting_provider_approval: "Čaká na schválenie poskytovateľom",
  },
  capability: { lead_ingestion: "Získavanie leadov", comment_moderation: "Moderovanie komentárov", brand_monitoring: "Monitoring značky" },
  metaLead: {
    title: "Lead Ads",
    available: "Aktívne — leady sa získavajú automaticky", config_missing: "Meta aplikácia nie je nakonfigurovaná",
    entitlement_locked: "Nie je súčasťou vášho plánu", no_linked_account: "Žiadny prepojený Meta účet",
    connection_inactive: "Pripojenie neaktívne", credential_unavailable: "Poverenie nedostupné — vyžaduje sa opätovné pripojenie",
    permission_missing: "Oprávnenie na leady neudelené",
    webhook_subscription_missing: "Webhook Lead Ads nie je pripojený",
    awaiting_provider_approval: "Čaká na schválenie Meta aplikácie",
  },
  onboarding: {
    title: "Výsledok pripojenia Meta", detailCta: "Zobraziť jednotlivé stránky", pages: "Stránky",
    lead_ads_ready: "Pripojené a Lead Ads je pripravené",
    leads_permission_missing: "Pripojené, ale prístup k leadom nebol udelený",
    webhook_not_verified: "Pripojené, ale webhook Lead Ads zatiaľ nie je overený",
    provider_approval_required: "Pripojené, ale stále sa vyžaduje schválenie Meta aplikácie",
    comments_only: "Pripojené na monitorovanie komentárov",
    verification_unavailable: "Pripojené — kontrola Lead Ads je dočasne nedostupná",
  },
};

const de: BusinessDict = {
  contacts: {
    title: "Kontakte", desc: "Geschäftliche Leads aus Ihren verbundenen Plattformen.", total: (n) => `${n} Kontakte`,
    filterStatus: "Status", filterSource: "Quelle", all: "Alle",
    colName: "Name", colContact: "Kontakt", colSource: "Quelle", colCampaign: "Kampagne / Formular", colReceived: "Erhalten", colStatus: "Status", colAssignee: "Zugewiesen",
    noName: "Unbenannter Lead", unassigned: "Nicht zugewiesen", empty: "Noch keine Kontakte. Leads aus verbundenen Plattformen erscheinen hier.", loading: "Kontakte werden geladen…",
    denied: "Sie haben keine Berechtigung, Kontakte anzuzeigen.", error: "Beim Laden der Kontakte ist ein Fehler aufgetreten.",
    changeStatus: "Status ändern", assign: "Zuweisen an", unassign: "Zuweisung aufheben", save: "Speichern", back: "Zurück zu Kontakten",
    detailTitle: "Kontaktdetails", email: "E-Mail", phone: "Telefon", company: "Unternehmen", message: "Nachricht", campaign: "Kampagne", form: "Formular", received: "Erhalten", consent: "Einwilligung",
    consentGranted: "Erteilt", consentDenied: "Nicht erteilt", consentUnknown: "Nicht angegeben",
    statusChanged: "Status aktualisiert.", assigned: "Zuweisung aktualisiert.",
    search: "Suchen", searchPlaceholder: "Name, E-Mail, Telefon oder Unternehmen", searchApply: "Suchen", searchClear: "Zurücksetzen",
    noResults: "Keine Kontakte entsprechen Ihrer Suche.",
    colAssignee2: "Zugewiesen an", colLatestActivity: "Letzte Aktivität", unassignedShort: "Nicht zugewiesen",
    notes: "Interne Notizen", addNote: "Notiz hinzufügen", notePlaceholder: "Interne Notiz schreiben (nur für Ihr Team sichtbar)",
    noteAdded: "Notiz hinzugefügt.", noNotes: "Noch keine Notizen.",
    noteEmpty: "Eine Notiz darf nicht leer sein.", noteTooLong: "Eine Notiz darf höchstens 2.000 Zeichen haben.",
    noteError: "Die Notiz konnte nicht gespeichert werden.",
    activity: "Aktivität", activityReceived: "Kontakt erhalten", activityStatusChanged: "Status geändert",
    activityAssigned: "Zugewiesen", activityUnassigned: "Zuweisung aufgehoben", activityNote: "Notiz hinzugefügt",
    activityBy: "von", activityEmpty: "Noch keine Aktivität.",
    selectRow: "Kontakt auswählen", selectPage: "Alle auf dieser Seite auswählen", selectedCount: (n) => `${n} ausgewählt`,
    clearSelection: "Auswahl aufheben",
    bulkStatus: "Status setzen", bulkAssign: "Zuweisen an", bulkUnassign: "Zuweisung aufheben", apply: "Anwenden",
    exportCsv: "CSV exportieren", exportLimited: (n) => `Export auf die ersten ${n} Kontakte begrenzt.`,
    bulkAffected: (n) => `${n} Kontakte aktualisiert`, bulkFailed: (n) => `${n} Kontakte konnten nicht aktualisiert werden`,
    bulkNoneSelected: "Wählen Sie zuerst mindestens einen Kontakt aus.",
    bulkTooMany: "Sie können höchstens 100 Kontakte gleichzeitig aktualisieren.",
    bulkInvalid: "Die Auswahl war ungültig. Bitte erneut auswählen und nochmals versuchen.",
    bulkAssigneeInvalid: "Dieses Teammitglied ist in diesem Arbeitsbereich nicht verfügbar.",
    bulkDenied: "Sie haben keine Berechtigung für diese Aktion.",
    bulkFailedGeneric: "Der Vorgang konnte nicht abgeschlossen werden.",
    rateLimited: "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.",
  },
  platforms: {
    title: "Verbundene Plattformen", desc: "Verbinden Sie Werbe- und Social-Plattformen für die Lead-Erfassung. Kommentarmoderation ist eine separate Funktion derselben Verbindung.",
    capabilities: "Funktionen", lastVerified: "Zuletzt verifiziert", lastSync: "Letzte Synchronisierung", never: "Nie",
    connect: "Verbinden", reconnect: "Neu verbinden", disconnect: "Trennen",
    configRequired: "Konfiguration erforderlich", approvalRequired: "Freigabe des Anbieters erforderlich", notAvailable: "In diesem Schritt nicht verfügbar",
    disconnected: "Getrennt.", denied: "Sie haben keine Berechtigung, Plattformen zu verwalten.",
    connectLeadWebhook: "Lead-Ads-Webhook verbinden",
    leadWebhookConnected: "Lead-Ads-Webhook wurde verbunden.",
    leadWebhookFailed: "Der Lead-Ads-Webhook konnte nicht verbunden werden. Bitte erneut versuchen.",
    leadPagesSummary: (ready, total) => `${ready} von ${total} Facebook-Seiten bereit`,
    leadPagesNone: "Noch keine Facebook-Seite verbunden.",
    leadPagesScopeNote: "Lead Ads gilt nur für Facebook-Seiten. Instagram-Konten sind keine Lead-Quellen.",
    unnamedPage: "Seite ohne Namen",
  },
  status: { new: "Neu", contacted: "Kontaktiert", handled: "Bearbeitet", customer: "Kunde", rejected: "Abgelehnt" },
  source: { facebook: "Facebook", instagram: "Instagram", google_ads: "Google Ads", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", web_form: "Webformular" },
  provider: { meta: "Meta (Facebook & Instagram)", google: "Google Ads & YouTube", tiktok: "TikTok", linkedin: "LinkedIn" },
  connStatus: {
    not_configured: "Nicht konfiguriert", pending: "Ausstehend", active: "Verbunden", reauth_required: "Neuautorisierung erforderlich",
    disconnected: "Getrennt", error: "Fehler", awaiting_provider_approval: "Warten auf Anbieterfreigabe",
  },
  capability: { lead_ingestion: "Lead-Erfassung", comment_moderation: "Kommentarmoderation", brand_monitoring: "Markenüberwachung" },
  metaLead: {
    title: "Lead Ads",
    available: "Aktiv — Leads werden automatisch erfasst", config_missing: "Meta-App nicht konfiguriert",
    entitlement_locked: "Nicht in Ihrem Tarif enthalten", no_linked_account: "Kein verknüpftes Meta-Konto",
    connection_inactive: "Verbindung inaktiv", credential_unavailable: "Anmeldedaten nicht verfügbar — Neuverbindung erforderlich",
    permission_missing: "Lead-Berechtigung nicht erteilt",
    webhook_subscription_missing: "Lead-Ads-Webhook ist nicht verbunden",
    awaiting_provider_approval: "Warten auf Meta-App-Prüfung",
  },
  onboarding: {
    title: "Ergebnis der Meta-Verbindung", detailCta: "Einzelne Seiten ansehen", pages: "Seiten",
    lead_ads_ready: "Verbunden und Lead Ads bereit",
    leads_permission_missing: "Verbunden, aber Lead-Zugriff wurde nicht erteilt",
    webhook_not_verified: "Verbunden, aber der Lead-Ads-Webhook ist noch nicht verifiziert",
    provider_approval_required: "Verbunden, aber die Meta-App-Prüfung steht noch aus",
    comments_only: "Für Kommentarüberwachung verbunden",
    verification_unavailable: "Verbunden — Lead-Ads-Prüfung vorübergehend nicht verfügbar",
  },
};

const DICTS: Record<Locale, BusinessDict> = { en, sk, de };
export function businessDict(locale: Locale): BusinessDict { return DICTS[locale] ?? en; }
/** Safe enum→label lookup (falls back to the raw key, never throws). */
export function bizLabel<K extends string>(map: Record<K, string>, key: K): string { return map[key] ?? String(key); }
