import type { Locale } from "@/i18n";
import { FAMILY_NOTIFICATION_TYPES, type FamilyNotificationType, type FamilyNotificationSeverity } from "@guardora/core";

/**
 * FAMILY NOTIFICATION CENTER V1 — co-located SK/EN/DE localization (not part of the main i18n-check, like
 * family-i18n). Every Family notification TYPE, severity label, center string and bell label is here; the UI
 * NEVER renders a raw enum value or a backend error. Titles/bodies are SAFE, content-free ("A new safety signal
 * is available") — they never contain a name, age, email, note, or any entity detail. Parity across the three
 * locales + full type coverage are asserted by family-notifications-i18n.test.ts.
 */
export interface FamilyNotifDict {
  center: {
    title: string; description: string;
    tabAll: string; tabUnread: string;
    markRead: string; markAllRead: string; dismiss: string;
    empty: string; emptyUnread: string; unavailable: string;
    loading: string; error: string;
    open: string; loadMore: string; viewAll: string; routeUnavailable: string; openFailed: string;
    markedRead: string; markedAllRead: string; dismissed: string;
  };
  bell: { label: (unread: string) => string; none: string; open: string };
  severity: Record<FamilyNotificationSeverity, string>;
  types: Record<FamilyNotificationType, { title: string; body: string }>;
}

const en: FamilyNotifDict = {
  center: {
    title: "Notifications", description: "Updates about your family workspace. Only events you are authorized to see appear here.",
    tabAll: "All", tabUnread: "Unread",
    markRead: "Mark as read", markAllRead: "Mark all as read", dismiss: "Dismiss",
    empty: "You have no notifications yet.", emptyUnread: "You have no unread notifications.",
    unavailable: "This item is no longer available.",
    loading: "Loading notifications…", error: "Notifications could not be loaded. Please try again.",
    markedRead: "Marked as read.", markedAllRead: "All notifications marked as read.", dismissed: "Notification dismissed.",
    open: "Open", loadMore: "Load more", viewAll: "View all", routeUnavailable: "This destination is not available.", openFailed: "This item could not be opened.",
  },
  bell: { label: (u) => `Notifications, ${u} unread`, none: "Notifications, none unread", open: "Open notifications" },
  severity: { info: "Info", attention: "Attention", urgent: "Urgent" },
  types: {
    family_signal_available: { title: "New safety signal available", body: "A new safety signal you are authorized to review is available." },
    family_urgent_signal: { title: "Urgent safety signal", body: "An urgent safety signal needs your attention." },
    family_incident_created: { title: "Safety incident opened", body: "A safety incident you are authorized to see has been opened." },
    family_incident_escalated: { title: "Safety incident escalated", body: "A safety incident you are authorized to see has been escalated." },
    family_delivery_available: { title: "A delivery is available for you", body: "A guardian delivery is ready for you to review." },
    family_delivery_acknowledged: { title: "Delivery acknowledged", body: "A guardian delivery was acknowledged by its recipient." },
    family_delivery_declined: { title: "Delivery declined", body: "A guardian delivery was declined by its recipient." },
    family_guardian_invitation_accepted: { title: "Guardian invitation accepted", body: "A guardian invitation you sent was accepted." },
    family_guardian_invitation_expiring: { title: "Guardian invitation expiring soon", body: "A guardian invitation you sent is about to expire." },
    family_authority_changed: { title: "Guardian authority changed", body: "A guardian authority relevant to you has changed." },
    family_consent_expiring: { title: "Consent expiring soon", body: "A consent relevant to your family workspace is about to expire." },
    family_recipient_authorization_changed: { title: "Recipient authorization changed", body: "A recipient authorization relevant to you has changed." },
    family_protection_plan_updated: { title: "Protection plan updated", body: "A protection plan you can view has been updated." },
  },
};

