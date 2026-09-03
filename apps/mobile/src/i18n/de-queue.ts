/**
 * German strings for the Action Queue.
 *
 * Same discipline as {@link enQueue}: a Tamanor DECISION and a PLATFORM ACTION are
 * described separately. Approve copy must never promise that a public comment will
 * be hidden.
 */
export const deQueue = {
  queue: {
    title: "Hinweise",
    subtitle: "Aktionen, die Tamanor für Ihre Konten vorschlägt.",
    activeCount: (n: number) => `${n} ${n === 1 ? "erfordert" : "erfordern"} Aufmerksamkeit`,
    needsDecision: "Wartet auf Ihre Entscheidung",
    proposes: "Tamanor schlägt vor",
    loadMore: "Mehr laden",
    loadMoreFailed: "Weitere konnten nicht geladen werden.",
    endOfList: "Das ist alles.",
    openComment: "Kommentar öffnen",
    openReview: "Bewertung öffnen",
    relatedUnavailable: "Der ursprüngliche Eintrag ist nicht mehr verfügbar.",

    tabs: {
      active: "Aktiv",
      approval: "Freigabe",
      blocked: "Blockiert",
      resolved: "Erledigt",
      all: "Verlauf",
    },

    sections: {
      content: "Inhalt",
      proposal: "Vorschlag",
      risk: "Risiko & Grund",
      policy: "Richtlinie & Sicherheit",
      execution: "Aktion auf der Plattform",
      decision: "Tamanor-Entscheidung",
      readiness: "Bereitschaft",
      activity: "Aktivität",
    },

    proposedAction: {
      notify: "Team benachrichtigen",
      create_inbox_item: "Zum Posteingang hinzufügen",
      suggest_reply: "Antwort vorschlagen",
      request_approval: "Freigabe anfordern",
      hide_comment: "Kommentar ausblenden",
      report: "Der Plattform melden",
      escalate: "Eskalieren",
      assign_to_user: "Einer Person zuweisen",
      create_incident: "Vorfall eröffnen",
      no_action: "Keine Aktion",
    },

    state: {
      suggested: "Vorgeschlagen",
      approval_required: "Wartet auf Freigabe",
      approved: "Freigegeben",
      rejected: "Abgelehnt",
      blocked_by_safety: "Von Sicherheitsregeln zurückgehalten",
      dry_run: "Testlauf",
      executed: "Ausgeführt",
      failed: "Fehlgeschlagen",
      rollback_needed: "Rücknahme erforderlich",
      monitor: "Beobachtung",
      no_action: "Erledigt",
    },

    execution: {
      none: "Auf der Plattform wurde nichts ausgeführt.",
      blocked: "Vor der Ausführung blockiert",
      dry_run: "Nur Testlauf — öffentlich wurde nichts verändert",
      executed: "Auf der Plattform ausgeführt",
      failed: "Auf der Plattform fehlgeschlagen",
      rollback_pending: "Rücknahme ausstehend",
      rolled_back: "Zurückgenommen",
      byApproval: "nach Freigabe",
      byAutonomous: "durch eine automatische Richtlinie",
    },

    readiness: {
      blocked: "Nicht ausführbereit",
      dry_run: "Als Testlauf vorbereitet",
      live_possible: "Ausführbereit",
      already_executed: "Bereits ausgeführt",
      not_applicable: "Keine Plattformaktion nötig",
      note: "Dies ist nur ein Status. Aktionen auf der Plattform werden über tamanor.com ausgeführt.",
    },

    lifecycle: {
      visible: "Weiterhin öffentlich sichtbar",
      hidden: "Auf der Plattform ausgeblendet",
      deleted: "Nicht mehr auf der Plattform",
      cannot_hide: "Die Plattform lässt das Ausblenden nicht zu",
      unknown: "Öffentlicher Status unbekannt",
    },

    reason: {
      global_disabled: "Plattformaktionen sind ausgeschaltet",
      facebook_hide_disabled: "Ausblenden ist für Facebook ausgeschaltet",
      unsupported_platform: "Diese Plattform unterstützt die Aktion nicht",
      account_is_demo: "Dies ist ein Demo-Konto",
      account_not_active: "Das Konto ist nicht aktiv",
      reconnect_required: "Das Konto muss neu verbunden werden",
      token_not_healthy: "Die Berechtigungen des Kontos brauchen Aufmerksamkeit",
      token_expired: "Der Zugriff auf das Konto ist abgelaufen",
      unhealthy_account: "Das Konto ist nicht in Ordnung",
      missing_permission: "Eine erforderliche Berechtigung fehlt",
      safety_never_autonomous: "Sicherheitsregeln automatisieren diese Kategorie nie",
      category_not_eligible: "Diese Kategorie ist für die Aktion nicht zugelassen",
      policy_not_autonomous: "Die Richtlinie steht nicht auf automatisch",
      low_confidence: "Die Sicherheit war zu gering",
      threat_requires_critical: "Drohungen zählen nur bei hohem oder kritischem Risiko",
      missing_comment_id: "Der ursprüngliche Kommentar war nicht identifizierbar",
      dry_run_mode: "Testlauf-Modus",
      dry_run_still_enabled: "Der Testlauf-Modus ist noch aktiv",
      live_not_enabled: "Live-Aktionen sind nicht aktiviert",
      live_confirm_required: "Live-Aktionen erfordern eine ausdrückliche Bestätigung",
      already_executed: "Diese Aktion wurde bereits ausgeführt",
      comment_deleted_or_unavailable: "Der Kommentar existiert nicht mehr",
      provider_error: "Die Plattform hat einen Fehler gemeldet",
      unavailable: "Grund nicht verfügbar",
    },

    /** Canonical audit events, as an operator would describe them. */
    activityEvent: {
      "approval.approved": "In Tamanor freigegeben",
      "approval.rejected": "In Tamanor abgelehnt",
      "approval.resolved": "Als erledigt markiert",
      "approval.retried": "Erneut versucht",
      "platform_action.live_requested": "Live-Aktion angefordert",
      "platform_action.executed": "Auf der Plattform ausgeführt",
      "platform_action.blocked": "Vor der Ausführung blockiert",
      "feedback.created": "Rückmeldung erfasst",
      "incident.created": "Vorfall eröffnet",
    },

    policy: {
      mode: "Richtlinienmodus",
      modeValue: { monitor: "Beobachten", assist: "Unterstützen", approval: "Freigabe", autonomous: "Automatisch" },
      neverAutonomous: "Diese Kategorie wird nie automatisch bearbeitet.",
      autonomousEligible: "Diese Kategorie kann bei automatischer Richtlinie selbsttätig bearbeitet werden.",
      notEligible: "Diese Kategorie ist für die automatische Bearbeitung nicht zugelassen.",
    },

    actions: {
      approve: "Freigeben",
      reject: "Ablehnen",
      resolve: "Als erledigt markieren",
      approving: "Wird freigegeben…",
      rejecting: "Wird abgelehnt…",
      resolving: "Wird gespeichert…",
      cancel: "Abbrechen",
      confirm: "Bestätigen",
    },

    confirm: {
      approveTitle: "Diesen Vorschlag freigeben?",
      approveBody:
        "Damit wird Ihre Freigabe in Tamanor festgehalten. Auf der Plattform wird dadurch nichts ausgeblendet oder gelöscht — eine Plattformaktion läuft weiterhin über die bestehenden Sicherheits- und Ausführungskontrollen von Tamanor.",
      rejectTitle: "Diesen Vorschlag ablehnen?",
      rejectBody:
        "Damit wird Ihre Ablehnung in Tamanor festgehalten. Aus dieser Entscheidung wird keine Plattformaktion ausgeführt.",
      resolveTitle: "Als erledigt markieren?",
      resolveBody:
        "Damit wird der Eintrag in Ihrer Tamanor-Warteschlange geschlossen. Der öffentliche Kommentar wird dadurch nicht geändert oder entfernt.",
    },

    result: {
      approved: "Freigegeben.",
      rejected: "Abgelehnt.",
      resolved: "Als erledigt markiert.",
      conflict: "Jemand anderes hat diesen Eintrag bereits entschieden. Der aktuelle Stand wird angezeigt.",
      permissionDenied: "Sie haben keine Berechtigung, darüber zu entscheiden.",
      readOnly: "Ihr Zugriff ist schreibgeschützt, daher lässt sich das nicht ändern.",
      failed: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.",
      notFound: "Dieser Hinweis ist nicht mehr verfügbar.",
    },

    empty: {
      activeTitle: "Keine aktiven Hinweise",
      activeBody: "Im Moment erfordert nichts Ihre Aufmerksamkeit.",
      approvalTitle: "Nichts wartet auf Freigabe",
      approvalBody: "Vorschläge, die eine Entscheidung brauchen, erscheinen hier.",
      blockedTitle: "Keine blockierten Aktionen",
      blockedBody: "Von Sicherheitsregeln zurückgehaltene Aktionen erscheinen hier.",
      resolvedTitle: "Noch nichts erledigt",
      resolvedBody: "Entschiedene und abgeschlossene Einträge erscheinen hier.",
      allTitle: "Noch kein Aktionsverlauf",
      allBody: "Alles, was Tamanor vorschlägt, wird hier aufgeführt.",
    },

    notFoundTitle: "Hinweis nicht verfügbar",
    notFoundBody: "Dieser Hinweis existiert nicht mehr oder Sie haben keinen Zugriff darauf.",
    noPermission: "Sie haben keine Berechtigung, über Hinweise zu entscheiden.",
  },
};
