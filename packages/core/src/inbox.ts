/**
 * V1.37 Unified Brand Inbox V2 — provider-neutral layer.
 *
 * Every provider declares CAPABILITIES; the inbox UI and action engine consume
 * only capability flags — never provider-specific `if` statements. This keeps the
 * architecture ready for future connectors and guarantees an action a provider
 * cannot perform is never offered. Fail-closed by default.
 */
import { getCapabilities, type PlatformKey } from "./capabilities";

// ---------------------------------------------------------------------------
// A) Provider capability registry — spec-named flags, derived from the real
//    per-platform capability profile (no guessing, no hardcoded UI logic).
// ---------------------------------------------------------------------------
export interface ProviderCapabilityFlags {
  canReadContent: boolean;
  canHideComment: boolean;
  canDeleteComment: boolean;
  canReply: boolean;
  canBanUser: boolean;
  supportsReviews: boolean;
  supportsRatings: boolean;
  supportsDM: boolean;
  supportsMedia: boolean;
  supportsRealtime: boolean;
}

export function providerCapabilities(platform: PlatformKey): ProviderCapabilityFlags {
  const c = getCapabilities(platform);
  return {
    canReadContent: c.canReadComments || c.canReviewSync,
    canHideComment: c.canHideComment,
    canDeleteComment: c.canDeleteComment,
    canReply: c.canReplyToComment,
    canBanUser: c.canBanAuthor,
    supportsReviews: c.canReviewSync,
    supportsRatings: c.canReviewSync, // reviews carry a star rating
    supportsDM: false, // Tamanor does not touch DMs on any provider
    supportsMedia: false,
    supportsRealtime: false,
  };
}

// ---------------------------------------------------------------------------
// B) Unified inbox item model — one shape for Facebook/Instagram comments and
//    Google reviews. `availableActions` is capability-derived.
// ---------------------------------------------------------------------------
export type InboxContentType = "comment" | "review";

export type InboxAction =
  // Tamanor-side actions (no platform write) — available on every provider.
  | "read" | "archive" | "label" | "approve_ai" | "open_queue"
  // Platform write actions — only when the provider capability allows them.
  | "hide" | "reply" | "delete" | "ban";

export interface InboxItem {
  provider: PlatformKey;
  contentType: InboxContentType;
  author: string | null;
  text: string;
  rating: number | null;
  createdAt: Date;
  externalId: string;
  risk: string;
  sentiment: string;
  status: string;
  availableActions: InboxAction[];
}

/** Tamanor-side actions never touch a platform → available on all providers. */
export const TAMANOR_SIDE_ACTIONS: readonly InboxAction[] = ["read", "archive", "label", "approve_ai", "open_queue"];

/**
 * C) The generic action engine. Which actions are available for an item on a
 * given provider, gated by capability AND connector health. Platform write
 * actions require a healthy connector; unhealthy → only Tamanor-side actions.
 */
export function inboxAvailableActions(platform: PlatformKey, opts: { connectorHealthy?: boolean } = {}): InboxAction[] {
  const caps = providerCapabilities(platform);
  const actions: InboxAction[] = [...TAMANOR_SIDE_ACTIONS];
  const healthy = opts.connectorHealthy !== false;
  if (healthy) {
    if (caps.canHideComment) actions.push("hide");
    if (caps.canReply) actions.push("reply");
    if (caps.canDeleteComment) actions.push("delete");
    if (caps.canBanUser) actions.push("ban");
  }
  return actions;
}

/** True only if the action is permitted for the provider (capability + health). */
export function isInboxActionAvailable(action: InboxAction, platform: PlatformKey, opts: { connectorHealthy?: boolean } = {}): boolean {
  return inboxAvailableActions(platform, opts).includes(action);
}

