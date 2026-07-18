import type { Route } from "next";

export type NavIcon =
  | "command"
  | "control"
  | "queue"
  | "incidents"
  | "timeline"
  | "dashboard"
  | "inbox"
  | "approvals"
  | "brands"
  | "accounts"
  | "insights"
  | "reports"
  | "rules"
  | "audit"
  | "leads"
  | "team"
  | "billing"
  | "settings";

export interface NavItem {
  href: Route;
  label: string;
  /** Short description shown in page headers. */
  description: string;
  icon: NavIcon;
  /** Sidebar section header (rendered when the group changes). */
  group?: string;
  /**
   * V1.28B — hidden from the sidebar (route stays available). The production nav
   * is intentionally small: 5 primary pages + Timeline/Audit/Settings.
   */
  hidden?: boolean;
  /** V1.30 — override the dashboardNav dictionary key (defaults to `icon`). */
  navKey?: string;
}

/** Look up a nav item by href (avoids brittle positional indexing). */
export function navItem(href: string): NavItem {
  const found = DASHBOARD_NAV.find((n) => n.href === href);
  if (!found) throw new Error(`Unknown nav href: ${href}`);
  return found;
}

/**
 * V1.28B production nav — 5 primary pages with clear ownership, a small "More"
 * section, and everything else hidden (routes remain available via links).
 *   Command Center  = executive overview
 *   Action Queue    = active work queue (human decisions)
 *   Control Center  = policy & automation settings
 *   Accounts        = connection health
 *   Incidents       = crises & escalations
 */
export const DASHBOARD_NAV: NavItem[] = [
  // V1.60 mockup nav — Overview first, guarded accounts + comments + alerts as the
  // daily loop, policies/billing/settings below; power pages live under "More".
  {
    href: "/dashboard",
    label: "Overview",
    description: "Your reputation at a glance across every brand and platform.",
    icon: "dashboard",
  },
  {
    href: "/dashboard/accounts",
    label: "Guarded accounts",
    description: "Connect platforms via official OAuth. No passwords, no scraping.",
    icon: "accounts",
  },
  {
    href: "/dashboard/comments",
    label: "Comments",
    description: "Every comment Tamanor captured on your connected accounts — positive, neutral, negative and risky.",
    icon: "inbox",
    navKey: "comments",
  },
  {
    href: "/dashboard/action-queue",
    label: "Alerts",
    description: "Items that still need a decision.",
    icon: "queue",
  },
  {
    href: "/dashboard/timeline",
    label: "Activity",
    description: "Every event over time — syncs, matches, decisions and safety blocks.",
    icon: "timeline",
  },
  {
    href: "/dashboard/control-center",
    label: "Protection rules",
    description: "Define what Tamanor may do for each risk category and platform.",
    icon: "control",
  },
  {
    href: "/dashboard/billing",
    label: "Billing",
    description: "Your plan, subscription, and invoices.",
    icon: "billing",
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    description: "Workspace profile, automations, webhooks, and security.",
    icon: "settings",
  },
  {
    href: "/dashboard/command-center",
    label: "Command Center",
    description: "Control how your brand reacts online — in one place.",
    icon: "command",
    group: "More",
  },
  {
    href: "/dashboard/reputation",
    label: "Reputation",
    description: "Public mood, risk trends, topics and the riskiest posts for your brand.",
    icon: "insights",
    group: "More",
  },
  {
    href: "/dashboard/incidents",
    label: "Incidents",
    description: "Crises, threats and coordinated attacks that need attention.",
    icon: "incidents",
    group: "More",
  },
  {
    href: "/dashboard/actor-risk",
    label: "Actor Risk",
    description: "Profiles with repeated risky behavior in comments on connected accounts.",
    icon: "incidents",
    navKey: "actorRisk",
    group: "More",
  },
  {
    href: "/dashboard/audit",
    label: "Audit Log",
    description: "An append-only record of every automated and manual action.",
    icon: "audit",
    group: "More",
  },
  // --- Hidden from the sidebar (routes stay available) ---
  { href: "/dashboard/inbox", label: "Inbox", description: "Triage comments, reviews, and mentions in one unified place.", icon: "inbox", hidden: true },
  { href: "/dashboard/approvals", label: "Approvals", description: "Review proposed actions. Nothing runs until approved and executed.", icon: "approvals", hidden: true },
  { href: "/dashboard/brands", label: "Brands", description: "The brands you protect — language, timezone, tone, and status.", icon: "brands", hidden: true },
  { href: "/dashboard/rules", label: "Rules", description: "Deterministic brand policies layered on the AI Risk Engine.", icon: "rules", hidden: true },
  { href: "/dashboard/insights", label: "Insights", description: "Sentiment, emotions, topics, and risk trends over time.", icon: "insights", hidden: true },
  { href: "/dashboard/reports", label: "Reports", description: "Reputation trends and moderation metrics over time.", icon: "reports", hidden: true },
  { href: "/dashboard/leads", label: "Leads", description: "Platform-level prospect administration (platform staff only). Hidden in nav; access is enforced server-side, not by hiding.", icon: "leads", hidden: true },
  { href: "/dashboard/team", label: "Team", description: "Members and roles across your workspace.", icon: "team", hidden: true },
];
