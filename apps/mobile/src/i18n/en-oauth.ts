/**
 * English strings for native connector OAuth.
 *
 * Copy discipline for M7: an AUTHORIZATION is not a CONNECTION. Nothing here may
 * say "connected" until the server has confirmed it, and the selection step must
 * read as a required step rather than as a failure.
 */
export const enOauth = {
  oauth: {
    /**
     * The continuation card shown after a provider browser returns to the app.
     * It states ONLY that the sign-in came back — never that anything connected.
     * The outcome is unknown until the server's authenticated status read.
     */
    continuation: {
      title: "Finish connecting your account",
      body: "Your provider sign-in has returned to Tamanor. Continue to verify the result.",
      cta: "Finish connecting",
    },
    connectTitle: "Connect an account",
    connectSubtitle: "Choose where Tamanor should watch for comments and reviews.",
    provider: { meta: "Facebook & Instagram", google_business: "Google Business Profile" },
    providerHint: {
      meta: "Facebook Pages and linked Instagram Business accounts.",
      google_business: "Reviews on your Google Business locations.",
    },
    unavailable: "Not available on this Tamanor deployment yet.",
    notApproved: "Waiting for Google to approve API access.",
    chooseBrand: "Connect to",
    noBrands: "No brands are set up yet.",

    opening: "Opening your browser…",
    inBrowser: "Finish signing in with the provider in your browser.",
    checking: "Checking with Tamanor…",

    selectTitle: "Choose what to connect",
    selectSubtitleMeta: "Tamanor found these Pages and Instagram accounts.",
    selectSubtitleGoogle: "Tamanor found these locations.",
    selectNone: "Select at least one to continue.",
    alreadyConnected: "Already connected",
    ineligible: "Cannot be connected",
    ineligibleReason: { unverified: "Not verified with Google" },
    submit: "Connect selected",
    submitting: "Connecting…",

    /** Only ever shown after a server-confirmed completion. */
    doneTitle: "Connected",
    doneBody: (n: number) => `${n} account${n === 1 ? "" : "s"} connected.`,
    donePartial: (limited: number) =>
      `${limited} could not be monitored — your plan's limit is reached. They stay connected but unmonitored.`,
    doneSlot: (n: number) => `${n} could not be connected: that brand already has an account on this platform.`,

    failedTitle: "Not connected",
    reason: {
      user_cancelled: "You cancelled before finishing.",
      invalid_state: "That sign-in link was no longer valid. Please try again.",
      expired: "The connection attempt timed out. Please try again.",
      permission_denied: "You don't have permission to connect accounts.",
      account_limit_reached: "Your plan's monitored-account limit is reached.",
      brand_platform_limit_reached: "That brand already has an account on this platform.",
      provider_unavailable: "The platform was unreachable. Please try again shortly.",
      token_exchange_failed: "The platform didn't complete the sign-in. Please try again.",
      missing_permission: "A permission Tamanor needs wasn't granted.",
      no_accounts: "No eligible accounts were found to connect.",
      selection_required: "Choose what to connect to finish.",
      save_failed: "The connection couldn't be saved. Please try again.",
      not_found: "That connection attempt is no longer available.",
      session_invalid: "You were signed out before this finished. Sign in and try again.",
      unknown: "Something went wrong. Please try again.",
    },
    tryAgain: "Try again",
    close: "Close",
    cancel: "Cancel",
    /** Stated plainly so the browser step is never a surprise. */
    browserNotice:
      "Tamanor opens your browser only to sign in with the provider. You stay signed in to Tamanor on this device.",
  },
};
