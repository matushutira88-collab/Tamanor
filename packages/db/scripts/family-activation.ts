/**
 * FAMILY-BILLING ACTIVATION — PURE guard logic for the secure production-migration workflow and the
 * Family-billing readiness validator. NO database, network, filesystem, secrets or process.env side
 * effects live here: every function is a pure transformation of its inputs, so the whole safety
 * surface is deterministically unit-testable and the thin CLI/YAML wrappers only feed it real data.
 *
 * Nothing here ever prints a DATABASE_URL or a full Stripe Price ID — price ids are only ever surfaced
 * through {@link redactPriceId} (presence + last 4).
 */
import { createHash } from "node:crypto";
import { hostOf } from "./assert-local-db";
import {
  FAMILY_PRICE_ENV, familyStripePriceAvailability, FAMILY_PLAN_IDS, isFamilyPlanId,
  SELF_SERVE_PLANS, resolveStripePriceId,
} from "@guardora/core";

/** The single accepted production migration this workflow applies. */
export const EXPECTED_PRODUCTION_MIGRATION = "20260812090000_family_billing_baseline_reconcile";
/** The exact confirmation phrase an operator must type to arm the workflow. */
export const MIGRATION_CONFIRMATION_PHRASE = "APPLY_ACCEPTED_PRODUCTION_MIGRATIONS";
/** The only accepted `environment` input value. */
export const ACCEPTED_ENVIRONMENT = "production";
/** Conservative default ceiling on legacy family/free_trial tenants the reconcile may touch. */
export const DEFAULT_MAX_LEGACY_FAMILY_TENANTS = 100;

/** The six env-var NAMES (never values) that must exist to activate Family billing. */
export const FAMILY_PRICE_ENV_NAMES: readonly string[] = Object.values(FAMILY_PRICE_ENV).flatMap((e) => [e.monthly, e.yearly]);

/** Hosts that must be REFUSED as a production target (inverse of the local-dev guard). */
export const NON_PRODUCTION_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. workflow_dispatch input validation
// ─────────────────────────────────────────────────────────────────────────────
export type MigrationInputs = { environment?: string; expectedMigration?: string; confirmation?: string };

