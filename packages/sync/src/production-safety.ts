import { prisma } from "@guardora/db";
import { getProductionSafetyConfig } from "@guardora/config";
import { NEVER_AUTONOMOUS } from "@guardora/ai";

/**
 * V1.27 Production Safe Mode — the safety envelope for REAL live actions.
 *
 * This layers on top of the ControlPolicy gate: kill switches, per-brand live
 * settings, rate limits, first-time-category approval, crisis lock and a hard
 * safety floor. Fail-closed everywhere. Customer-voice categories are NEVER live
 * hidden. Nothing here logs tokens.
 */

/** Categories eligible for AUTONOMOUS live hide under Production Safe Mode.
 * brand_impersonation is eligible but stays behind the crisis lock by default. */
export const LIVE_SAFETY_AUTONOMOUS_ELIGIBLE: Set<string> = new Set([
  "scam", "phishing", "spam", "hate_speech", "racism", "terrorism_extremism",
  "personal_attack", "profanity", "threat", "brand_impersonation",
]);

/** Categories that trip the crisis lock (never autonomous while crisis lock is on). */
export const CRISIS_CATEGORIES: Set<string> = new Set([
  "crisis_keyword", "coordinated_attack", "brand_impersonation",
]);

export interface BrandSafetySettings {
  liveModeEnabled: boolean;
  autonomousHideEnabled: boolean;
  approvalRequiredAboveDailyLimit: boolean;
  dailyAutoHideLimit: number;
  hourlyAutoHideLimit: number;
  perCategoryDailyLimit: number;
  maxConsecutiveWithoutReview: number;
  minConfidenceForAutoHide: number;
  requireDryRunBeforeFirstLive: boolean;
  requireHumanApprovalForNewCategory: boolean;
  rollbackRequiredBeforeAutonomy: boolean;
  crisisLockEnabled: boolean;
  approvedAutoHideCategories: string[];
}

/** Fail-closed defaults when a brand has no explicit safety row. */
export const DEFAULT_SAFETY_SETTINGS: BrandSafetySettings = {
  liveModeEnabled: false,
  autonomousHideEnabled: false,
  approvalRequiredAboveDailyLimit: true,
  dailyAutoHideLimit: 10,
  hourlyAutoHideLimit: 3,
  perCategoryDailyLimit: 5,
  maxConsecutiveWithoutReview: 5,
  minConfidenceForAutoHide: 0.85,
  requireDryRunBeforeFirstLive: true,
  requireHumanApprovalForNewCategory: true,
  rollbackRequiredBeforeAutonomy: true,
  crisisLockEnabled: true,
  approvedAutoHideCategories: [],
};

export interface SafetyCounts {
  dayCount: number;
  hourCount: number;
  categoryDayCount: number;
  consecutiveWithoutReview: number;
}

export interface ProductionSafetyContext {
  flags: { productionSafeMode: boolean; globalKillSwitch: boolean };
  brandKillSwitch: boolean;
  accountKillSwitch: boolean;
  settings: BrandSafetySettings;
  counts: SafetyCounts;
  categoryApprovedBefore: boolean;
  rollbackAvailable: boolean;
}

export type SafetyOutcome = "allow" | "downgrade" | "blocked";

export interface SafetyEvaluation {
  outcome: SafetyOutcome;
  reason: string;
  auditEvent: string;
}

/**
 * Pure decision: given a fully-materialised safety context, decide whether a live
 * hide may proceed. Kill switches + the hard safety floor block BOTH manual and
 * autonomous triggers. All per-brand limits / autonomy gates apply only to the
 * autonomous trigger (a human approval is the review for the manual path).
 */
