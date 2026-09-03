/**
 * German strings for native connector OAuth. Same discipline as {@link enOauth}:
 * an authorization is not a connection.
 */
export const deOauth = {
  oauth: {
    connectTitle: "Konto verbinden",
    connectSubtitle: "Wählen Sie, wo Tamanor auf Kommentare und Bewertungen achten soll.",
    provider: { meta: "Facebook & Instagram", google_business: "Google-Unternehmensprofil" },
    providerHint: {
      meta: "Facebook-Seiten und verknüpfte Instagram-Business-Konten.",
      google_business: "Bewertungen Ihrer Google-Unternehmensstandorte.",
    },
    unavailable: "In dieser Tamanor-Installation noch nicht verfügbar.",
    notApproved: "Wartet auf die API-Freigabe durch Google.",
    chooseBrand: "Verbinden mit",
    noBrands: "Es sind noch keine Marken eingerichtet.",

    opening: "Browser wird geöffnet…",
    inBrowser: "Schließen Sie die Anmeldung beim Anbieter in Ihrem Browser ab.",
    checking: "Wird mit Tamanor abgeglichen…",

    selectTitle: "Wählen Sie, was verbunden wird",
    selectSubtitleMeta: "Tamanor hat diese Seiten und Instagram-Konten gefunden.",
    selectSubtitleGoogle: "Tamanor hat diese Standorte gefunden.",
    selectNone: "Wählen Sie mindestens einen Eintrag aus.",
    alreadyConnected: "Bereits verbunden",
    ineligible: "Kann nicht verbunden werden",
    ineligibleReason: { unverified: "Bei Google nicht verifiziert" },
    submit: "Ausgewählte verbinden",
    submitting: "Wird verbunden…",

    doneTitle: "Verbunden",
    doneBody: (n: number) => `${n} Konto${n === 1 ? "" : "s"} verbunden.`,
    donePartial: (limited: number) =>
      `${limited} konnte nicht überwacht werden — Ihr Tariflimit ist erreicht. Sie bleiben verbunden, aber unüberwacht.`,
    doneSlot: (n: number) => `${n} konnte nicht verbunden werden: Diese Marke hat auf dieser Plattform bereits ein Konto.`,

    failedTitle: "Nicht verbunden",
    reason: {
      user_cancelled: "Sie haben vor dem Abschluss abgebrochen.",
      invalid_state: "Dieser Anmeldelink war nicht mehr gültig. Bitte erneut versuchen.",
      expired: "Der Verbindungsversuch ist abgelaufen. Bitte erneut versuchen.",
      permission_denied: "Sie haben keine Berechtigung, Konten zu verbinden.",
      account_limit_reached: "Das Limit Ihres Tarifs für überwachte Konten ist erreicht.",
      brand_platform_limit_reached: "Diese Marke hat auf dieser Plattform bereits ein Konto.",
      provider_unavailable: "Die Plattform war nicht erreichbar. Bitte gleich erneut versuchen.",
      token_exchange_failed: "Die Plattform hat die Anmeldung nicht abgeschlossen. Bitte erneut versuchen.",
      missing_permission: "Eine von Tamanor benötigte Berechtigung wurde nicht erteilt.",
      no_accounts: "Es wurden keine geeigneten Konten gefunden.",
      selection_required: "Wählen Sie zum Abschluss aus, was verbunden werden soll.",
      save_failed: "Die Verbindung konnte nicht gespeichert werden. Bitte erneut versuchen.",
      not_found: "Dieser Verbindungsversuch ist nicht mehr verfügbar.",
      session_invalid: "Sie wurden vor dem Abschluss abgemeldet. Melden Sie sich an und versuchen Sie es erneut.",
      unknown: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
    },
    tryAgain: "Erneut versuchen",
    close: "Schließen",
    cancel: "Abbrechen",
    browserNotice:
      "Tamanor öffnet den Browser nur zur Anmeldung beim Anbieter. In Tamanor bleiben Sie auf diesem Gerät angemeldet.",
  },
};
