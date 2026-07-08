import type {
  BrandId,
  ModerationDecisionId,
  ReputationItemId,
  TenantId,
  UserId,
  IsoTimestamp,
} from "./ids";
import type { RiskCategory, RiskLevel, Sentiment } from "./reputation";

/** The concrete action proposed on a piece of content. */
export enum ModerationAction {
  /** Do nothing — explicitly leave as-is. */
  None = "none",
  /** Post a reply. */
  Reply = "reply",
  /** Hide from public view (where the platform API allows). */
  Hide = "hide",
  /** Delete the content (where the platform API allows). */
  Delete = "delete",
  /** Dismiss the item without a platform-side change. */
  Ignore = "ignore",
  /** Mark as resolved without a platform-side change. */
  MarkResolved = "mark_resolved",
  /** Escalate to a human / another team. */
  Escalate = "escalate",
}

/**
 * Actions that touch an external platform and therefore MUST pass a connector
 * capability check before they can execute. Non-platform actions (ignore,
 * mark_resolved, escalate, none) are Guardora-side state changes only.
 */
const PLATFORM_ACTIONS: ReadonlySet<ModerationAction> = new Set([
  ModerationAction.Reply,
  ModerationAction.Hide,
  ModerationAction.Delete,
]);

export function isPlatformAction(action: ModerationAction): boolean {
  return PLATFORM_ACTIONS.has(action);
}

/** Who or what proposed a moderation decision. */
export enum ActorKind {
  /** The AI Risk Engine proposed it. */
  Ai = "ai",
  /** A human user in the dashboard. */
  Human = "human",
  /** A deterministic brand rule. */
  Rule = "rule",
  /** The background worker / system. */
  System = "system",
}

/** Lifecycle state of a moderation proposal. */
export enum DecisionStatus {
  /** Proposed, awaiting human approval. */
  Proposed = "proposed",
  /** Approved by an authorized reviewer, queued for execution. */
  Approved = "approved",
  /** Rejected by a reviewer — will not execute. */
  Rejected = "rejected",
  /** Successfully executed (mock in V1.1). */
  Executed = "executed",
  /** Execution failed (e.g. unsupported by the platform API). */
  Failed = "failed",
  /** Withdrawn before execution. */
  Cancelled = "cancelled",
}

/** Statuses that are terminal — no further transition is allowed. */
export const TERMINAL_DECISION_STATUSES: ReadonlySet<DecisionStatus> = new Set([
  DecisionStatus.Rejected,
  DecisionStatus.Executed,
  DecisionStatus.Cancelled,
]);

/**
 * A point-in-time copy of the AI risk assessment captured when the proposal was
 * created, so reviewers see what the engine thought at that moment even if the
 * item is later re-classified.
 */
export interface RiskSnapshot {
  level: RiskLevel;
  confidence: number;
  categories: RiskCategory[];
  sentiment: Sentiment;
}

/**
 * A ModerationDecision is a PROPOSAL to act on a reputation item. Nothing is
 * executed until an authorized reviewer approves it, and platform actions are
 * always capability-checked before execution. Every transition is audited.
 */
export interface ModerationDecision {
  id: ModerationDecisionId;
  tenantId: TenantId;
  brandId: BrandId;
  reputationItemId: ReputationItemId;
  action: ModerationAction;
  status: DecisionStatus;
  /** Who proposed the action. */
  proposedByKind: ActorKind;
  /** Set when a human proposed it. */
  proposedByUserId?: UserId;
  /** For Reply actions: the drafted reply text. */
  replyText?: string;
  /** Why this action was proposed (model rationale or human note). */
  reason?: string;
  /** AI confidence at proposal time, if AI-driven. */
  confidence?: number;
  /** Risk assessment captured at proposal time. */
  riskSnapshot?: RiskSnapshot;
  /** The reviewer who approved/rejected/cancelled. */
  reviewerUserId?: UserId;
  reviewedAt?: IsoTimestamp;
  executedAt?: IsoTimestamp;
  /** Populated when status is Failed. */
  failureReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
