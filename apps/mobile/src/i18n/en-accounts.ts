/**
 * English strings for Accounts.
 *
 * Copy discipline for M6: connection health, monitoring, auto-sync and provider
 * action capability are FOUR separate labelled facts. No string may summarize them
 * as one "Active", and monitoring copy must never imply that it means connected,
 * syncing, or that moderation is enabled.
 *
 * Disconnect copy must not claim more than Tamanor actually does: it removes the
 * local credentials, and for Meta the provider-side authorization may survive.
 */
export const enAccounts = {
  accounts: {
    title: "Accounts",
    subtitle: "The accounts Tamanor is connected to.",
    connectedCount: (n: number) => `${n} connected account${n === 1 ? "" : "s"}`,
    monitoringUsage: (used: number, limit: number) =>
      limit < 0 ? `${used} monitored` : `${used} of ${limit} monitored`,
    needsAttention: (n: number) => `${n} need${n === 1 ? "s" : ""} attention`,
    allHealthy: "All connections are healthy.",
    viewDetails: "View details",
    refresh: "Refresh",

    filters: {
      all: "All",
      attention: "Needs attention",
      monitored: "Monitoring on",
      unmonitored: "Monitoring off",
    },

    /** Section headings on the detail screen. */
    sections: {
      identity: "Account",
      connection: "Connection",
      monitoring: "Monitoring",
      sync: "Synchronization",
      permissions: "What Tamanor can do",
      activity: "Recent syncs",
      danger: "Connection management",
    },

    /** TRUTH 1 — connection health. Only `CONNECTED_HEALTHY` is a success state. */
    connectionLabel: "Connection",
    connection: {
      CONNECTED_HEALTHY: "Connected",
      WAITING_FIRST_SYNC: "Waiting for the first sync",
      DEGRADED: "Connection degraded",
      SYNC_FAILED: "Last sync failed",
      REAUTH_REQUIRED: "Reconnect required",
      DISCONNECTED: "Disconnected",
    },

    /** TRUTH 2 — monitoring. Explicitly NOT a statement about the connection. */
    monitoringLabel: "Monitoring",
    monitoringOn: "On",
    monitoringOff: "Off",
    monitoringMeaning:
      "Monitoring means Tamanor watches this account. It is separate from whether the account is connected, whether automatic sync is running, and whether Tamanor may act on the platform.",
    monitoringLimitReached:
      "Your plan's monitored-account limit is reached. Turn monitoring off somewhere else, or upgrade, to monitor this one.",

    /** TRUTH 3 — automatic synchronization. */
    autoSyncLabel: "Automatic sync",
    autoSync: {
      ENABLED_HEALTHY: "Running",
      ENABLED_DEGRADED: "Running, with problems",
      ENABLED_REAUTH_REQUIRED: "Stopped — reconnect required",
      DISABLED: "Off",
      NOT_CONFIGURED: "Not set up",
    },

    firstSyncLabel: "First sync",
    firstSync: {
      waiting_first_sync: "Waiting for the first sync",
      syncing: "Syncing now",
      synced: "Completed",
      failed: "The first sync failed",
    },

    lastSuccessfulSync: "Last successful sync",
    lastAttempt: "Last attempt",
    neverSynced: "Never synchronized",
    commentsToday: "Comments today",
    riskToday: "Risky today",

    accountKind: {
      real: "Live connection",
      read_only: "Read-only connection",
      test: "Demo connection",
    },

    /** TRUTH 4 — capability. Presentation only; the server decides every time. */
    capability: {
      canRead: "Reading comments",
      canSync: "Manual sync",
      canMonitor: "Monitoring",
      canReconnect: "Reconnecting",
      canDisconnect: "Disconnecting",
      moderationState: "Hiding comments",
      replyState: "Replying",
    },
    capabilityState: {
      available: "Available",
      unavailable: "Not available right now",
      not_implemented: "Not implemented",
      not_configured: "Not set up",
      missing_permission: "You don't have permission",
      requires_web: "On tamanor.com",
      blocked_by_safety: "Held by safety rules",
    },

    tokenHealthLabel: "Access",
    tokenHealth: {
      unknown: "Not checked yet",
      ok: "Working",
      expiring_soon: "Expiring soon",
      expired: "Expired",
      invalid: "No longer valid",
      revoked: "Withdrawn",
    },
    tokenExpires: "Access expires",
    lastProviderCheck: "Last checked with the platform",
    protectionPaused: "Protection actions are paused.",

    reason: {
      token_expired: "The account's access has expired",
      permission_missing: "A required permission is missing",
      provider_unavailable: "The platform was unreachable",
      rate_limited: "The platform is rate-limiting Tamanor",
      sync_failed: "The last sync failed",
      reconnect_required: "The account needs reconnecting",
      no_token: "Tamanor has no valid access for this account",
      disconnected: "The account is disconnected",
      credential_persist_failed: "The connection could not be saved",
      instagram_disconnected: "The linked Instagram account was disconnected",
      account_not_discoverable: "The account could not be found on the platform",
      unknown: "The platform reported a problem",
    },

    syncRun: {
      status: {
        running: "Running",
        completed: "Completed",
        failed: "Failed",
        partial_success: "Partly completed",
        skipped_locked: "Skipped — already running",
        disconnected: "Skipped — disconnected",
        permission_missing: "Failed — permission missing",
        rate_limited: "Failed — rate limited",
        api_unavailable: "Failed — platform unavailable",
        interrupted: "Interrupted",
      },
      fetched: (n: number) => `${n} fetched`,
      created: (n: number) => `${n} new`,
      demo: "Demo data",
      none: "No syncs yet.",
    },

    actions: {
      syncNow: "Sync now",
      syncing: "Starting…",
      connect: "Connect an account",
      reconnect: "Reconnect",
      manageOnWeb: "Manage on tamanor.com",
      disconnect: "Disconnect",
      disconnecting: "Disconnecting…",
      cancel: "Cancel",
      confirm: "Confirm",
    },

    /** A sync is asynchronous. None of these may imply it finished. */
    syncResult: {
      started: "Sync started. Results will appear shortly — pull down to refresh.",
      already_running: "A sync is already running for this account.",
      reconnect_required: "Reconnect this account before syncing.",
      not_supported: "Manual sync isn't available for this platform yet.",
      not_found: "This account is no longer available.",
    },

    disconnectConfirm: {
      title: "Disconnect this account?",
      body:
        "Tamanor will stop using this connection. The access it stored is removed, and monitoring and synchronization stop for it.",
      publicNotice:
        "This does not delete or change anything published on Facebook, Instagram or Google — only Tamanor's connection to the account.",
      clusterNotice: (n: number) =>
        `This connection shares its access with ${n} connected accounts. Disconnecting removes the stored access for all of them.`,
    },
    disconnectResult: {
      done: "Disconnected.",
      manualCleanup:
        "The platform doesn't let Tamanor withdraw its own access. To finish removing Tamanor, open the platform's business or app settings and remove it there.",
      clusterAffected: (n: number) => `${n} connected accounts were affected.`,
    },

    /** The web hand-off. It must be clear that this leaves the app. */
    webHandoff: {
      connectTitle: "Connect on tamanor.com",
      connectBody:
        "Connecting an account happens on tamanor.com in your browser. You may need to sign in again there.",
      reconnectTitle: "Reconnect on tamanor.com",
      reconnectBody:
        "Reconnecting happens on tamanor.com in your browser. You may need to sign in again there.",
      open: "Open in browser",
      unavailable: "Couldn't open the browser. Visit tamanor.com to manage this connection.",
      notConfigured: "Tamanor isn't configured to open the web app on this device.",
    },

    empty: {
      title: "No connected accounts",
      body:
        "Connect a Facebook Page, an Instagram Business account or a Google Business Profile, and Tamanor will start watching what people post about you.",
      viewerBody: "No accounts are connected yet. Ask an admin to connect one.",
      filterTitle: "Nothing matches",
      filterBody: "No accounts match this filter.",
      clearFilter: "Show all",
    },

    notFoundTitle: "Account unavailable",
    notFoundBody: "This account no longer exists, or you don't have access to it.",
    noPermission: "You don't have permission to manage connections.",
    readOnlyNotice: "Your access is read-only, so connections can't be changed.",
  },
};
