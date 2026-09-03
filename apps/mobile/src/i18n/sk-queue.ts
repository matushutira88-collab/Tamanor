/**
 * Slovak strings for the Action Queue.
 *
 * Same discipline as {@link enQueue}: a Tamanor DECISION and a PLATFORM ACTION are
 * described separately. Approve copy must never promise that a public comment will
 * be hidden.
 */
export const skQueue = {
  queue: {
    title: "Upozornenia",
    subtitle: "Akcie, ktoré Tamanor navrhuje pre vaše účty.",
    activeCount: (n: number) =>
      n === 1 ? "1 vyžaduje pozornosť" : n >= 2 && n <= 4 ? `${n} vyžadujú pozornosť` : `${n} vyžaduje pozornosť`,
    needsDecision: "Čaká na vaše rozhodnutie",
    proposes: "Tamanor navrhuje",
    loadMore: "Načítať ďalšie",
    loadMoreFailed: "Ďalšie sa nepodarilo načítať.",
    endOfList: "To je všetko.",
    openComment: "Otvoriť komentár",
    openReview: "Otvoriť recenziu",
    relatedUnavailable: "Pôvodná položka už nie je dostupná.",

    tabs: {
      active: "Aktívne",
      approval: "Schválenie",
      blocked: "Zablokované",
      resolved: "Vyriešené",
      all: "História",
    },

    sections: {
      content: "Obsah",
      proposal: "Návrh",
      risk: "Riziko a dôvod",
      policy: "Pravidlá a bezpečnosť",
      execution: "Akcia na platforme",
      decision: "Rozhodnutie v Tamanore",
      readiness: "Pripravenosť",
      activity: "Aktivita",
    },

    proposedAction: {
      notify: "Upozorniť tím",
      create_inbox_item: "Pridať do schránky",
      suggest_reply: "Navrhnúť odpoveď",
      request_approval: "Vyžiadať schválenie",
      hide_comment: "Skryť komentár",
      report: "Nahlásiť platforme",
      escalate: "Eskalovať",
      assign_to_user: "Prideliť osobe",
      create_incident: "Otvoriť incident",
      no_action: "Žiadna akcia",
    },

    state: {
      suggested: "Navrhnuté",
      approval_required: "Čaká na schválenie",
      approved: "Schválené",
      rejected: "Zamietnuté",
      blocked_by_safety: "Zadržané bezpečnostnými pravidlami",
      dry_run: "Skúšobný beh",
      executed: "Vykonané",
      failed: "Zlyhalo",
      rollback_needed: "Vyžaduje vrátenie",
      monitor: "Sledovanie",
      no_action: "Vyriešené",
    },

    execution: {
      none: "Na platforme sa nič nevykonalo.",
      blocked: "Zablokované pred vykonaním",
      dry_run: "Iba skúšobný beh — verejne sa nič nezmenilo",
      executed: "Vykonané na platforme",
      failed: "Na platforme zlyhalo",
      rollback_pending: "Čaká sa na vrátenie",
      rolled_back: "Vrátené späť",
      byApproval: "po schválení",
      byAutonomous: "automatickým pravidlom",
    },

    readiness: {
      blocked: "Nie je pripravené na vykonanie",
      dry_run: "Pripravené ako skúšobný beh",
      live_possible: "Pripravené na vykonanie",
      already_executed: "Už vykonané",
      not_applicable: "Akcia na platforme nie je potrebná",
      note: "Toto je iba stav. Akcia na platforme sa spúšťa na tamanor.com.",
    },

    lifecycle: {
      visible: "Stále verejne viditeľné",
      hidden: "Skryté na platforme",
      deleted: "Už nie je na platforme",
      cannot_hide: "Platforma toto skryť neumožní",
      unknown: "Verejný stav neznámy",
    },

    reason: {
      global_disabled: "Akcie na platformách sú vypnuté",
      facebook_hide_disabled: "Skrývanie je pre Facebook vypnuté",
      unsupported_platform: "Táto platforma akciu nepodporuje",
      account_is_demo: "Toto je demo účet",
      account_not_active: "Účet nie je aktívny",
      reconnect_required: "Účet je potrebné znova pripojiť",
      token_not_healthy: "Oprávnenia účtu si vyžadujú pozornosť",
      token_expired: "Prístup k účtu vypršal",
      unhealthy_account: "Účet nie je v poriadku",
      missing_permission: "Chýba potrebné oprávnenie",
      safety_never_autonomous: "Bezpečnostné pravidlá túto kategóriu nikdy neautomatizujú",
      category_not_eligible: "Táto kategória nie je oprávnená na túto akciu",
      policy_not_autonomous: "Pravidlo nie je nastavené na automatické",
      low_confidence: "Istota bola príliš nízka",
      threat_requires_critical: "Hrozby sa kvalifikujú len pri vysokom alebo kritickom riziku",
      missing_comment_id: "Pôvodný komentár sa nepodarilo identifikovať",
      dry_run_mode: "Režim skúšobného behu",
      dry_run_still_enabled: "Režim skúšobného behu je stále zapnutý",
      live_not_enabled: "Živé akcie nie sú povolené",
      live_confirm_required: "Živé akcie vyžadujú výslovné potvrdenie",
      already_executed: "Táto akcia už prebehla",
      comment_deleted_or_unavailable: "Komentár už neexistuje",
      provider_error: "Platforma vrátila chybu",
      unavailable: "Dôvod nie je k dispozícii",
    },

    /** Canonical audit events, as an operator would describe them. */
    activityEvent: {
      "approval.approved": "Schválené v Tamanore",
      "approval.rejected": "Zamietnuté v Tamanore",
      "approval.resolved": "Označené ako vybavené",
      "approval.retried": "Zopakované",
      "platform_action.live_requested": "Vyžiadaná živá akcia",
      "platform_action.executed": "Vykonané na platforme",
      "platform_action.blocked": "Zablokované pred vykonaním",
      "feedback.created": "Zaznamenaná spätná väzba",
      "incident.created": "Otvorený incident",
    },

    policy: {
      mode: "Režim pravidiel",
      modeValue: { monitor: "Sledovanie", assist: "Asistencia", approval: "Schvaľovanie", autonomous: "Automatické" },
      neverAutonomous: "Táto kategória sa nikdy nerieši automaticky.",
      autonomousEligible: "Táto kategória sa môže riešiť automaticky pri automatickom pravidle.",
      notEligible: "Táto kategória nie je oprávnená na automatické riešenie.",
    },

    actions: {
      approve: "Schváliť",
      reject: "Zamietnuť",
      resolve: "Označiť ako vybavené",
      approving: "Schvaľuje sa…",
      rejecting: "Zamieta sa…",
      resolving: "Ukladá sa…",
      cancel: "Zrušiť",
      confirm: "Potvrdiť",
    },

    confirm: {
      approveTitle: "Schváliť tento návrh?",
      approveBody:
        "Zaznamená sa vaše schválenie v Tamanore. Nič sa tým na platforme neskryje ani nezmaže — prípadná akcia na platforme naďalej prechádza existujúcimi bezpečnostnými a vykonávacími kontrolami Tamanoru.",
      rejectTitle: "Zamietnuť tento návrh?",
      rejectBody:
        "Zaznamená sa vaše zamietnutie v Tamanore. Z tohto rozhodnutia sa nespustí žiadna akcia na platforme.",
      resolveTitle: "Označiť ako vybavené?",
      resolveBody:
        "Týmto sa položka uzavrie vo vašom rade v Tamanore. Verejný komentár sa tým nezmení ani neodstráni.",
    },

    result: {
      approved: "Schválené.",
      rejected: "Zamietnuté.",
      resolved: "Označené ako vybavené.",
      conflict: "O tejto položke už rozhodol niekto iný. Zobrazujeme aktuálny stav.",
      permissionDenied: "Nemáte oprávnenie o tomto rozhodovať.",
      readOnly: "Váš prístup je iba na čítanie, takže sa to nedá zmeniť.",
      failed: "Nepodarilo sa to. Skúste to znova.",
      notFound: "Toto upozornenie už nie je dostupné.",
    },

    empty: {
      activeTitle: "Žiadne aktívne upozornenia",
      activeBody: "Momentálne nič nevyžaduje vašu pozornosť.",
      approvalTitle: "Nič nečaká na schválenie",
      approvalBody: "Návrhy, ktoré potrebujú rozhodnutie, sa zobrazia tu.",
      blockedTitle: "Žiadne zablokované akcie",
      blockedBody: "Akcie zadržané bezpečnostnými pravidlami sa zobrazia tu.",
      resolvedTitle: "Zatiaľ nič vyriešené",
      resolvedBody: "Rozhodnuté a dokončené položky sa zobrazia tu.",
      allTitle: "Zatiaľ žiadna história akcií",
      allBody: "Všetko, čo Tamanor navrhne, sa zobrazí tu.",
    },

    notFoundTitle: "Upozornenie nie je dostupné",
    notFoundBody: "Toto upozornenie už neexistuje alebo k nemu nemáte prístup.",
    noPermission: "Nemáte oprávnenie rozhodovať o upozorneniach.",
  },
};
