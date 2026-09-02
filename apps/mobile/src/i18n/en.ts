/**
 * English strings — the reference locale and the shape every other locale must match.
 *
 * Wording is taken from the web product where an equivalent string exists
 * (`apps/web/src/app/dashboard/page.tsx` COPY / ACTIVITY_LABEL and the dashboard
 * layout's StateBanner) so the two surfaces read the same.
 */
import { enInbox } from "./en-inbox";

export const en = {
  ...enInbox,
  nav: {
    overview: "Overview",
    comments: "Comments",
    accounts: "Accounts",
    alerts: "Alerts",
    more: "More",
    activity: "Activity",
    rules: "Protection rules",
    billing: "Billing",
    settings: "Settings",
    team: "Team",
  },
  common: {
    retry: "Try again",
    refresh: "Refresh",
    viewAll: "View all",
    signOut: "Sign out",
    loading: "Loading",
    comingSoon: "Coming soon",
    comingSoonBody: "This section arrives in a future update. Everything here already works on tamanor.com.",
    unlimited: "Unlimited",
    of: "of",
  },
  dashboard: {
    eyebrow: "Overview",
    greeting: "Welcome back",
    subtitle: "Here's what's happening with your brand reputation today.",
    vsPrev: "vs. previous period",
    timeframe: (days: number) => `${days}d`,
    timeframeA11y: (days: number) => `Show the last ${days} days`,
    realTestMode: "Real test mode",
    realTestModeHint: "Only real connected data is shown.",
  },
  kpi: {
    analyzed: "Analyzed comments",
    risk: "Risk comments",
    autoHandled: "Auto-handled",
    pending: "Pending review",
    problem: "Accounts with problem",
    pendingHint: "Awaiting decision",
    problemHint: "Need attention",
    noBaseline: "No comparison yet",
    up: "up",
    down: "down",
  },
  accounts: {
    section: "Watched accounts",
    comments: "Comments",
    risky: "Risky",
    autoHide: "Auto-hide",
    on: "On",
    off: "Off",
    lastSync: "Synced",
    neverSync: "Not synced yet",
    showingOf: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    status: {
      active: "Active",
      permissions_expired: "Permissions expired",
      sync_failed: "Needs attention",
      monitoring_off: "Monitoring off",
      demo: "Demo",
    },
  },
  protection: {
    section: "Protection level",
    scoreOf: (score: number) => `${score} out of 100`,
    strong: "Strong",
    partial: "Partial",
    weak: "Needs work",
    state: { ok: "OK", partial: "Partial", off: "Off" },
    checks: {
      metaPermissionsHealthy: "Platform permissions",
      syncHealthy: "Synchronization",
      rulesActive: "Protection rules",
      dangerousLinksHandled: "Dangerous links",
      fraudProtection: "Fraud protection",
      reviewWorkflow: "Review workflow",
      actionConfigured: "Action configured",
    },
  },
  trend: {
    section: "Risk comments",
    description: "Trend over the selected period.",
    empty: "No risk comments in this period.",
    summary: (total: number, days: number) => `${total} risk comments over the last ${days} days.`,
    peak: (count: number, day: string) => `Highest day: ${count} on ${day}.`,
  },
  activity: {
    section: "Recent activity",
    empty: "No recent activity yet.",
    types: {
      "sync.completed": "Synchronization completed",
      "sync.failed": "Synchronization failed",
      "auto_protect.would_auto_hide": "Comment flagged for auto-hide",
      "protection.action_executed": "Comment hidden",
      "incident.created": "Incident created",
      "proposal.created": "Action proposed",
      "account.connected": "Account connected",
      "token.expired": "Permissions expired",
    },
  },
  empty: {
    title: "Let's protect your first account",
    body: "Connect a social account and Tamanor starts watching comments for risk right away.",
    hint: "You can connect accounts on tamanor.com — the mobile flow arrives soon.",
    cta: "Connect account",
  },
  access: {
    restricted:
      "Your trial or subscription has ended — you're in read-only restricted mode. Choose a plan to restore full access.",
    past_due: "Your last payment failed. Update your payment method to keep full access.",
    trial_ending: (days: number) => `Free trial — ${days} ${days === 1 ? "day" : "days"} left.`,
    cta: "Go to billing",
  },
  errors: {
    title: "Couldn't load your dashboard",
    network: "No connection. Check your network and try again.",
    timeout: "Tamanor took too long to respond. Please try again.",
    server: "Something went wrong on our side. Please try again.",
    forbidden: "You don't have access to this workspace on mobile.",
    config: "This build is not configured to reach Tamanor.",
  },
  usage: {
    processedItems: "Comments processed",
    accounts: "Connected accounts",
  },
};

export type Dictionary = typeof en;
