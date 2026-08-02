/**
 * BUSINESS — Connected Platforms & Contacts V1 — co-located i18n (SK/EN/DE). Kept out of the central i18n-check
 * like the other feature dicts (ato-i18n / cb-i18n / family-*). Content-free: labels only, no PII, no ids.
 */
import type { Locale } from "@/i18n";
import {
  BusinessContactStatus, BusinessContactSource, BusinessProvider, BusinessConnectionStatus,
  BusinessConnectionCapability, type MetaLeadCapabilityState,
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
  };
  platforms: {
    title: string; desc: string;
    capabilities: string; lastVerified: string; lastSync: string; never: string;
    connect: string; reconnect: string; disconnect: string;
    configRequired: string; approvalRequired: string; notAvailable: string;
    disconnected: string; denied: string;
    /** BUSINESS-LEADGEN-SUBSCRIPTION-V1 — one-click Page↔app `leadgen` webhook repair. */
    connectLeadWebhook: string; leadWebhookConnected: string; leadWebhookFailed: string;
  };
  status: Record<BusinessContactStatus, string>;
  source: Record<BusinessContactSource, string>;
  provider: Record<BusinessProvider, string>;
  connStatus: Record<BusinessConnectionStatus, string>;
  capability: Record<BusinessConnectionCapability, string>;
  metaLead: { title: string } & Record<MetaLeadCapabilityState, string>;
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
};

const DICTS: Record<Locale, BusinessDict> = { en, sk, de };
export function businessDict(locale: Locale): BusinessDict { return DICTS[locale] ?? en; }
/** Safe enum→label lookup (falls back to the raw key, never throws). */
export function bizLabel<K extends string>(map: Record<K, string>, key: K): string { return map[key] ?? String(key); }
