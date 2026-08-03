/**
 * Platform Admin & Privacy Analytics V1 — localized copy (en/sk/de), identical key structure across locales
 * (asserted by the UI test). Content-free labels only; no raw backend enum is ever rendered.
 */
import type { Locale } from "@/i18n/config";

type Dict = Record<string, string>;
export interface AdminCopy {
  restrictedBanner: string;
  unauthorized: { title: string; body: string; cta: string };
  nav: { dashboard: string; analytics: string; administrators: string; audit: string; systemHealth: string; exitAdmin: string };
  privacyWarnings: string[];
  cards: { pageViews: string; sessions: string; approxVisitors: string; engagedSessions: string; bounceRate: string; conversionRate: string; registrations: string; contacts: string; integrations: string };
  sections: { summary: string; overTime: string; topPages: string; landingPages: string; exitPages: string; acquisition: string; campaigns: string; countries: string; languages: string; devices: string; browsers: string; operatingSystems: string; conversions: string; funnels: string; errors: string; botTraffic: string; collection: string; recentAudit: string; retention: string };
  dateFilters: { today: string; last7: string; last30: string; last90: string; custom: string; from: string; to: string; apply: string; includeBots: string };
  fields: { metric: string; value: string; page: string; count: string; sessions: string; conversions: string; suppressed: string; approxNote: string; started: string; completed: string; completionRate: string; empty: string; loading: string; export: string; when: string; actor: string; action: string; target: string; result: string; role: string; status: string; email: string; name: string; lastAccess: string; lastChange: string; active: string; inactive: string };
  roleLabel: Dict; auditActionLabel: Dict; referrerLabel: Dict; deviceLabel: Dict; browserLabel: Dict; osLabel: Dict; botLabel: Dict; consentLabel: Dict; conversionLabel: Dict;
  metaReview: {
    title: string; desc: string; note: string;
    appCredentials: string; oauthCallback: string; webhookVerifyToken: string; webhookSync: string;
    privacyRoute: string; deletionRoute: string; deauthRoute: string; deletionInstructions: string;
    scopes: string; scopesAll: string;
    businessVerification: string; advancedAccess: string; attestationNote: string;
    yes: string; no: string;
  };
  admin: { addExisting: string; changeRole: string; deactivate: string; reactivate: string; addEmail: string; addRole: string; add: string; confirmDeactivate: string; confirmChange: string; reauthWarning: string; lastOwnerNote: string; mfaReadiness: string; confirm: string; cancel: string; working: string };
  errorRef: Dict;
}

