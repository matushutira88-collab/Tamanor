import type {
  BrandId,
  BrandRuleId,
  TenantId,
  IsoTimestamp,
} from "./ids";

/**
 * Categories of brand rule. Each category tells the AI Risk Engine how to treat
 * a phrase match — from a hard block to a crisis signal.
 */
export enum RuleCategory {
  /** Words that should never appear — strong spam/abuse signal. */
  BlockedWords = "blocked_words",
  /** Competitor names/handles — flag for awareness, not necessarily risk. */
  CompetitorMentions = "competitor_mentions",
  /** Terms that indicate a reputational crisis — escalate. */
  CrisisKeywords = "crisis_keywords",
  /** Arbitrary brand-specific phrases to watch. */
  CustomPhrases = "custom_phrases",
}

export const ALL_RULE_CATEGORIES: readonly RuleCategory[] =
  Object.values(RuleCategory);

/**
 * A BrandRule is a deterministic, phrase-based policy layered on top of the AI
 * Risk Engine. Rules let a brand encode what matters to *them* (blocked words,
 * competitors, crisis terms, custom phrases) and influence classification.
 *
 * Rules never bypass the audit log, and they never trigger destructive
 * automated actions on their own.
 */
export interface BrandRule {
  id: BrandRuleId;
  tenantId: TenantId;
  brandId: BrandId;
  name: string;
  category: RuleCategory;
  /** Case-insensitive phrases to match against content text. */
  phrases: string[];
  /** Whether the rule is currently applied. */
  enabled: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Human-facing metadata for a rule category. */
export interface RuleCategoryMeta {
  category: RuleCategory;
  label: string;
  description: string;
}

export const RULE_CATEGORY_META: Record<RuleCategory, RuleCategoryMeta> = {
  [RuleCategory.BlockedWords]: {
    category: RuleCategory.BlockedWords,
    label: "Blocked words",
    description: "Words that should never appear. Strong risk signal.",
  },
  [RuleCategory.CompetitorMentions]: {
    category: RuleCategory.CompetitorMentions,
    label: "Competitor mentions",
    description: "Competitor names or handles to flag for awareness.",
  },
  [RuleCategory.CrisisKeywords]: {
    category: RuleCategory.CrisisKeywords,
    label: "Crisis keywords",
    description: "Terms indicating a reputational crisis. Escalate.",
  },
  [RuleCategory.CustomPhrases]: {
    category: RuleCategory.CustomPhrases,
    label: "Custom phrases",
    description: "Any brand-specific phrases to watch.",
  },
};