/**
 * F) Bulk-eligible actions for a provider. Only Tamanor-side actions are ever
 * bulk-safe (read/archive/label/approve_ai). Platform write actions are NEVER
 * bulk operations — each remains individually gated + audited. So Google reviews
 * bulk-support = read/archive/label/approve_ai (no reply/delete/hide), exactly.
 */
export function bulkEligibleActions(platform: PlatformKey): InboxAction[] {
  const available = new Set(inboxAvailableActions(platform));
  return (["read", "archive", "label", "approve_ai"] as InboxAction[]).filter((a) => available.has(a));
}

/**
 * V1.42 — the persisted, provider-neutral internal actions (Tamanor-side workflow). These are
 * ALWAYS available regardless of connector health (they never touch a platform).
 */
export type InboxInternalAction =
  | "mark_read" | "mark_unread"
  | "archive" | "unarchive"
  | "add_label" | "remove_label"
  | "assign" | "unassign"
  | "add_note"
  | "set_priority" | "set_workflow_status";

/** Provider WRITE actions — never bulk, always capability + health + approval gated. */
export const PROVIDER_WRITE_ACTIONS: readonly InboxAction[] = ["hide", "reply", "delete", "ban"];

/** Internal actions that are safe to run as a BULK operation (note is NOT bulk). */
export const INBOX_BULK_ALLOWED: readonly InboxInternalAction[] = [
  "mark_read", "mark_unread", "archive", "unarchive", "add_label", "remove_label", "assign", "unassign", "set_priority", "set_workflow_status",
];

/** True only for an internal action that is bulk-safe. Provider writes are NEVER bulk-eligible. */
export function isInboxBulkAllowed(action: string): action is InboxInternalAction {
  return (INBOX_BULK_ALLOWED as readonly string[]).includes(action) && !(PROVIDER_WRITE_ACTIONS as readonly string[]).includes(action);
}

/**
 * Server-side re-verification for a PROVIDER WRITE action. The UI hides unavailable actions, but
 * the server must ALSO reject them: capability (per platform) + connector health must both permit.
 * Google reviews (no write capability) are always rejected here.
 */
export function assertProviderWriteAllowed(action: InboxAction, platform: PlatformKey, opts: { connectorHealthy?: boolean } = {}): boolean {
  if (!(PROVIDER_WRITE_ACTIONS as readonly string[]).includes(action)) return false;
  return isInboxActionAvailable(action, platform, opts);
}

// ---------------------------------------------------------------------------
// I) Connector health — honest, never a fake green state.
// ---------------------------------------------------------------------------
export type ConnectorHealthState =
  | "healthy"
  | "disconnected"
  | "permission_missing"
  | "api_unavailable"
  | "verification_pending"
  | "rate_limited"
  | "error";

export function connectorHealthStatus(input: {
  platform: PlatformKey;
  supported: boolean;
  status?: string | null;
  health?: string | null;
  tokenHealth?: string | null;
  lastError?: string | null;
  reviewPlatform?: boolean;
  verifiedLocationCount?: number | null;
}): ConnectorHealthState {
  // A research/unimplemented provider is never "healthy".
  if (!input.supported) return "api_unavailable";
  if (input.status === "disconnected" || input.status === "revoked") return "disconnected";
  if (input.tokenHealth === "expired" || input.tokenHealth === "invalid" || input.status === "expired") return "disconnected";
  const err = (input.lastError ?? "").toLowerCase();
  if (/permission|scope|forbidden/.test(err)) return "permission_missing";
  if (/rate|throttl|quota/.test(err)) return "rate_limited";
  if (/unavailable|api not enabled|not.?approved|accessnotconfigured/.test(err)) return "api_unavailable";
  // Review platforms need a verified location before they are healthy.
  if (input.reviewPlatform && (input.verifiedLocationCount ?? 0) === 0) return "verification_pending";
  if (input.health === "error") return "error";
  if (input.status === "active" && (input.health === "healthy" || input.health === "unknown")) return "healthy";
  if (err) return "error";
  return "healthy";
}