const roleLabel = {
  en: { none: "None", staff: "Staff (legacy)", admin: "Platform admin", owner: "Platform owner", analyst: "Platform analyst", support: "Platform support" },
  sk: { none: "Žiadna", staff: "Personál (staršie)", admin: "Administrátor platformy", owner: "Vlastník platformy", analyst: "Analytik platformy", support: "Podpora platformy" },
  de: { none: "Keine", staff: "Personal (Alt)", admin: "Plattform-Admin", owner: "Plattform-Eigentümer", analyst: "Plattform-Analyst", support: "Plattform-Support" },
};
const auditActionLabel = {
  en: { "admin.area_accessed": "Admin area accessed", "admin.access_denied": "Access denied", "analytics.viewed": "Analytics viewed", "analytics.exported": "Analytics exported", "admin_user.added": "Administrator added", "admin_user.role_changed": "Role changed", "admin_user.deactivated": "Administrator deactivated", "admin_user.reactivated": "Administrator reactivated", "bootstrap.owner_assigned": "Bootstrap owner assigned", "retention.executed": "Retention executed", "aggregation.executed": "Aggregation executed", "analytics.collection_setting_changed": "Collection setting changed", "privileged.reauth_required": "Re-authentication required", "privileged.action_rejected": "Privileged action rejected", "system_health.viewed": "System health viewed", "audit.viewed": "Audit viewed" },
  sk: { "admin.area_accessed": "Prístup do admin oblasti", "admin.access_denied": "Prístup zamietnutý", "analytics.viewed": "Zobrazená analytika", "analytics.exported": "Export analytiky", "admin_user.added": "Pridaný administrátor", "admin_user.role_changed": "Zmenená rola", "admin_user.deactivated": "Deaktivovaný administrátor", "admin_user.reactivated": "Reaktivovaný administrátor", "bootstrap.owner_assigned": "Priradený úvodný vlastník", "retention.executed": "Vykonané uchovávanie", "aggregation.executed": "Vykonaná agregácia", "analytics.collection_setting_changed": "Zmenené nastavenie zberu", "privileged.reauth_required": "Vyžaduje sa opätovné overenie", "privileged.action_rejected": "Privilegovaná akcia zamietnutá", "system_health.viewed": "Zobrazený stav systému", "audit.viewed": "Zobrazený audit" },
  de: { "admin.area_accessed": "Adminbereich aufgerufen", "admin.access_denied": "Zugriff verweigert", "analytics.viewed": "Analytics angesehen", "analytics.exported": "Analytics exportiert", "admin_user.added": "Administrator hinzugefügt", "admin_user.role_changed": "Rolle geändert", "admin_user.deactivated": "Administrator deaktiviert", "admin_user.reactivated": "Administrator reaktiviert", "bootstrap.owner_assigned": "Bootstrap-Eigentümer zugewiesen", "retention.executed": "Aufbewahrung ausgeführt", "aggregation.executed": "Aggregation ausgeführt", "analytics.collection_setting_changed": "Erfassungseinstellung geändert", "privileged.reauth_required": "Erneute Authentifizierung erforderlich", "privileged.action_rejected": "Privilegierte Aktion abgelehnt", "system_health.viewed": "Systemzustand angesehen", "audit.viewed": "Audit angesehen" },
};
const referrerLabel = {
  en: { DIRECT: "Direct", ORGANIC_SEARCH: "Organic search", SOCIAL: "Social", REFERRAL: "Referral", EMAIL: "Email", PAID: "Paid", INTERNAL: "Internal", UNKNOWN: "Unknown" },
  sk: { DIRECT: "Priamy", ORGANIC_SEARCH: "Organické vyhľadávanie", SOCIAL: "Sociálne", REFERRAL: "Odkaz", EMAIL: "E-mail", PAID: "Platené", INTERNAL: "Interné", UNKNOWN: "Neznáme" },
  de: { DIRECT: "Direkt", ORGANIC_SEARCH: "Organische Suche", SOCIAL: "Sozial", REFERRAL: "Verweis", EMAIL: "E-Mail", PAID: "Bezahlt", INTERNAL: "Intern", UNKNOWN: "Unbekannt" },
};
const deviceLabel = {
  en: { DESKTOP: "Desktop", MOBILE: "Mobile", TABLET: "Tablet", BOT: "Bot", UNKNOWN: "Unknown" },
  sk: { DESKTOP: "Počítač", MOBILE: "Mobil", TABLET: "Tablet", BOT: "Bot", UNKNOWN: "Neznáme" },
  de: { DESKTOP: "Desktop", MOBILE: "Mobil", TABLET: "Tablet", BOT: "Bot", UNKNOWN: "Unbekannt" },
};
const browserLabel = {
  en: { Chrome: "Chrome", Safari: "Safari", Firefox: "Firefox", Edge: "Edge", Other: "Other", Unknown: "Unknown" },
  sk: { Chrome: "Chrome", Safari: "Safari", Firefox: "Firefox", Edge: "Edge", Other: "Iné", Unknown: "Neznáme" },
  de: { Chrome: "Chrome", Safari: "Safari", Firefox: "Firefox", Edge: "Edge", Other: "Andere", Unknown: "Unbekannt" },
};
const osLabel = {
  en: { iOS: "iOS", Android: "Android", macOS: "macOS", Windows: "Windows", Linux: "Linux", Other: "Other", Unknown: "Unknown" },
  sk: { iOS: "iOS", Android: "Android", macOS: "macOS", Windows: "Windows", Linux: "Linux", Other: "Iné", Unknown: "Neznáme" },
  de: { iOS: "iOS", Android: "Android", macOS: "macOS", Windows: "Windows", Linux: "Linux", Other: "Andere", Unknown: "Unbekannt" },
};
const botLabel = {
  en: { HUMAN_LIKELY: "Human (likely)", KNOWN_BOT: "Known bot", SUSPECTED_BOT: "Suspected bot", UNKNOWN: "Unknown" },
  sk: { HUMAN_LIKELY: "Človek (pravdepodobne)", KNOWN_BOT: "Známy bot", SUSPECTED_BOT: "Podozrivý bot", UNKNOWN: "Neznáme" },
  de: { HUMAN_LIKELY: "Mensch (wahrsch.)", KNOWN_BOT: "Bekannter Bot", SUSPECTED_BOT: "Verdächtiger Bot", UNKNOWN: "Unbekannt" },
};
const consentLabel = {
  en: { ENABLED: "Enabled", DISABLED: "Disabled", UNKNOWN: "Unknown", WITHDRAWN: "Withdrawn" },
  sk: { ENABLED: "Povolené", DISABLED: "Zakázané", UNKNOWN: "Neznáme", WITHDRAWN: "Odvolané" },
  de: { ENABLED: "Aktiviert", DISABLED: "Deaktiviert", UNKNOWN: "Unbekannt", WITHDRAWN: "Widerrufen" },
};
const conversionLabel = {
  en: { REGISTRATION_COMPLETED: "Registrations", LOGIN_COMPLETED: "Logins", CONTACT_FORM_SUBMITTED: "Contact submissions", INTEGRATION_CONNECT_COMPLETED: "Integration connects" },
  sk: { REGISTRATION_COMPLETED: "Registrácie", LOGIN_COMPLETED: "Prihlásenia", CONTACT_FORM_SUBMITTED: "Odoslané kontakty", INTEGRATION_CONNECT_COMPLETED: "Pripojenia integrácií" },
  de: { REGISTRATION_COMPLETED: "Registrierungen", LOGIN_COMPLETED: "Anmeldungen", CONTACT_FORM_SUBMITTED: "Kontaktanfragen", INTEGRATION_CONNECT_COMPLETED: "Integrationsverbindungen" },
};
const errorRef = {
  en: { forbidden: "You do not have permission for this action.", reauth_required: "Please re-authenticate to perform this privileged action.", last_owner_protected: "The last active platform owner cannot be removed.", cannot_self_manage: "You cannot change your own platform access.", unsupported_role: "That platform role is not assignable.", version_conflict: "This changed in another tab — reload and retry.", not_found: "Not found.", bad_input: "Invalid input." },
  sk: { forbidden: "Na túto akciu nemáte oprávnenie.", reauth_required: "Pre túto privilegovanú akciu sa znova overte.", last_owner_protected: "Posledného aktívneho vlastníka platformy nemožno odstrániť.", cannot_self_manage: "Nemôžete zmeniť svoj vlastný prístup k platforme.", unsupported_role: "Táto rola platformy nie je priraditeľná.", version_conflict: "Zmenilo sa to v inej karte — obnovte a skúste znova.", not_found: "Nenájdené.", bad_input: "Neplatný vstup." },
  de: { forbidden: "Sie haben keine Berechtigung für diese Aktion.", reauth_required: "Bitte erneut authentifizieren, um diese privilegierte Aktion auszuführen.", last_owner_protected: "Der letzte aktive Plattform-Eigentümer kann nicht entfernt werden.", cannot_self_manage: "Sie können Ihren eigenen Plattformzugriff nicht ändern.", unsupported_role: "Diese Plattformrolle ist nicht zuweisbar.", version_conflict: "In einem anderen Tab geändert — neu laden und erneut versuchen.", not_found: "Nicht gefunden.", bad_input: "Ungültige Eingabe." },
};

