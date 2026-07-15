import type { Locale } from "@/i18n";

/**
 * V1.50B — shared OAuth failure copy for /login and /register error banners. Always
 * truthful: a provider that isn't configured or a failed exchange degrades to a clear
 * message (and email sign-in), never a fake success.
 */
export const OAUTH_ERRORS: Record<Locale, Record<string, string>> = {
  en: {
    oauth_unavailable: "That sign-in option isn't available right now. Please continue with email.",
    oauth_denied: "Sign-in was cancelled.",
    oauth_state: "Your sign-in session expired. Please try again.",
    oauth_exchange: "We couldn't complete sign-in with that provider. Please try again.",
    oauth_email: "We couldn't get a verified email from that provider. Please use email instead.",
    oauth_failed: "Sign-in failed. Please try again.",
    oauth_session: "We couldn't start your session. Please try again.",
    rate_limited: "Too many attempts. Please try again in a few minutes.",
  },
  sk: {
    oauth_unavailable: "Táto možnosť prihlásenia teraz nie je dostupná. Pokračujte e-mailom.",
    oauth_denied: "Prihlásenie bolo zrušené.",
    oauth_state: "Vaša relácia prihlásenia vypršala. Skúste znova.",
    oauth_exchange: "Prihlásenie cez tohto poskytovateľa sa nepodarilo dokončiť. Skúste znova.",
    oauth_email: "Od poskytovateľa sa nepodarilo získať overený e-mail. Použite e-mail.",
    oauth_failed: "Prihlásenie zlyhalo. Skúste znova.",
    oauth_session: "Nepodarilo sa spustiť reláciu. Skúste znova.",
    rate_limited: "Priveľa pokusov. Skúste to o niekoľko minút.",
  },
  de: {
    oauth_unavailable: "Diese Anmeldeoption ist derzeit nicht verfügbar. Bitte fahren Sie mit E-Mail fort.",
    oauth_denied: "Die Anmeldung wurde abgebrochen.",
    oauth_state: "Ihre Anmeldesitzung ist abgelaufen. Bitte versuchen Sie es erneut.",
    oauth_exchange: "Die Anmeldung über diesen Anbieter konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    oauth_email: "Wir konnten keine verifizierte E-Mail vom Anbieter erhalten. Bitte nutzen Sie E-Mail.",
    oauth_failed: "Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.",
    oauth_session: "Die Sitzung konnte nicht gestartet werden. Bitte erneut versuchen.",
    rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
  },
};
