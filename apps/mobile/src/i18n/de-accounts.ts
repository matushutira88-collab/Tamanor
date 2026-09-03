/**
 * German strings for Accounts.
 *
 * Same discipline as {@link enAccounts}: connection health, monitoring, auto-sync and
 * capability are four separate labelled facts, and disconnect copy never claims more
 * than Tamanor actually does.
 */
export const deAccounts = {
  accounts: {
    title: "Konten",
    subtitle: "Die Konten, mit denen Tamanor verbunden ist.",
    connectedCount: (n: number) => `${n} verbundene${n === 1 ? "s" : ""} Konto${n === 1 ? "" : "s"}`,
    monitoringUsage: (used: number, limit: number) =>
      limit < 0 ? `${used} überwacht` : `${used} von ${limit} überwacht`,
    needsAttention: (n: number) => `${n} ${n === 1 ? "erfordert" : "erfordern"} Aufmerksamkeit`,
    allHealthy: "Alle Verbindungen sind in Ordnung.",
    viewDetails: "Details ansehen",
    refresh: "Aktualisieren",

    filters: {
      all: "Alle",
      attention: "Erfordern Aufmerksamkeit",
      monitored: "Überwachung an",
      unmonitored: "Überwachung aus",
    },

    sections: {
      identity: "Konto",
      connection: "Verbindung",
      monitoring: "Überwachung",
      sync: "Synchronisierung",
      permissions: "Was Tamanor tun kann",
      activity: "Letzte Synchronisierungen",
      danger: "Verbindungsverwaltung",
    },

    connectionLabel: "Verbindung",
    connection: {
      CONNECTED_HEALTHY: "Verbunden",
      WAITING_FIRST_SYNC: "Wartet auf die erste Synchronisierung",
      DEGRADED: "Verbindung beeinträchtigt",
      SYNC_FAILED: "Letzte Synchronisierung fehlgeschlagen",
      REAUTH_REQUIRED: "Neu verbinden erforderlich",
      DISCONNECTED: "Getrennt",
    },

    monitoringLabel: "Überwachung",
    monitoringOn: "An",
    monitoringOff: "Aus",
    monitoringMeaning:
      "Überwachung bedeutet, dass Tamanor dieses Konto beobachtet. Das ist unabhängig davon, ob das Konto verbunden ist, ob die automatische Synchronisierung läuft und ob Tamanor auf der Plattform handeln darf.",
    monitoringLimitReached:
      "Das Limit Ihres Tarifs für überwachte Konten ist erreicht. Schalten Sie die Überwachung woanders aus oder wechseln Sie den Tarif.",

    autoSyncLabel: "Automatische Synchronisierung",
    autoSync: {
      ENABLED_HEALTHY: "Läuft",
      ENABLED_DEGRADED: "Läuft, mit Problemen",
      ENABLED_REAUTH_REQUIRED: "Gestoppt — neu verbinden erforderlich",
      DISABLED: "Aus",
      NOT_CONFIGURED: "Nicht eingerichtet",
    },

    firstSyncLabel: "Erste Synchronisierung",
    firstSync: {
      waiting_first_sync: "Wartet auf die erste Synchronisierung",
      syncing: "Läuft gerade",
      synced: "Abgeschlossen",
      failed: "Die erste Synchronisierung ist fehlgeschlagen",
    },

    lastSuccessfulSync: "Letzte erfolgreiche Synchronisierung",
    lastAttempt: "Letzter Versuch",
    neverSynced: "Noch nie synchronisiert",
    commentsToday: "Kommentare heute",
    riskToday: "Riskant heute",

    accountKind: {
      real: "Live-Verbindung",
      read_only: "Nur-Lese-Verbindung",
      test: "Demo-Verbindung",
    },

    capability: {
      canRead: "Kommentare lesen",
      canSync: "Manuelle Synchronisierung",
      canMonitor: "Überwachung",
      canReconnect: "Neu verbinden",
      canDisconnect: "Trennen",
      moderationState: "Kommentare ausblenden",
      replyState: "Antworten",
    },
    capabilityState: {
      available: "Verfügbar",
      unavailable: "Derzeit nicht verfügbar",
      not_implemented: "Nicht umgesetzt",
      not_configured: "Nicht eingerichtet",
      missing_permission: "Sie haben keine Berechtigung",
      requires_web: "Auf tamanor.com",
      blocked_by_safety: "Von Sicherheitsregeln zurückgehalten",
    },

    tokenHealthLabel: "Zugriff",
    tokenHealth: {
      unknown: "Noch nicht geprüft",
      ok: "Funktioniert",
      expiring_soon: "Läuft bald ab",
      expired: "Abgelaufen",
      invalid: "Nicht mehr gültig",
      revoked: "Zurückgezogen",
    },
    tokenExpires: "Zugriff läuft ab",
    lastProviderCheck: "Zuletzt bei der Plattform geprüft",
    protectionPaused: "Schutzaktionen sind pausiert.",

    reason: {
      token_expired: "Der Zugriff auf das Konto ist abgelaufen",
      permission_missing: "Eine erforderliche Berechtigung fehlt",
      provider_unavailable: "Die Plattform war nicht erreichbar",
      rate_limited: "Die Plattform drosselt Tamanor",
      sync_failed: "Die letzte Synchronisierung ist fehlgeschlagen",
      reconnect_required: "Das Konto muss neu verbunden werden",
      no_token: "Tamanor hat keinen gültigen Zugriff auf dieses Konto",
      disconnected: "Das Konto ist getrennt",
      credential_persist_failed: "Die Verbindung konnte nicht gespeichert werden",
      instagram_disconnected: "Das verknüpfte Instagram-Konto wurde getrennt",
      account_not_discoverable: "Das Konto wurde auf der Plattform nicht gefunden",
      unknown: "Die Plattform hat ein Problem gemeldet",
    },

    syncRun: {
      status: {
        running: "Läuft",
        completed: "Abgeschlossen",
        failed: "Fehlgeschlagen",
        partial_success: "Teilweise abgeschlossen",
        skipped_locked: "Übersprungen — läuft bereits",
        disconnected: "Übersprungen — getrennt",
        permission_missing: "Fehlgeschlagen — Berechtigung fehlt",
        rate_limited: "Fehlgeschlagen — gedrosselt",
        api_unavailable: "Fehlgeschlagen — Plattform nicht verfügbar",
        interrupted: "Unterbrochen",
      },
      fetched: (n: number) => `${n} abgerufen`,
      created: (n: number) => `${n} neu`,
      demo: "Demo-Daten",
      none: "Noch keine Synchronisierungen.",
    },

    actions: {
      syncNow: "Jetzt synchronisieren",
      syncing: "Wird gestartet…",
      connect: "Konto verbinden",
      reconnect: "Neu verbinden",
      manageOnWeb: "Auf tamanor.com verwalten",
      disconnect: "Trennen",
      disconnecting: "Wird getrennt…",
      cancel: "Abbrechen",
      confirm: "Bestätigen",
    },

    syncResult: {
      started: "Synchronisierung gestartet. Ergebnisse erscheinen in Kürze — zum Aktualisieren nach unten ziehen.",
      already_running: "Für dieses Konto läuft bereits eine Synchronisierung.",
      reconnect_required: "Verbinden Sie dieses Konto vor dem Synchronisieren neu.",
      not_supported: "Manuelle Synchronisierung ist für diese Plattform noch nicht verfügbar.",
      not_found: "Dieses Konto ist nicht mehr verfügbar.",
    },

    disconnectConfirm: {
      title: "Dieses Konto trennen?",
      body:
        "Tamanor verwendet diese Verbindung dann nicht mehr. Der gespeicherte Zugriff wird entfernt, Überwachung und Synchronisierung werden dafür beendet.",
      publicNotice:
        "Auf Facebook, Instagram oder Google veröffentlichte Inhalte werden dadurch weder gelöscht noch geändert — nur die Verbindung von Tamanor zum Konto.",
      clusterNotice: (n: number) =>
        `Diese Verbindung teilt ihren Zugriff mit ${n} verbundenen Konten. Beim Trennen wird der gespeicherte Zugriff für alle entfernt.`,
    },
    disconnectResult: {
      done: "Getrennt.",
      manualCleanup:
        "Die Plattform lässt Tamanor den eigenen Zugriff nicht zurückziehen. Öffnen Sie die Unternehmens- oder App-Einstellungen der Plattform und entfernen Sie Tamanor dort, um die Entfernung abzuschließen.",
      clusterAffected: (n: number) => `${n} verbundene Konten waren betroffen.`,
    },

    webHandoff: {
      connectTitle: "Auf tamanor.com verbinden",
      connectBody:
        "Das Verbinden eines Kontos erfolgt auf tamanor.com in Ihrem Browser. Möglicherweise müssen Sie sich dort erneut anmelden.",
      reconnectTitle: "Auf tamanor.com neu verbinden",
      reconnectBody:
        "Das Neuverbinden erfolgt auf tamanor.com in Ihrem Browser. Möglicherweise müssen Sie sich dort erneut anmelden.",
      open: "Im Browser öffnen",
      unavailable: "Der Browser konnte nicht geöffnet werden. Verwalten Sie die Verbindung auf tamanor.com.",
      notConfigured: "Tamanor ist auf diesem Gerät nicht zum Öffnen der Web-App eingerichtet.",
    },

    empty: {
      title: "Keine verbundenen Konten",
      body:
        "Verbinden Sie eine Facebook-Seite, ein Instagram-Business-Konto oder ein Google-Unternehmensprofil, und Tamanor beobachtet, was Menschen über Sie schreiben.",
      viewerBody: "Es sind noch keine Konten verbunden. Bitten Sie eine Administratorin oder einen Administrator darum.",
      filterTitle: "Nichts passt",
      filterBody: "Zu diesem Filter passen keine Konten.",
      clearFilter: "Alle anzeigen",
    },

    notFoundTitle: "Konto nicht verfügbar",
    notFoundBody: "Dieses Konto existiert nicht mehr oder Sie haben keinen Zugriff darauf.",
    noPermission: "Sie haben keine Berechtigung, Verbindungen zu verwalten.",
    readOnlyNotice: "Ihr Zugriff ist schreibgeschützt, daher lassen sich Verbindungen nicht ändern.",
  },
};
