/**
 * V1.29 Reputation Analytics — deterministic classification helpers (no ML).
 *
 * State-truth aware: customer-voice categories (normal criticism, refund/legal/
 * safety complaints, questions) are NEVER "risky" — legitimate negative feedback is
 * kept separate from harmful content. Risky = spam/scam/phishing/hate/threat/etc.
 */

/** Harmful categories → the "risky" sentiment bucket. */
export const RISKY_CATEGORIES: Set<string> = new Set([
  "spam", "scam", "phishing", "hate_speech", "racism", "threat", "violence",
  "terrorism_extremism", "sexual_vulgarity", "profanity", "personal_attack",
  "brand_impersonation", "coordinated_attack", "crisis_keyword",
]);

/** Customer-voice categories that are legitimate negative feedback — never harmful. */
export const LEGIT_NEGATIVE_CATEGORIES: Set<string> = new Set([
  "refund_complaint", "legal_complaint", "safety_claim", "complaint",
  "customer_complaint", "delivery_issue", "quality_issue", "pricing_issue", "support_issue",
]);

export type SentimentBucket = "positive" | "neutral" | "negative" | "risky";

/**
 * Bucket a comment for the reputation view. Customer-voice floor first (never
 * risky), then harmful categories / high-critical risk → risky, else stored sentiment.
 */
export function sentimentBucket(input: { categories: string[]; sentiment: string; riskLevel: string }): SentimentBucket {
  const cats = input.categories ?? [];
  const has = (s: string) => cats.includes(s);

  // 1) Customer-voice floor — legitimate, never harmful.
  if (has("positive_feedback")) return "positive";
  if (has("customer_question")) return "neutral";
  if (has("normal_criticism")) return input.sentiment === "positive" ? "positive" : input.sentiment === "negative" ? "negative" : "neutral";
  if (cats.some((c) => LEGIT_NEGATIVE_CATEGORIES.has(c))) return "negative";

  // 2) Harmful content → risky.
  if (cats.some((c) => RISKY_CATEGORIES.has(c))) return "risky";
  if (input.riskLevel === "high" || input.riskLevel === "critical") return "risky";

  // 3) Fall back to the stored sentiment.
  if (input.sentiment === "positive") return "positive";
  if (input.sentiment === "negative") return "negative";
  return "neutral";
}

export type ReputationTopic =
  | "price" | "delivery" | "quality" | "complaint" | "support" | "scam"
  | "profanity" | "spam" | "competition" | "satisfaction" | "uncategorized";

export const REPUTATION_TOPICS: ReputationTopic[] = [
  "price", "delivery", "quality", "complaint", "support", "scam",
  "profanity", "spam", "competition", "satisfaction", "uncategorized",
];

const TOPIC_KEYWORDS: { topic: ReputationTopic; terms: string[] }[] = [
  { topic: "price", terms: ["cena", "cenu", "drah", "lacn", "price", "expensive", "cheap", "preis", "teuer", "€", "eur", "peniaz", "money"] },
  { topic: "delivery", terms: ["doruč", "dodac", "dodáv", "zásiel", "zasiel", "pošt", "posta", "kuriér", "kurier", "delivery", "shipping", "ship", "lieferung", "versand"] },
  { topic: "quality", terms: ["kvalit", "pokazen", "vadn", "chybn", "rozbit", "quality", "broken", "defect", "faulty", "qualität", "kaputt"] },
  { topic: "complaint", terms: ["reklamác", "reklamac", "vrátenie", "vratenie", "refund", "complaint", "reklamation", "rückgabe", "sťažnosť", "staznost"] },
  { topic: "support", terms: ["podpor", "pomoc", "zákaznick", "zakaznick", "support", "help", "service", "servis", "hilfe", "kundendienst"] },
  { topic: "competition", terms: ["konkuren", "lepšie inde", "lepsie inde", "competitor", "competition", "konkurrenz", "besser bei"] },
  { topic: "satisfaction", terms: ["ďakuj", "dakuj", "spokoj", "super", "skvel", "výborn", "vyborn", "odporúč", "odporuc", "thanks", "great", "recommend", "danke", "empfehl"] },
];

/** Map a comment to a topic — category first, then keyword mapping, else uncategorized. */
export function topicOf(categories: string[], text: string): ReputationTopic {
  const cats = categories ?? [];
  if (cats.includes("scam") || cats.includes("phishing")) return "scam";
  if (cats.includes("spam")) return "spam";
  if (cats.includes("profanity") || cats.includes("personal_attack") || cats.includes("hate_speech") || cats.includes("racism")) return "profanity";
  if (cats.includes("competitor_promo")) return "competition";
  if (cats.includes("refund_complaint")) return "complaint";
  if (cats.includes("positive_feedback")) return "satisfaction";

  const lc = (text ?? "").toLowerCase();
  for (const { topic, terms } of TOPIC_KEYWORDS) {
    if (terms.some((w) => lc.includes(w))) return topic;
  }
  return "uncategorized";
}