export function evaluateProductionSafety(input: {
  trigger: "approval" | "autonomous";
  category: string;
  confidence: number;
  riskLevel: string;
  safety: ProductionSafetyContext;
}): SafetyEvaluation {
  const { trigger, category, confidence, riskLevel, safety: s } = input;

  // 1) Kill switches — immediate stop for any live action.
  if (s.flags.globalKillSwitch) return block("global_kill_switch", "kill_switch.blocked");
  if (s.brandKillSwitch) return block("brand_kill_switch", "kill_switch.blocked");
  if (s.accountKillSwitch) return block("account_kill_switch", "kill_switch.blocked");

  // 2) Hard safety floor — customer voice is never live hidden, ever.
  if (NEVER_AUTONOMOUS.has(category as never)) return block("safety_never_live", "safety_floor.blocked");

  if (trigger === "autonomous") {
    if (!s.settings.liveModeEnabled) return downgrade("live_mode_disabled", "autonomous_hide.blocked");
    if (!s.settings.autonomousHideEnabled) return downgrade("autonomous_disabled", "autonomous_hide.blocked");
    if (!LIVE_SAFETY_AUTONOMOUS_ELIGIBLE.has(category)) return downgrade("category_not_eligible", "autonomous_hide.blocked");
    if (category === "threat" && riskLevel !== "high" && riskLevel !== "critical") return downgrade("threat_requires_high", "autonomous_hide.blocked");
    if (s.settings.crisisLockEnabled && CRISIS_CATEGORIES.has(category)) return downgrade("crisis_lock", "autonomous_hide.blocked");
    if (confidence < s.settings.minConfidenceForAutoHide) return downgrade("below_min_confidence", "autonomous_hide.blocked");
    if (s.settings.requireHumanApprovalForNewCategory && !s.categoryApprovedBefore) return downgrade("new_category_requires_approval", "autonomous_hide.blocked");
    if (s.settings.rollbackRequiredBeforeAutonomy && !s.rollbackAvailable) return downgrade("rollback_required", "autonomous_hide.blocked");
    if (s.counts.hourCount >= s.settings.hourlyAutoHideLimit) return downgrade("hourly_limit", "rate_limit.triggered");
    if (s.counts.dayCount >= s.settings.dailyAutoHideLimit) return downgrade("daily_limit", "rate_limit.triggered");
    if (s.counts.categoryDayCount >= s.settings.perCategoryDailyLimit) return downgrade("category_daily_limit", "rate_limit.triggered");
    if (s.counts.consecutiveWithoutReview >= s.settings.maxConsecutiveWithoutReview) return downgrade("consecutive_review_needed", "rate_limit.triggered");
  }

  return { outcome: "allow", reason: "safety_ok", auditEvent: "autonomous_hide.allowed" };
}

function block(reason: string, auditEvent: string): SafetyEvaluation {
  return { outcome: "blocked", reason, auditEvent };
}
function downgrade(reason: string, auditEvent: string): SafetyEvaluation {
  return { outcome: "downgrade", reason, auditEvent };
}

/** Normalise a persisted safety row (or null) into a complete settings object. */
export function resolveSafetySettings(row: Partial<BrandSafetySettings> | null | undefined): BrandSafetySettings {
  if (!row) return { ...DEFAULT_SAFETY_SETTINGS };
  return { ...DEFAULT_SAFETY_SETTINGS, ...row, approvedAutoHideCategories: row.approvedAutoHideCategories ?? [] };
}

/** Live rollback (unhide) is implemented (see connectors.unhideComment) → available. */
export const ROLLBACK_AVAILABLE = true;

/**
 * Materialise the full safety context from the DB for one brand/account/category.
 * Counts only REAL autonomous executed hides, within rolling day/hour windows.
 */
export async function loadProductionSafetyContext(input: {
  tenantId: string;
  brandId: string;
  connectedAccountId: string;
  category: string;
  now?: Date;
}): Promise<ProductionSafetyContext> {
  const now = input.now ?? new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);

  const [brand, account, settingsRow, lastReview] = await Promise.all([
    prisma.brand.findFirst({ where: { id: input.brandId }, select: { killSwitch: true } }),
    prisma.connectedAccount.findFirst({ where: { id: input.connectedAccountId }, select: { killSwitch: true } }),
    prisma.brandLiveSafetySettings.findFirst({ where: { brandId: input.brandId } }),
    prisma.brandRiskFeedback.findFirst({ where: { brandId: input.brandId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const base = { brandId: input.brandId, status: "executed", trigger: "autonomous" } as const;
  const [dayCount, hourCount, categoryDayCount, consecutiveWithoutReview] = await Promise.all([
    prisma.platformActionExecution.count({ where: { ...base, executedAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...base, executedAt: { gte: hourStart } } }),
    prisma.platformActionExecution.count({ where: { ...base, policyCategory: input.category, executedAt: { gte: dayStart } } }),
    prisma.platformActionExecution.count({ where: { ...base, ...(lastReview ? { executedAt: { gt: lastReview.createdAt } } : {}) } }),
  ]);

  const settings = resolveSafetySettings(settingsRow);
  return {
    flags: getProductionSafetyConfig(),
    brandKillSwitch: brand?.killSwitch ?? false,
    accountKillSwitch: account?.killSwitch ?? false,
    settings,
    counts: { dayCount, hourCount, categoryDayCount, consecutiveWithoutReview },
    categoryApprovedBefore: settings.approvedAutoHideCategories.includes(input.category),
    rollbackAvailable: ROLLBACK_AVAILABLE,
  };
}
