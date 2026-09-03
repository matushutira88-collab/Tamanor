/**
 * Slovak strings for native connector OAuth. Same discipline as {@link enOauth}:
 * an authorization is not a connection.
 */
export const skOauth = {
  oauth: {
    connectTitle: "Pripojiť účet",
    connectSubtitle: "Vyberte, kde má Tamanor sledovať komentáre a recenzie.",
    provider: { meta: "Facebook a Instagram", google_business: "Profil Google Business" },
    providerHint: {
      meta: "Stránky na Facebooku a prepojené firemné účty Instagram.",
      google_business: "Recenzie na vašich prevádzkach Google Business.",
    },
    unavailable: "V tejto inštalácii Tamanoru zatiaľ nie je dostupné.",
    notApproved: "Čaká sa na schválenie prístupu k API od Googlu.",
    chooseBrand: "Pripojiť k",
    noBrands: "Zatiaľ nie sú nastavené žiadne značky.",

    opening: "Otvára sa prehliadač…",
    inBrowser: "Dokončite prihlásenie u poskytovateľa vo svojom prehliadači.",
    checking: "Overuje sa v Tamanore…",

    selectTitle: "Vyberte, čo pripojiť",
    selectSubtitleMeta: "Tamanor našiel tieto stránky a účty Instagram.",
    selectSubtitleGoogle: "Tamanor našiel tieto prevádzky.",
    selectNone: "Pokračujte výberom aspoň jednej položky.",
    alreadyConnected: "Už pripojené",
    ineligible: "Nedá sa pripojiť",
    ineligibleReason: { unverified: "Neoverené v Google" },
    submit: "Pripojiť vybrané",
    submitting: "Pripája sa…",

    doneTitle: "Pripojené",
    doneBody: (n: number) =>
      n === 1 ? "Pripojený 1 účet." : n >= 2 && n <= 4 ? `Pripojené ${n} účty.` : `Pripojených ${n} účtov.`,
    donePartial: (limited: number) =>
      `${limited} sa nedá sledovať — dosiahli ste limit plánu. Ostávajú pripojené, ale nesledované.`,
    doneSlot: (n: number) => `${n} sa nedalo pripojiť: táto značka už má účet na tejto platforme.`,

    failedTitle: "Nepripojené",
    reason: {
      user_cancelled: "Zrušili ste to pred dokončením.",
      invalid_state: "Tento prihlasovací odkaz už neplatil. Skúste to znova.",
      expired: "Pokus o pripojenie vypršal. Skúste to znova.",
      permission_denied: "Nemáte oprávnenie pripájať účty.",
      account_limit_reached: "Dosiahli ste limit sledovaných účtov vo vašom pláne.",
      brand_platform_limit_reached: "Táto značka už má účet na tejto platforme.",
      provider_unavailable: "Platforma bola nedostupná. Skúste to o chvíľu.",
      token_exchange_failed: "Platforma prihlásenie nedokončila. Skúste to znova.",
      missing_permission: "Nebolo udelené oprávnenie, ktoré Tamanor potrebuje.",
      no_accounts: "Nenašli sa žiadne vhodné účty na pripojenie.",
      selection_required: "Dokončite to výberom toho, čo chcete pripojiť.",
      save_failed: "Pripojenie sa nepodarilo uložiť. Skúste to znova.",
      not_found: "Tento pokus o pripojenie už nie je dostupný.",
      session_invalid: "Pred dokončením ste boli odhlásení. Prihláste sa a skúste to znova.",
      unknown: "Niečo sa pokazilo. Skúste to znova.",
    },
    tryAgain: "Skúsiť znova",
    close: "Zavrieť",
    cancel: "Zrušiť",
    browserNotice:
      "Tamanor otvára prehliadač len na prihlásenie u poskytovateľa. V Tamanore ostávate na tomto zariadení prihlásení.",
  },
};