const sk: FamilyNotifDict = {
  center: {
    title: "Notifikácie", description: "Aktualizácie vášho rodinného priestoru. Zobrazujú sa len udalosti, na ktoré máte oprávnenie.",
    tabAll: "Všetky", tabUnread: "Neprečítané",
    markRead: "Označiť ako prečítané", markAllRead: "Označiť všetky ako prečítané", dismiss: "Zavrieť",
    empty: "Zatiaľ nemáte žiadne notifikácie.", emptyUnread: "Nemáte žiadne neprečítané notifikácie.",
    unavailable: "Táto položka už nie je dostupná.",
    loading: "Načítavajú sa notifikácie…", error: "Notifikácie sa nepodarilo načítať. Skúste to znova.",
    markedRead: "Označené ako prečítané.", markedAllRead: "Všetky notifikácie sú označené ako prečítané.", dismissed: "Notifikácia bola zavretá.",
    open: "Otvoriť", loadMore: "Načítať ďalšie", viewAll: "Zobraziť všetky", routeUnavailable: "Toto miesto nie je dostupné.", openFailed: "Túto položku sa nepodarilo otvoriť.",
  },
  bell: { label: (u) => `Notifikácie, ${u} neprečítaných`, none: "Notifikácie, žiadne neprečítané", open: "Otvoriť notifikácie" },
  severity: { info: "Informácia", attention: "Pozornosť", urgent: "Naliehavé" },
  types: {
    family_signal_available: { title: "Dostupný nový bezpečnostný signál", body: "Je dostupný nový bezpečnostný signál, ktorý máte oprávnenie skontrolovať." },
    family_urgent_signal: { title: "Naliehavý bezpečnostný signál", body: "Naliehavý bezpečnostný signál si vyžaduje vašu pozornosť." },
    family_incident_created: { title: "Otvorený bezpečnostný incident", body: "Bol otvorený bezpečnostný incident, ktorý máte oprávnenie vidieť." },
    family_incident_escalated: { title: "Eskalovaný bezpečnostný incident", body: "Bezpečnostný incident, ktorý máte oprávnenie vidieť, bol eskalovaný." },
    family_delivery_available: { title: "Je pre vás dostupné doručenie", body: "Doručenie pre opatrovníka je pripravené na kontrolu." },
    family_delivery_acknowledged: { title: "Doručenie potvrdené", body: "Doručenie pre opatrovníka potvrdil jeho príjemca." },
    family_delivery_declined: { title: "Doručenie odmietnuté", body: "Doručenie pre opatrovníka odmietol jeho príjemca." },
    family_guardian_invitation_accepted: { title: "Pozvánka opatrovníka prijatá", body: "Pozvánka opatrovníka, ktorú ste odoslali, bola prijatá." },
    family_guardian_invitation_expiring: { title: "Pozvánka opatrovníka čoskoro vyprší", body: "Pozvánke opatrovníka, ktorú ste odoslali, čoskoro vyprší platnosť." },
    family_authority_changed: { title: "Zmena oprávnenia opatrovníka", body: "Oprávnenie opatrovníka, ktoré sa vás týka, sa zmenilo." },
    family_consent_expiring: { title: "Súhlas čoskoro vyprší", body: "Súhlasu týkajúcemu sa vášho rodinného priestoru čoskoro vyprší platnosť." },
    family_recipient_authorization_changed: { title: "Zmena oprávnenia príjemcu", body: "Oprávnenie príjemcu, ktoré sa vás týka, sa zmenilo." },
    family_protection_plan_updated: { title: "Ochranný plán aktualizovaný", body: "Ochranný plán, ktorý môžete vidieť, bol aktualizovaný." },
  },
};

