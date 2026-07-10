/**
 * V1.30 Actor Risk — deterministic, behavior-based risk scoring for profiles seen
 * in comments on CONNECTED accounts only. No ML, no scraping, no identity inference.
 *
 * Safety: this is an observed-behavior score, NOT a claim that a profile is a bot,
 * scammer, fake account or attacker. The customer-voice floor (normal criticism,
 * questions, complaints, positive feedback) never makes an actor risky on its own.
 */
import { sentimentBucket } from "./reputation";

export interface ActorComment {
  categories: string[];
  riskLevel: string;
  sentiment: string;
  postId: string | null;
  text: string;
  /** True only if this comment was actually hidden (DB truth: live_hide_executed/already_hidden). */
  hidden: boolean;
}

export interface ActorSignals {
  totalComments: number;
  riskyComments: number;
  scamPhishing: number;
  postsAppeared: number;
  repeatedPhrase: boolean;
  profanityAttackHate: number;
  hiddenForPublic: number;
  highCritical: number;
  inIncident: boolean;
}

const HARMFUL_ABUSE = ["profanity", "personal_attack", "hate_speech", "racism", "threat", "violence", "terrorism_extremism", "sexual_vulgarity"];

/** Aggregate an actor's comments into behavior signals. Pure + testable. */
export function buildActorSignals(comments: ActorComment[], inIncident = false): ActorSignals {
  let riskyComments = 0, scamPhishing = 0, profanityAttackHate = 0, highCritical = 0, hiddenForPublic = 0;
  const posts = new Set<string>();
  const norms: string[] = [];
  const urls: string[] = [];
  for (const c of comments) {
    const b = sentimentBucket({ categories: c.categories, sentiment: c.sentiment, riskLevel: c.riskLevel });
    const risky = b === "risky";
    if (risky) riskyComments++;
    if (c.categories.some((x) => x === "scam" || x === "phishing")) scamPhishing++;
    if (c.categories.some((x) => HARMFUL_ABUSE.includes(x))) profanityAttackHate++;
    // High/critical only counts for genuinely risky content — a customer-voice
    // comment (criticism, complaint) tagged high/critical must not raise actor risk.
    if (risky && (c.riskLevel === "high" || c.riskLevel === "critical")) highCritical++;
    if (c.hidden) hiddenForPublic++;
    if (c.postId) posts.add(c.postId);
    const norm = (c.text ?? "").trim().toLowerCase();
    if (norm) norms.push(norm);
    for (const u of (c.text ?? "").match(/https?:\/\/\S+/gi) ?? []) urls.push(u.toLowerCase());
  }
  const repeatedPhrase = (norms.length > 1 && new Set(norms).size < norms.length) || (urls.length > 1 && new Set(urls).size < urls.length);
  return { totalComments: comments.length, riskyComments, scamPhishing, postsAppeared: posts.size, repeatedPhrase, profanityAttackHate, hiddenForPublic, highCritical, inIncident };
}

/** Behavior-based risk score, 0–100, clamped. Customer-voice contributes nothing. */
export function actorRiskScore(s: ActorSignals): number {
  let score = 0;
  if (s.riskyComments >= 2) score += 20;
  if (s.scamPhishing >= 1) score += 20;
  if (s.postsAppeared >= 2) score += 15;
  if (s.repeatedPhrase) score += 15;
  if (s.profanityAttackHate >= 1) score += 10;
  if (s.hiddenForPublic >= 1) score += 10;
  if (s.highCritical >= 1) score += 10;
  if (s.inIncident) score += 10;
  return Math.min(100, score);
}

export type ActorRiskLevel = "low" | "medium" | "high" | "critical";

export function actorRiskLevel(score: number): ActorRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/** Reason KEYS (mapped to localized labels in the UI). */
export function actorRiskReasons(s: ActorSignals): string[] {
  const r: string[] = [];
  if (s.riskyComments >= 2) r.push("repeatedRisky");
  if (s.scamPhishing >= 1) r.push("scamLink");
  if (s.postsAppeared >= 2) r.push("multiPost");
  if (s.repeatedPhrase) r.push("repeatedPhrase");
  if (s.profanityAttackHate >= 1) r.push("profanity");
  if (s.hiddenForPublic >= 1) r.push("hidden");
  if (s.highCritical >= 1) r.push("highRisk");
  if (s.inIncident) r.push("incident");
  return r;
}

export const ACTOR_REASON_KEYS = ["repeatedRisky", "scamLink", "multiPost", "repeatedPhrase", "profanity", "hidden", "highRisk", "incident"] as const;