/** Validate the three arming inputs. All three must match EXACTLY (no trimming of the phrase). */
export function validateMigrationInputs(input: MigrationInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.environment !== ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${ACCEPTED_ENVIRONMENT}"`);
  if (input.expectedMigration !== EXPECTED_PRODUCTION_MIGRATION) errors.push(`expected_migration must be "${EXPECTED_PRODUCTION_MIGRATION}"`);
  if (input.confirmation !== MIGRATION_CONFIRMATION_PHRASE) errors.push("confirmation must exactly equal the required phrase");
  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. production database-target safety (never prints the URL)
// ─────────────────────────────────────────────────────────────────────────────
/** A non-sensitive, non-reversible fingerprint of the DB host (sha256 hex prefix). Never the URL. */
export function databaseHostFingerprint(url: string | undefined | null): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

export type ProductionTargetInput = { url?: string; environment?: string; expectedFingerprint?: string | null };

/**
 * Assert the target is a real production database, without ever exposing the URL: it must parse, must
 * NOT be localhost/loopback/docker-local (a single-label host is treated as docker-local), and — when
 * the operator supplied `PRODUCTION_DATABASE_HOST_FINGERPRINT` — its host fingerprint must match.
 */
export function assertProductionTarget(input: ProductionTargetInput): { ok: boolean; errors: string[]; fingerprint: string | null } {
  const errors: string[] = [];
  if (input.environment !== ACCEPTED_ENVIRONMENT) errors.push(`environment input must be "${ACCEPTED_ENVIRONMENT}"`);
  const host = hostOf(input.url);
  if (!input.url) errors.push("DATABASE_URL is missing");
  else if (host === null) errors.push("DATABASE_URL is unparseable");
  else if (NON_PRODUCTION_HOSTS.has(host) || !host.includes(".")) errors.push("target host looks local/non-production — refusing");
  const fingerprint = databaseHostFingerprint(input.url);
  if (input.expectedFingerprint) {
    if (fingerprint !== input.expectedFingerprint) errors.push("database host fingerprint mismatch");
  }
  return { ok: errors.length === 0, errors, fingerprint };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. pending-migration gating
// ─────────────────────────────────────────────────────────────────────────────
/** The expected migration must be pending, and it must be the ONLY pending migration. */
export function evaluatePendingMigrations(pending: string[], expected: string = EXPECTED_PRODUCTION_MIGRATION): { ok: boolean; reason?: string } {
  if (!pending.includes(expected)) return { ok: false, reason: `expected migration ${expected} is not pending` };
  const others = pending.filter((m) => m !== expected);
  if (others.length > 0) return { ok: false, reason: `unexpected pending migration(s): ${others.join(", ")}` };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. legacy-count ceiling
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateLegacyCeiling(count: number, ceiling: number = DEFAULT_MAX_LEGACY_FAMILY_TENANTS): { ok: boolean; reason?: string } {
  if (!Number.isFinite(count) || count < 0) return { ok: false, reason: "legacy family count is not a valid number" };
  if (count > ceiling) return { ok: false, reason: `legacy family/free_trial count ${count} exceeds operator ceiling ${ceiling}` };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. pre/post preservation comparison (counts are non-sensitive)
// ─────────────────────────────────────────────────────────────────────────────
export type TenantCounts = {
  familyFreeTrial: number;
  familyFree: number; familyBasic: number; familyPlus: number; familyPremium: number;
  businessByPlan: Record<string, number>;
  protectedProfiles: number; guardianRelationships: number; familyInvitations: number;
  familyMemberships: number; safetySignals: number; subscriptions: number; stripeCustomerMappings: number;
};

/**
 * Prove the reconcile preserved everything it must: zero family/free_trial remain, the reconciled rows
 * moved into family_free (family_free grew by exactly the pre free_trial count), paid Family tiers and
 * every Business plan are unchanged, and no Family domain-data / subscription / Stripe-mapping count
 * changed. Any mismatch fails the job.
 */
export function comparePreservation(pre: TenantCounts, post: TenantCounts): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (post.familyFreeTrial !== 0) failures.push(`family/free_trial not zero after migration (${post.familyFreeTrial})`);
  if (post.familyFree !== pre.familyFree + pre.familyFreeTrial) failures.push(`family_free did not grow by the reconciled free_trial count (pre ${pre.familyFree}+${pre.familyFreeTrial} → post ${post.familyFree})`);
  if (post.familyBasic !== pre.familyBasic) failures.push("family_basic count changed");
  if (post.familyPlus !== pre.familyPlus) failures.push("family_plus count changed");
  if (post.familyPremium !== pre.familyPremium) failures.push("family_premium count changed");
  for (const plan of new Set([...Object.keys(pre.businessByPlan), ...Object.keys(post.businessByPlan)])) {
    if ((pre.businessByPlan[plan] ?? 0) !== (post.businessByPlan[plan] ?? 0)) failures.push(`business plan "${plan}" count changed`);
  }
  const domain: (keyof TenantCounts)[] = ["protectedProfiles", "guardianRelationships", "familyInvitations", "familyMemberships", "safetySignals", "subscriptions", "stripeCustomerMappings"];
  for (const k of domain) if (pre[k] !== post[k]) failures.push(`${String(k)} count changed (${String(pre[k])} → ${String(post[k])})`);
  return { ok: failures.length === 0, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Stripe price redaction + Family price configuration validation
// ─────────────────────────────────────────────────────────────────────────────
/** NEVER print a full Stripe Price ID — only presence + last 4 chars. */
export function redactPriceId(id: string | undefined | null): string {
  const t = (id ?? "").trim();
  if (t === "") return "absent";
  return `present(…${t.slice(-4)})`;
}

export type FamilyPriceReadiness = {
  allPresent: boolean;
  formatOk: boolean;
  duplicates: boolean;
  businessCollision: boolean;
  /** Redacted per-variable status (presence + last 4 only) — safe to print/log. */
  perKey: Record<string, string>;
};

/**
 * Validate the six Family Stripe price env vars: all present, strict `price_…` shape, no duplicate ids
 * among the six, and no collision with a configured Business price id (when those vars are available).
 * Reuses the core availability+duplicate detector. Emits only redacted per-key status.
 */
export function validateFamilyPriceConfig(env: Record<string, string | undefined> = process.env): FamilyPriceReadiness {
  const { duplicatePriceIds } = familyStripePriceAvailability(env);
  const familyIds = FAMILY_PRICE_ENV_NAMES.map((n) => env[n]?.trim()).filter((v): v is string => !!v);
  const allPresent = FAMILY_PRICE_ENV_NAMES.every((n) => (env[n]?.trim() ?? "") !== "");
  const formatOk = familyIds.length > 0 && familyIds.every((id) => /^price_[A-Za-z0-9]+$/.test(id));
  const businessIds = new Set<string>();
  for (const plan of SELF_SERVE_PLANS) for (const interval of ["monthly", "yearly"] as const) {
    const id = resolveStripePriceId(plan, interval, env);
    if (id) businessIds.add(id);
  }
  const businessCollision = familyIds.some((id) => businessIds.has(id));
  const perKey: Record<string, string> = {};
  for (const n of FAMILY_PRICE_ENV_NAMES) perKey[n] = redactPriceId(env[n]);
  return { allPresent, formatOk, duplicates: duplicatePriceIds, businessCollision, perKey };
}

/** Whether a persisted Family tenant plan string is one of the four expected Family plans. */
export function isExpectedFamilyPlan(plan: string): boolean {
  return isFamilyPlanId(plan);
}
export const EXPECTED_FAMILY_PLANS: readonly string[] = FAMILY_PLAN_IDS;

// ─────────────────────────────────────────────────────────────────────────────
// 7. readiness modes
// ─────────────────────────────────────────────────────────────────────────────
export type ReadinessMode = "preflight" | "activation" | "post-activation";
export const READINESS_MODES: readonly ReadinessMode[] = ["preflight", "activation", "post-activation"];

export type ReadinessFacts = {
  flagEnabled: boolean;
  migrationApplied: boolean;
  familyTrialConsumedColumnExists: boolean;
  zeroFamilyFreeTrial: boolean;
  onlyExpectedFamilyPlans: boolean;
  noFamilyOnBusinessPlan: boolean;
  price: FamilyPriceReadiness;
};

/** Whether the DB half of the prerequisites are complete. */
export function databasePrerequisitesReady(f: ReadinessFacts): boolean {
  return f.migrationApplied && f.familyTrialConsumedColumnExists && f.zeroFamilyFreeTrial && f.onlyExpectedFamilyPlans && f.noFamilyOnBusinessPlan;
}
/** Whether the six Family Stripe prices are completely and validly configured. */
export function priceConfigReady(p: FamilyPriceReadiness): boolean {
  return p.allPresent && p.formatOk && !p.duplicates && !p.businessCollision;
}

/**
 * Evaluate activation readiness for a mode:
 *   preflight       — FAMILY_BILLING_ENABLED must be OFF (DB/price status is reported, not required).
 *   activation      — migration complete AND all six Family prices valid (flag may still be OFF).
 *   post-activation — flag ON AND all DB + price prerequisites valid.
 */
export function evaluateReadiness(mode: ReadinessMode, f: ReadinessFacts): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const dbReady = databasePrerequisitesReady(f);
  const priceReady = priceConfigReady(f.price);
  if (mode === "preflight") {
    if (f.flagEnabled) failures.push("preflight expects FAMILY_BILLING_ENABLED to be OFF");
  } else if (mode === "activation") {
    if (!dbReady) failures.push("database prerequisites incomplete (migration / familyTrialConsumedAt / no family free_trial / plan set)");
    if (!priceReady) failures.push("Family Stripe price configuration incomplete or invalid (need six valid, unique, non-colliding price ids)");
  } else {
    if (!f.flagEnabled) failures.push("post-activation expects FAMILY_BILLING_ENABLED to be ON");
    if (!dbReady) failures.push("database prerequisites incomplete");
    if (!priceReady) failures.push("Family Stripe price configuration incomplete or invalid");
  }
  return { ok: failures.length === 0, failures };
}
