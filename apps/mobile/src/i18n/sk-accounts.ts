/**
 * Slovak strings for Accounts.
 *
 * Same discipline as {@link enAccounts}: connection health, monitoring, auto-sync and
 * capability are four separate labelled facts, and disconnect copy never claims more
 * than Tamanor actually does.
 */
export const skAccounts = {
  accounts: {
    title: "Účty",
    subtitle: "Účty, ku ktorým je Tamanor pripojený.",
    connectedCount: (n: number) =>
      n === 1 ? "1 pripojený účet" : n >= 2 && n <= 4 ? `${n} pripojené účty` : `${n} pripojených účtov`,
    monitoringUsage: (used: number, limit: number) =>
      limit < 0 ? `${used} sledovaných` : `${used} z ${limit} sledovaných`,
    needsAttention: (n: number) =>
      n === 1 ? "1 vyžaduje pozornosť" : n >= 2 && n <= 4 ? `${n} vyžadujú pozornosť` : `${n} vyžaduje pozornosť`,
    allHealthy: "Všetky pripojenia sú v poriadku.",
    viewDetails: "Zobraziť detaily",
    refresh: "Obnoviť",

    filters: {
      all: "Všetky",
      attention: "Vyžadujú pozornosť",
      monitored: "Sledovanie zapnuté",
      unmonitored: "Sledovanie vypnuté",
    },

    sections: {
      identity: "Účet",
      connection: "Pripojenie",
      monitoring: "Sledovanie",
      sync: "Synchronizácia",
      permissions: "Čo môže Tamanor robiť",
      activity: "Nedávne synchronizácie",
      danger: "Správa pripojenia",
    },

    connectionLabel: "Pripojenie",
    connection: {
      CONNECTED_HEALTHY: "Pripojené",
      WAITING_FIRST_SYNC: "Čaká na prvú synchronizáciu",
      DEGRADED: "Pripojenie je zhoršené",
      SYNC_FAILED: "Posledná synchronizácia zlyhala",
      REAUTH_REQUIRED: "Vyžaduje sa opätovné pripojenie",
      DISCONNECTED: "Odpojené",
    },

    monitoringLabel: "Sledovanie",
    monitoringOn: "Zapnuté",
    monitoringOff: "Vypnuté",
    monitoringMeaning:
      "Sledovanie znamená, že Tamanor tento účet sleduje. Je to nezávislé od toho, či je účet pripojený, či beží automatická synchronizácia a či Tamanor smie konať na platforme.",
    monitoringLimitReached:
      "Dosiahli ste limit sledovaných účtov vo vašom pláne. Vypnite sledovanie inde alebo prejdite na vyšší plán.",

    autoSyncLabel: "Automatická synchronizácia",
    autoSync: {
      ENABLED_HEALTHY: "Beží",
      ENABLED_DEGRADED: "Beží, ale s problémami",
      ENABLED_REAUTH_REQUIRED: "Zastavená — vyžaduje sa opätovné pripojenie",
      DISABLED: "Vypnutá",
      NOT_CONFIGURED: "Nie je nastavená",
    },

    firstSyncLabel: "Prvá synchronizácia",
    firstSync: {
      waiting_first_sync: "Čaká na prvú synchronizáciu",
      syncing: "Práve prebieha",
      synced: "Dokončená",
      failed: "Prvá synchronizácia zlyhala",
    },

    lastSuccessfulSync: "Posledná úspešná synchronizácia",
    lastAttempt: "Posledný pokus",
    neverSynced: "Nikdy nesynchronizované",
    commentsToday: "Komentáre dnes",
    riskToday: "Rizikové dnes",

    accountKind: {
      real: "Živé pripojenie",
      read_only: "Pripojenie iba na čítanie",
      test: "Demo pripojenie",
    },

    capability: {
      canRead: "Čítanie komentárov",
      canSync: "Manuálna synchronizácia",
      canMonitor: "Sledovanie",
      canReconnect: "Opätovné pripojenie",
      canDisconnect: "Odpojenie",
      moderationState: "Skrývanie komentárov",
      replyState: "Odpovedanie",
    },
    capabilityState: {
      available: "K dispozícii",
      unavailable: "Momentálne nedostupné",
      not_implemented: "Nie je implementované",
      not_configured: "Nie je nastavené",
      missing_permission: "Nemáte oprávnenie",
      requires_web: "Na tamanor.com",
      blocked_by_safety: "Zadržané bezpečnostnými pravidlami",
    },

    tokenHealthLabel: "Prístup",
    tokenHealth: {
      unknown: "Zatiaľ neoverené",
      ok: "Funguje",
      expiring_soon: "Čoskoro vyprší",
      expired: "Vypršal",
      invalid: "Už neplatí",
      revoked: "Bol odvolaný",
    },
    tokenExpires: "Prístup vyprší",
    lastProviderCheck: "Naposledy overené na platforme",
    protectionPaused: "Ochranné akcie sú pozastavené.",

    reason: {
      token_expired: "Prístup k účtu vypršal",
      permission_missing: "Chýba potrebné oprávnenie",
      provider_unavailable: "Platforma bola nedostupná",
      rate_limited: "Platforma obmedzuje počet požiadaviek Tamanoru",
      sync_failed: "Posledná synchronizácia zlyhala",
      reconnect_required: "Účet je potrebné znova pripojiť",
      no_token: "Tamanor nemá platný prístup k tomuto účtu",
      disconnected: "Účet je odpojený",
      credential_persist_failed: "Pripojenie sa nepodarilo uložiť",
      instagram_disconnected: "Prepojený účet Instagram bol odpojený",
      account_not_discoverable: "Účet sa na platforme nepodarilo nájsť",
      unknown: "Platforma nahlásila problém",
    },

    syncRun: {
      status: {
        running: "Prebieha",
        completed: "Dokončená",
        failed: "Zlyhala",
        partial_success: "Čiastočne dokončená",
        skipped_locked: "Preskočená — už prebieha",
        disconnected: "Preskočená — odpojené",
        permission_missing: "Zlyhala — chýba oprávnenie",
        rate_limited: "Zlyhala — obmedzenie počtu požiadaviek",
        api_unavailable: "Zlyhala — platforma nedostupná",
        interrupted: "Prerušená",
      },
      fetched: (n: number) => `${n} načítaných`,
      created: (n: number) => `${n} nových`,
      demo: "Demo údaje",
      none: "Zatiaľ žiadne synchronizácie.",
    },

    actions: {
      syncNow: "Synchronizovať",
      syncing: "Spúšťa sa…",
      connect: "Pripojiť účet",
      reconnect: "Znova pripojiť",
      manageOnWeb: "Spravovať na tamanor.com",
      disconnect: "Odpojiť",
      disconnecting: "Odpája sa…",
      cancel: "Zrušiť",
      confirm: "Potvrdiť",
    },

    syncResult: {
      started: "Synchronizácia sa spustila. Výsledky sa čoskoro zobrazia — potiahnite nadol pre obnovenie.",
      already_running: "Pre tento účet už synchronizácia prebieha.",
      reconnect_required: "Pred synchronizáciou účet znova pripojte.",
      not_supported: "Manuálna synchronizácia zatiaľ nie je pre túto platformu dostupná.",
      not_found: "Tento účet už nie je dostupný.",
    },

    disconnectConfirm: {
      title: "Odpojiť tento účet?",
      body:
        "Tamanor prestane používať toto pripojenie. Uložený prístup sa odstráni a sledovanie aj synchronizácia sa preň zastavia.",
      publicNotice:
        "Nič zverejnené na Facebooku, Instagrame ani Google sa tým nezmaže ani nezmení — iba pripojenie Tamanoru k účtu.",
      clusterNotice: (n: number) =>
        `Toto pripojenie zdieľa prístup s ${n} pripojenými účtami. Odpojením sa uložený prístup odstráni pre všetky.`,
    },
    disconnectResult: {
      done: "Odpojené.",
      manualCleanup:
        "Platforma neumožňuje Tamanoru odvolať vlastný prístup. Ak chcete odstránenie dokončiť, otvorte nastavenia firmy alebo aplikácií na platforme a odstráňte Tamanor tam.",
      clusterAffected: (n: number) => `Ovplyvnených bolo ${n} pripojených účtov.`,
    },

    webHandoff: {
      connectTitle: "Pripojiť na tamanor.com",
      connectBody:
        "Pripojenie účtu prebieha na tamanor.com vo vašom prehliadači. Možno sa tam budete musieť znova prihlásiť.",
      reconnectTitle: "Znova pripojiť na tamanor.com",
      reconnectBody:
        "Opätovné pripojenie prebieha na tamanor.com vo vašom prehliadači. Možno sa tam budete musieť znova prihlásiť.",
      open: "Otvoriť v prehliadači",
      unavailable: "Prehliadač sa nepodarilo otvoriť. Pripojenie spravujte na tamanor.com.",
      notConfigured: "Tamanor nie je na tomto zariadení nastavený na otváranie webovej aplikácie.",
    },

    empty: {
      title: "Žiadne pripojené účty",
      body:
        "Pripojte stránku na Facebooku, firemný účet na Instagrame alebo profil Google Business a Tamanor začne sledovať, čo o vás ľudia píšu.",
      viewerBody: "Zatiaľ nie sú pripojené žiadne účty. Požiadajte správcu, aby nejaký pripojil.",
      filterTitle: "Nič nezodpovedá",
      filterBody: "Tomuto filtru nezodpovedajú žiadne účty.",
      clearFilter: "Zobraziť všetky",
    },

    notFoundTitle: "Účet nie je dostupný",
    notFoundBody: "Tento účet už neexistuje alebo k nemu nemáte prístup.",
    noPermission: "Nemáte oprávnenie spravovať pripojenia.",
    readOnlyNotice: "Váš prístup je iba na čítanie, takže pripojenia sa nedajú meniť.",
  },
};
