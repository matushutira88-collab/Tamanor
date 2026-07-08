/**
 * Professional, sparing emoji accents for enum labels — used to speed up
 * recognition (risk, sentiment, emotions, topics, approval states). Language-
 * independent: applied on top of the translated `tEnum` label.
 *
 * Guidelines: not everywhere, never childish. Only high-signal values carry an
 * emoji; low-signal ones return "" so the enterprise dashboard stays calm.
 */

const RISK: Record<string, string> = {
  critical: "🔥",
  high: "⚠️",
  medium: "",
  low: "",
  none: "",
};

const SENTIMENT: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😞",
};

const EMOTION: Record<string, string> = {
  Anger: "😡",
  Anxiety: "😟",
  Sadness: "😢",
  Happiness: "😊",
  Warmth: "🤝",
};

const DECISION: Record<string, string> = {
  proposed: "⏳",
  approved: "✅",
  executed: "✔️",
  rejected: "✋",
  failed: "⚠️",
};

const KIND: Record<string, string> = {
  comment: "💬",
  review: "⭐",
  post: "📝",
  mention: "🔖",
};

const HEALTH: Record<string, string> = {
  healthy: "🛡️",
  degraded: "⚠️",
  error: "🚨",
  unknown: "",
};

const CATEGORY: Record<string, string> = {
  spam: "🚫",
  scam: "⚠️",
  hate_speech: "😡",
  harassment: "😠",
  profanity: "🤬",
  misinformation: "❗",
  brand_attack: "🚨",
  complaint: "😕",
  legal_threat: "⚖️",
  self_harm: "🆘",
  positive: "😊",
  neutral: "💬",
};

// Rule/playbook categories (brand policies layered on the AI Risk Engine).
const RULE_CATEGORY: Record<string, string> = {
  blocked_words: "🚫",
  competitor_mentions: "🏷️",
  crisis_keywords: "🚨",
  custom_phrases: "✍️",
};

const MAPS: Record<string, Record<string, string>> = {
  risk: RISK,
  sentiment: SENTIMENT,
  emotion: EMOTION,
  decision: DECISION,
  kind: KIND,
  health: HEALTH,
  category: CATEGORY,
  ruleCategory: RULE_CATEGORY,
};

/** Standalone accents for non-enum UI moments. */
export const ICON = {
  incident: "🚨",
  topic: "🏷️",
  protected: "🛡️",
  safe: "✅",
} as const;

/** Emoji for an enum value, or "" when it should stay unadorned. */
export function enumEmoji(kind: keyof typeof MAPS, value: string): string {
  return MAPS[kind]?.[value] ?? "";
}

/** Prefix a label with its emoji when one exists: "🔥 Critical" / "Low". */
export function withEmoji(kind: keyof typeof MAPS, value: string, label: string): string {
  const e = enumEmoji(kind, value);
  return e ? `${e} ${label}` : label;
}
