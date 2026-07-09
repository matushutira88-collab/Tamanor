import type { Route } from "next";

export type NavIcon =
  | "command"
  | "control"
  | "queue"
  | "incidents"
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
}

/** Look up a nav item by href (avoids brittle positional indexing). */
export function navItem(href: string): NavItem {
  const found = DASHBOARD_NAV.find((n) => n.href === href);
  if (!found) throw new Error(`Unknown nav href: ${href}`);
  return found;
}

export const DASHBOARD_NAV: NavItem[] = [
  {
    href: "/dashboard/command-center",
    label: "Command Center",
    description: "Control how your brand reacts online — in one place.",
    icon: "command",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Your reputation at a glance across every brand and platform.",
    icon: "dashboard",
  },
  {
    href: "/dashboard/inbox",
    label: "Inbox",
    description: "Triage comments, reviews, and mentions in one unified place.",
    icon: "inbox",
  },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    description: "Review proposed actions. Nothing runs until approved and executed.",
    icon: "approvals",
  },
  {
    href: "/dashboard/brands",
    label: "Brands",
    description: "The brands you protect — language, timezone, tone, and status.",
    icon: "brands",
    group: "Manage",
  },
  {
    href: "/dashboard/accounts",
    label: "Accounts",
    description: "Connect platforms via official OAuth. No passwords, no scraping.",
    icon: "accounts",
    group: "Manage",
  },
  {
    href: "/dashboard/rules",
    label: "Rules",
    description: "Deterministic brand policies layered on the AI Risk Engine.",
    icon: "rules",
    group: "Manage",
  },
  {
    href: "/dashboard/control-center",
    label: "Control Policies",
    description: "Define what Guardora may do for each risk category and platform.",
    icon: "control",
    group: "Control",
  },
  {
    href: "/dashboard/action-queue",
    label: "Action Queue",
    description: "Everything Guardora wants to do — suggested, pending, or shadow.",
    icon: "queue",
    group: "Control",
  },
  {
    href: "/dashboard/incidents",
    label: "Incidents",
    description: "Crises, threats and coordinated attacks that need attention.",
    icon: "incidents",
    group: "Control",
  },
  {
    href: "/dashboard/insights",
    label: "Insights",
    description: "Sentiment, emotions, topics, and risk trends over time.",
    icon: "insights",
    group: "Analyze",
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    description: "Reputation trends and moderation metrics over time.",
    icon: "reports",
    group: "Analyze",
  },
  {
    href: "/dashboard/audit",
    label: "Audit Log",
    description: "An append-only record of every automated and manual action.",
    icon: "audit",
    group: "Analyze",
  },
  {
    href: "/dashboard/leads",
    label: "Leads",
    description: "Demo requests and contact messages from your public pages.",
    icon: "leads",
    group: "Organization",
  },
  {
    href: "/dashboard/team",
    label: "Team",
    description: "Members and roles across your workspace.",
    icon: "team",
    group: "Organization",
  },
  {
    href: "/dashboard/billing",
    label: "Billing",
    description: "Your plan, usage, and trial.",
    icon: "billing",
    group: "Organization",
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    description: "Workspace profile, automations, webhooks, and security.",
    icon: "settings",
    group: "Organization",
  },
];
