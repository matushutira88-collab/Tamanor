import type {
  BrandId,
  ConnectorAccountId,
  ContentItemId,
  ReputationItemId,
  TenantId,
  IsoTimestamp,
} from "./ids";
import type { Platform } from "./platform";

/** What kind of external content a reputation item represents. */
export enum ContentKind {
  Comment = "comment",
  Reply = "reply",
  Review = "review",
  Mention = "mention",
  DirectMessage = "direct_message",
}

/** Author of the external content (never a Guardora user). */
export interface ContentAuthor {
  /** Platform-scoped author id. */
  externalId?: string;
  displayName?: string;
  /** Best-effort language of the content (BCP-47). */
  locale?: string;
}

/**
 * A ContentItem is the raw, normalized piece of external content pulled from a
 * platform (a comment, review, mention, ...). It is immutable source data.
 */
export interface ContentItem {
  id: ContentItemId;
  tenantId: TenantId;
  brandId: BrandId;
  connectorAccountId: ConnectorAccountId;
  platform: Platform;
  kind: ContentKind;
  /** Platform-native id of the content. */
  externalId: string;
  /** Id of the parent object (post, video, review target). */
  externalParentId?: string;
  text: string;
  author: ContentAuthor;
  /** Numeric rating for reviews (1–5), if applicable. */
  rating?: number;
  /** When the content was published on the platform. */
  publishedAt: IsoTimestamp;
  /** When Guardora ingested it. */
  ingestedAt: IsoTimestamp;
  /** Deep link back to the content on the platform. */
  permalink?: string;
}

/** Workflow state of a reputation item inside the Guardora inbox. */
export enum ReputationStatus {
  /** Newly ingested, not yet classified. */
  New = "new",
  /** Classified by the AI Risk Engine, awaiting triage. */
  Classified = "classified",
  /** Requires a human decision (queued for approval). */
  NeedsApproval = "needs_approval",
  /** A moderation action is scheduled/executing. */
  Actioned = "actioned",
  /** Escalated to a human / another team. */
  Escalated = "escalated",
  /** Dismissed without action. */
  Ignored = "ignored",
  /** Closed — resolved. */
  Resolved = "resolved",
}

/** Triage priority for an inbox item. */
export enum Priority {
  Low = "low",
  Normal = "normal",
  High = "high",
  Urgent = "urgent",
}

/**
 * A ReputationItem is the workflow object that wraps a ContentItem with its
 * risk assessment and moderation state. This is what appears in the inbox.
 */
export interface ReputationItem {
  id: ReputationItemId;
  tenantId: TenantId;
  brandId: BrandId;
  platform: Platform;
  contentItemId: ContentItemId;
  status: ReputationStatus;
  priority: Priority;
  risk: ReputationRisk;
  /** Whether this item has been routed to human approval. */
  requiresApproval: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Coarse severity buckets for triage and reporting. */
export enum RiskLevel {
  None = "none",
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}

/** Categories the AI Risk Engine can assign. Multiple may apply. */
export enum RiskCategory {
  Spam = "spam",
  Scam = "scam",
  HateSpeech = "hate_speech",
  Harassment = "harassment",
  Profanity = "profanity",
  Misinformation = "misinformation",
  BrandAttack = "brand_attack",
  Complaint = "complaint",
  LegalThreat = "legal_threat",
  SelfHarm = "self_harm",
  Positive = "positive",
  Neutral = "neutral",
}

export enum Sentiment {
  Negative = "negative",
  Neutral = "neutral",
  Positive = "positive",
}

/**
 * The risk assessment attached to a reputation item. Produced by the AI Risk
 * Engine; may be overridden by brand rules or a human reviewer.
 */
export interface ReputationRisk {
  level: RiskLevel;
  /** Model confidence 0..1. Drives auto-action eligibility. */
  confidence: number;
  categories: RiskCategory[];
  sentiment: Sentiment;
  /** Short human-readable rationale for the assessment. */
  rationale?: string;
  /** Which engine/version produced this (for auditing). */
  engine?: string;
  assessedAt?: IsoTimestamp;
}