const de: FamilyNotifDict = {
  center: {
    title: "Benachrichtigungen", description: "Aktualisierungen Ihres Familienbereichs. Es erscheinen nur Ereignisse, für die Sie berechtigt sind.",
    tabAll: "Alle", tabUnread: "Ungelesen",
    markRead: "Als gelesen markieren", markAllRead: "Alle als gelesen markieren", dismiss: "Ausblenden",
    empty: "Sie haben noch keine Benachrichtigungen.", emptyUnread: "Sie haben keine ungelesenen Benachrichtigungen.",
    unavailable: "Dieses Element ist nicht mehr verfügbar.",
    loading: "Benachrichtigungen werden geladen…", error: "Benachrichtigungen konnten nicht geladen werden. Bitte erneut versuchen.",
    markedRead: "Als gelesen markiert.", markedAllRead: "Alle Benachrichtigungen als gelesen markiert.", dismissed: "Benachrichtigung ausgeblendet.",
    open: "Öffnen", loadMore: "Mehr laden", viewAll: "Alle anzeigen", routeUnavailable: "Dieses Ziel ist nicht verfügbar.", openFailed: "Dieses Element konnte nicht geöffnet werden.",
  },
  bell: { label: (u) => `Benachrichtigungen, ${u} ungelesen`, none: "Benachrichtigungen, keine ungelesen", open: "Benachrichtigungen öffnen" },
  severity: { info: "Info", attention: "Achtung", urgent: "Dringend" },
  types: {
    family_signal_available: { title: "Neues Sicherheitssignal verfügbar", body: "Ein neues Sicherheitssignal, das Sie prüfen dürfen, ist verfügbar." },
    family_urgent_signal: { title: "Dringendes Sicherheitssignal", body: "Ein dringendes Sicherheitssignal erfordert Ihre Aufmerksamkeit." },
    family_incident_created: { title: "Sicherheitsvorfall eröffnet", body: "Ein Sicherheitsvorfall, den Sie sehen dürfen, wurde eröffnet." },
    family_incident_escalated: { title: "Sicherheitsvorfall eskaliert", body: "Ein Sicherheitsvorfall, den Sie sehen dürfen, wurde eskaliert." },
    family_delivery_available: { title: "Eine Zustellung ist für Sie verfügbar", body: "Eine Guardian-Zustellung steht für Sie zur Prüfung bereit." },
    family_delivery_acknowledged: { title: "Zustellung bestätigt", body: "Eine Guardian-Zustellung wurde vom Empfänger bestätigt." },
    family_delivery_declined: { title: "Zustellung abgelehnt", body: "Eine Guardian-Zustellung wurde vom Empfänger abgelehnt." },
    family_guardian_invitation_accepted: { title: "Guardian-Einladung angenommen", body: "Eine von Ihnen gesendete Guardian-Einladung wurde angenommen." },
    family_guardian_invitation_expiring: { title: "Guardian-Einladung läuft bald ab", body: "Eine von Ihnen gesendete Guardian-Einladung läuft bald ab." },
    family_authority_changed: { title: "Guardian-Berechtigung geändert", body: "Eine für Sie relevante Guardian-Berechtigung hat sich geändert." },
    family_consent_expiring: { title: "Einwilligung läuft bald ab", body: "Eine für Ihren Familienbereich relevante Einwilligung läuft bald ab." },
    family_recipient_authorization_changed: { title: "Empfänger-Berechtigung geändert", body: "Eine für Sie relevante Empfänger-Berechtigung hat sich geändert." },
    family_protection_plan_updated: { title: "Schutzplan aktualisiert", body: "Ein Schutzplan, den Sie sehen können, wurde aktualisiert." },
  },
};

export const FAMILY_NOTIF_DICT: Record<Locale, FamilyNotifDict> = { en, sk, de };
export function familyNotifDict(locale: Locale): FamilyNotifDict { return FAMILY_NOTIF_DICT[locale] ?? en; }

/** Every catalogue type MUST have a title/body in every locale — asserted by the parity test. */
export function familyNotifTypeCoverage(): { locale: Locale; missing: FamilyNotificationType[] }[] {
  return (Object.keys(FAMILY_NOTIF_DICT) as Locale[]).map((locale) => ({
    locale,
    missing: FAMILY_NOTIFICATION_TYPES.filter((t) => {
      const e = FAMILY_NOTIF_DICT[locale].types[t];
      return !e || !e.title || !e.body;
    }),
  }));
}