function build(l: "en" | "sk" | "de", t: Omit<AdminCopy, "roleLabel" | "auditActionLabel" | "referrerLabel" | "deviceLabel" | "browserLabel" | "osLabel" | "botLabel" | "consentLabel" | "conversionLabel" | "errorRef">): AdminCopy {
  return { ...t, roleLabel: roleLabel[l], auditActionLabel: auditActionLabel[l], referrerLabel: referrerLabel[l], deviceLabel: deviceLabel[l], browserLabel: browserLabel[l], osLabel: osLabel[l], botLabel: botLabel[l], consentLabel: consentLabel[l], conversionLabel: conversionLabel[l], errorRef: errorRef[l] };
}

const CARDS_EN = { pageViews: "Page views", sessions: "Sessions", approxVisitors: "Approx. unique visitors", engagedSessions: "Engaged sessions", bounceRate: "Bounce rate", conversionRate: "Conversion rate", registrations: "Registrations", contacts: "Contact conversions", integrations: "Integration connects" };
const DATE_EN = { today: "Today", last7: "Last 7 days", last30: "Last 30 days", last90: "Last 90 days", custom: "Custom", from: "From", to: "To", apply: "Apply", includeBots: "Include bots" };

export const ADMIN_COPY: Record<Locale, AdminCopy> = {
  en: build("en", {
    restrictedBanner: "Restricted platform-administration area. Access is limited to authorized Tamanor operators and is audited.",
    unauthorized: { title: "Access denied", body: "This area is restricted to authorized platform operators.", cta: "Back to dashboard" },
    nav: { dashboard: "Overview", analytics: "Analytics", administrators: "Administrators", audit: "Audit log", systemHealth: "System health", exitAdmin: "Exit admin" },
    privacyWarnings: [
      "First-party, privacy-preserving analytics — no raw IP, precise location, raw query strings, or user-agent strings are stored.",
      "Visitor and session identifiers are pseudonymous, rotating, and non-reversible; they are never shown here.",
      "No customer messages, Child Safety data, or tenant-private content is accessible in this area.",
      "Approximate unique visitors are estimates (rotating identifiers + consent limits).",
    ],
    cards: CARDS_EN,
    sections: { summary: "Summary", overTime: "Traffic over time", topPages: "Top pages", landingPages: "Landing pages", exitPages: "Exit pages", acquisition: "Acquisition channels", campaigns: "Campaigns", countries: "Countries", languages: "Languages", devices: "Devices", browsers: "Browsers", operatingSystems: "Operating systems", conversions: "Conversions", funnels: "Funnels", errors: "Error pages", botTraffic: "Bot traffic", collection: "Collection & consent", recentAudit: "Recent activity", retention: "Retention & aggregation" },
    dateFilters: DATE_EN,
    fields: { metric: "Metric", value: "Value", page: "Page", count: "Views", sessions: "Sessions", conversions: "Conversions", suppressed: "low-count groups hidden", approxNote: "Approximate — rotating identifiers", started: "Started", completed: "Completed", completionRate: "Completion", empty: "No data yet.", loading: "Loading…", export: "Export CSV", when: "When", actor: "Actor", action: "Action", target: "Target", result: "Result", role: "Role", status: "Status", email: "Email", name: "Name", lastAccess: "Last access", lastChange: "Last role change", active: "Active", inactive: "Deactivated" },
    metaReview: {
      title: "Meta App Review readiness", desc: "Configuration facts for external-customer access. Booleans only — no values are shown.",
      note: "This page never claims Meta approval. Approval and access levels are granted in the Meta dashboard and cannot be observed from here.",
      appCredentials: "App credentials configured", oauthCallback: "OAuth callback configured", webhookVerifyToken: "Webhook verify token configured", webhookSync: "Webhook processing enabled",
      privacyRoute: "Privacy policy route", deletionRoute: "Data deletion callback", deauthRoute: "Deauthorize callback", deletionInstructions: "Deletion instructions route",
      scopes: "Required permissions configured", scopesAll: "All required permissions configured",
      businessVerification: "Business verification (operator attestation)", advancedAccess: "Advanced Access (operator attestation)",
      attestationNote: "Attestations are operator-set configuration flags, not verified Meta states.",
      yes: "Yes", no: "No",
    },
    admin: { addExisting: "Add existing user", changeRole: "Change role", deactivate: "Deactivate", reactivate: "Reactivate", addEmail: "User email", addRole: "Platform role", add: "Add administrator", confirmDeactivate: "Deactivate this administrator's platform access?", confirmChange: "Change this administrator's platform role?", reauthWarning: "Sensitive changes require a recent sign-in.", lastOwnerNote: "The last active owner cannot be removed.", mfaReadiness: "MFA / passkey", confirm: "Confirm", cancel: "Cancel", working: "Working…" },
  }),
  sk: build("sk", {
    restrictedBanner: "Obmedzená oblasť administrácie platformy. Prístup je len pre autorizovaných operátorov Tamanor a je auditovaný.",
    unauthorized: { title: "Prístup zamietnutý", body: "Táto oblasť je vyhradená pre autorizovaných operátorov platformy.", cta: "Späť na nástenku" },
    nav: { dashboard: "Prehľad", analytics: "Analytika", administrators: "Administrátori", audit: "Audit", systemHealth: "Stav systému", exitAdmin: "Ukončiť admin" },
    privacyWarnings: [
      "Prvostranová analytika chrániaca súkromie — neuchováva sa žiadna surová IP, presná poloha, surové reťazce dopytov ani reťazce user-agent.",
      "Identifikátory návštevníka a relácie sú pseudonymné, rotujúce a nezvratné; nikdy sa tu nezobrazujú.",
      "V tejto oblasti nie sú dostupné žiadne správy zákazníkov, dáta ochrany detí ani súkromný obsah nájomcov.",
      "Približní jedineční návštevníci sú odhady (rotujúce identifikátory + obmedzenia súhlasu).",
    ],
    cards: { pageViews: "Zobrazenia stránok", sessions: "Relácie", approxVisitors: "Približní jedineční návštevníci", engagedSessions: "Zapojené relácie", bounceRate: "Miera odchodov", conversionRate: "Miera konverzie", registrations: "Registrácie", contacts: "Konverzie kontaktov", integrations: "Pripojenia integrácií" },
    sections: { summary: "Súhrn", overTime: "Návštevnosť v čase", topPages: "Najlepšie stránky", landingPages: "Vstupné stránky", exitPages: "Výstupné stránky", acquisition: "Akvizičné kanály", campaigns: "Kampane", countries: "Krajiny", languages: "Jazyky", devices: "Zariadenia", browsers: "Prehliadače", operatingSystems: "Operačné systémy", conversions: "Konverzie", funnels: "Lieviky", errors: "Chybové stránky", botTraffic: "Botová prevádzka", collection: "Zber a súhlas", recentAudit: "Nedávna aktivita", retention: "Uchovávanie a agregácia" },
    dateFilters: { today: "Dnes", last7: "Posledných 7 dní", last30: "Posledných 30 dní", last90: "Posledných 90 dní", custom: "Vlastné", from: "Od", to: "Do", apply: "Použiť", includeBots: "Zahrnúť boty" },
    fields: { metric: "Metrika", value: "Hodnota", page: "Stránka", count: "Zobrazenia", sessions: "Relácie", conversions: "Konverzie", suppressed: "skryté skupiny s nízkym počtom", approxNote: "Približné — rotujúce identifikátory", started: "Začaté", completed: "Dokončené", completionRate: "Dokončenie", empty: "Zatiaľ žiadne dáta.", loading: "Načítava sa…", export: "Exportovať CSV", when: "Kedy", actor: "Aktér", action: "Akcia", target: "Cieľ", result: "Výsledok", role: "Rola", status: "Stav", email: "E-mail", name: "Meno", lastAccess: "Posledný prístup", lastChange: "Posledná zmena roly", active: "Aktívny", inactive: "Deaktivovaný" },
    metaReview: {
      title: "Pripravenosť na Meta App Review", desc: "Konfiguračné fakty pre prístup externých zákazníkov. Len logické hodnoty — žiadne hodnoty sa nezobrazujú.",
      note: "Táto stránka nikdy netvrdí, že Meta udelila schválenie. Schválenie a úrovne prístupu sa udeľujú v paneli Meta a odtiaľto ich nemožno overiť.",
      appCredentials: "Poverenia aplikácie nakonfigurované", oauthCallback: "OAuth callback nakonfigurovaný", webhookVerifyToken: "Overovací token webhooku nakonfigurovaný", webhookSync: "Spracovanie webhookov zapnuté",
      privacyRoute: "Trasa zásad ochrany osobných údajov", deletionRoute: "Callback na vymazanie údajov", deauthRoute: "Callback na zrušenie autorizácie", deletionInstructions: "Trasa s pokynmi na vymazanie",
      scopes: "Požadované oprávnenia nakonfigurované", scopesAll: "Všetky požadované oprávnenia nakonfigurované",
      businessVerification: "Overenie firmy (vyhlásenie prevádzkovateľa)", advancedAccess: "Rozšírený prístup (vyhlásenie prevádzkovateľa)",
      attestationNote: "Vyhlásenia sú konfiguračné príznaky nastavené prevádzkovateľom, nie overené stavy zo strany Meta.",
      yes: "Áno", no: "Nie",
    },
    admin: { addExisting: "Pridať existujúceho používateľa", changeRole: "Zmeniť rolu", deactivate: "Deaktivovať", reactivate: "Reaktivovať", addEmail: "E-mail používateľa", addRole: "Rola platformy", add: "Pridať administrátora", confirmDeactivate: "Deaktivovať prístup tohto administrátora k platforme?", confirmChange: "Zmeniť rolu tohto administrátora na platforme?", reauthWarning: "Citlivé zmeny vyžadujú nedávne prihlásenie.", lastOwnerNote: "Posledného aktívneho vlastníka nemožno odstrániť.", mfaReadiness: "MFA / passkey", confirm: "Potvrdiť", cancel: "Zrušiť", working: "Pracuje sa…" },
  }),
  de: build("de", {
    restrictedBanner: "Eingeschränkter Plattform-Administrationsbereich. Der Zugriff ist auf autorisierte Tamanor-Betreiber beschränkt und wird protokolliert.",
    unauthorized: { title: "Zugriff verweigert", body: "Dieser Bereich ist autorisierten Plattform-Betreibern vorbehalten.", cta: "Zurück zum Dashboard" },
    nav: { dashboard: "Übersicht", analytics: "Analytics", administrators: "Administratoren", audit: "Auditprotokoll", systemHealth: "Systemzustand", exitAdmin: "Admin verlassen" },
    privacyWarnings: [
      "Datenschutzfreundliche First-Party-Analytics — keine rohe IP, kein genauer Standort, keine rohen Query-Strings oder User-Agent-Strings werden gespeichert.",
      "Besucher- und Sitzungskennungen sind pseudonym, rotierend und nicht umkehrbar; sie werden hier nie angezeigt.",
      "In diesem Bereich sind keine Kundennachrichten, Kinderschutzdaten oder mandantenprivaten Inhalte zugänglich.",
      "Ungefähre eindeutige Besucher sind Schätzungen (rotierende Kennungen + Einwilligungsgrenzen).",
    ],
    cards: { pageViews: "Seitenaufrufe", sessions: "Sitzungen", approxVisitors: "Ungef. eindeutige Besucher", engagedSessions: "Engagierte Sitzungen", bounceRate: "Absprungrate", conversionRate: "Conversion-Rate", registrations: "Registrierungen", contacts: "Kontakt-Conversions", integrations: "Integrationsverbindungen" },
    sections: { summary: "Zusammenfassung", overTime: "Traffic im Zeitverlauf", topPages: "Top-Seiten", landingPages: "Landingpages", exitPages: "Ausstiegsseiten", acquisition: "Akquisekanäle", campaigns: "Kampagnen", countries: "Länder", languages: "Sprachen", devices: "Geräte", browsers: "Browser", operatingSystems: "Betriebssysteme", conversions: "Conversions", funnels: "Trichter", errors: "Fehlerseiten", botTraffic: "Bot-Traffic", collection: "Erfassung & Einwilligung", recentAudit: "Letzte Aktivität", retention: "Aufbewahrung & Aggregation" },
    dateFilters: { today: "Heute", last7: "Letzte 7 Tage", last30: "Letzte 30 Tage", last90: "Letzte 90 Tage", custom: "Benutzerdefiniert", from: "Von", to: "Bis", apply: "Anwenden", includeBots: "Bots einbeziehen" },
    fields: { metric: "Metrik", value: "Wert", page: "Seite", count: "Aufrufe", sessions: "Sitzungen", conversions: "Conversions", suppressed: "Gruppen mit geringer Anzahl ausgeblendet", approxNote: "Ungefähr — rotierende Kennungen", started: "Begonnen", completed: "Abgeschlossen", completionRate: "Abschluss", empty: "Noch keine Daten.", loading: "Wird geladen…", export: "CSV exportieren", when: "Wann", actor: "Akteur", action: "Aktion", target: "Ziel", result: "Ergebnis", role: "Rolle", status: "Status", email: "E-Mail", name: "Name", lastAccess: "Letzter Zugriff", lastChange: "Letzte Rollenänderung", active: "Aktiv", inactive: "Deaktiviert" },
    metaReview: {
      title: "Bereitschaft für Meta App Review", desc: "Konfigurationsfakten für den Zugang externer Kunden. Nur Wahrheitswerte — es werden keine Werte angezeigt.",
      note: "Diese Seite behauptet niemals eine Meta-Freigabe. Freigabe und Zugriffsstufen werden im Meta-Dashboard erteilt und sind von hier aus nicht überprüfbar.",
      appCredentials: "App-Zugangsdaten konfiguriert", oauthCallback: "OAuth-Callback konfiguriert", webhookVerifyToken: "Webhook-Verifizierungstoken konfiguriert", webhookSync: "Webhook-Verarbeitung aktiviert",
      privacyRoute: "Route der Datenschutzerklärung", deletionRoute: "Callback zur Datenlöschung", deauthRoute: "Callback zur Deautorisierung", deletionInstructions: "Route mit Löschanweisungen",
      scopes: "Erforderliche Berechtigungen konfiguriert", scopesAll: "Alle erforderlichen Berechtigungen konfiguriert",
      businessVerification: "Unternehmensverifizierung (Betreiberzusicherung)", advancedAccess: "Erweiterter Zugriff (Betreiberzusicherung)",
      attestationNote: "Zusicherungen sind vom Betreiber gesetzte Konfigurationsflags, keine verifizierten Meta-Zustände.",
      yes: "Ja", no: "Nein",
    },
    admin: { addExisting: "Bestehenden Benutzer hinzufügen", changeRole: "Rolle ändern", deactivate: "Deaktivieren", reactivate: "Reaktivieren", addEmail: "Benutzer-E-Mail", addRole: "Plattformrolle", add: "Administrator hinzufügen", confirmDeactivate: "Plattformzugriff dieses Administrators deaktivieren?", confirmChange: "Plattformrolle dieses Administrators ändern?", reauthWarning: "Sensible Änderungen erfordern eine kürzliche Anmeldung.", lastOwnerNote: "Der letzte aktive Eigentümer kann nicht entfernt werden.", mfaReadiness: "MFA / Passkey", confirm: "Bestätigen", cancel: "Abbrechen", working: "Wird ausgeführt…" },
  }),
};
