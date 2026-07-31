/**
 * PROVIDER CREDENTIAL CUTOVER — import-safe dispatch (owner-only, Vercel-runtime). NO `server-only` import so it is
 * unit-testable without HTTP. ALL authorization, runtime readiness, bounds, exact-phrase, execution and post-run
 * invariants live here; the thin route resolves the session actor + same-origin and calls one of these.
 *
 * Runs the EXISTING bounded inventory/cutover (`providerCredentialInventory`, `backfillProviderCredentials`) which
 * reuses the shared per-account advisory lock + one-transaction cutover. Emits COUNTS ONLY — never a token,
 * ciphertext, key, account id, page/tenant identity, email or PII. The raw resume cursor (an account id) is never
 * returned; when more work remains an opaque HMAC-signed resume token is returned instead.
 */
import { createHash } from "node:crypto";
import {
  requirePlatformCapability, isPlatformForbidden, requireRecentAuth, PlatformAdminError, platformAudit,
  providerCredentialInventory, backfillProviderCredentials, verifyBackfillRun, assertNoMutation,
  evaluateProviderCredentialRuntimeCutoverReadiness, checkProviderCredentialCutoverDbReadiness,
  type ProviderCredentialInventory, type BackfillResult,
  type CutoverReadinessReason, type CutoverDbReason,
} from "@guardora/db";
import { SharedRateLimiter, createRateLimitStore, signEnvelope } from "@guardora/core";

export interface CutoverActor { userId: string; authenticatedAt: Date | null }

export type CutoverErrorCode =
  | "unauthenticated" | "forbidden" | "reauth_required" | "runtime_not_ready" | "sha_mismatch"
  | "confirmation_invalid" | "acknowledgement_required" | "dry_run_failed" | "rate_limited"
  | "apply_verification_failed" | "invalid_request";

/** The exact apply phrase — compared WITHOUT trimming. */
export const CUTOVER_APPLY_PHRASE = "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT";
// Bounded: batch size 25; ONE backfill batch per invocation (max-batches = 1) — a single `backfill…` call.
const BATCH_SIZE = 25;

export interface SafeReadiness {
  ready: boolean;
  envReasons: CutoverReadinessReason[];
  dbReasons: CutoverDbReason[];
  deploymentSha: string | null;
  hostFingerprint: string | null;
}
export interface SafeRunCounts {
  scanned: number; skippedNoToken: number; alreadyVaulted: number; backfilled: number;
  verified: number; legacyCleared: number; errors: number;
  /** "DONE" or "MORE" — the raw account-id cursor is NEVER exposed. */
  progress: "DONE" | "MORE";
  /** Opaque signed resume token, present only when progress === "MORE". */
  resumeToken?: string;
}
export interface CutoverResultBody {
  ok: boolean;
  mode: "dry-run" | "apply";
  error?: CutoverErrorCode;
  readiness: SafeReadiness;
  inventory?: ProviderCredentialInventory;
  run?: SafeRunCounts;
}
export interface CutoverDispatchResult { status: number; body: CutoverResultBody }

export interface CutoverOpts {
  /** Env used ONLY for readiness evaluation (real runtime → process.env). Vault/legacy crypto always use process.env. */
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** null skips the rate limiter (tests). Undefined → the module default. */
  rateLimiter?: SharedRateLimiter | null;
}

let _limiter: SharedRateLimiter | null = null;
function limiterFor(opts?: CutoverOpts): SharedRateLimiter | null {
  if (opts && "rateLimiter" in opts) return opts.rateLimiter ?? null;
  if (!_limiter) _limiter = new SharedRateLimiter(createRateLimitStore(process.env), { windowMs: 60_000, limit: 10, failClosed: true });
  return _limiter;
}

function resumeSecret(): string {
  // Server-only derived secret (never exposed). Bound to AUTH_SECRET; distinct namespace from other signers.
  return createHash("sha256").update(`provider-credential-cutover-resume:${process.env.AUTH_SECRET ?? ""}`).digest("hex");
}

/** Owner + recent-auth gate. Returns an error code, or null when authorized. */
async function ownerGate(actor: CutoverActor): Promise<CutoverErrorCode | null> {
  try { requireRecentAuth(actor.authenticatedAt); }
  catch (e) { if (e instanceof PlatformAdminError && e.code === "stale_privileged_auth") return "reauth_required"; return "forbidden"; }
  try { await requirePlatformCapability(actor.userId, "admin_users.manage"); } // OWNER-only
  catch (e) { if (isPlatformForbidden(e)) return "forbidden"; return "forbidden"; }
  return null;
}

async function readiness(opts?: CutoverOpts): Promise<SafeReadiness> {
  const env = opts?.env ?? process.env;
  const envR = evaluateProviderCredentialRuntimeCutoverReadiness(env);
  const dbR = await checkProviderCredentialCutoverDbReadiness(env);
  return {
    ready: envR.ready && dbR.ready,
    envReasons: envR.reasons,
    dbReasons: dbR.reasons,
    deploymentSha: envR.deploymentSha,
    hostFingerprint: dbR.hostFingerprint,
  };
}

function safeCounts(run: BackfillResult, opts?: CutoverOpts): SafeRunCounts {
  const progress: "DONE" | "MORE" = run.nextCursor ? "MORE" : "DONE";
  const base: SafeRunCounts = {
    scanned: run.scanned, skippedNoToken: run.skippedNoToken, alreadyVaulted: run.alreadyVaulted,
    backfilled: run.backfilled, verified: run.verified, legacyCleared: run.legacyCleared, errors: run.errors, progress,
  };
  if (run.nextCursor) {
    const env = opts?.env ?? process.env;
    const exp = (opts?.now ?? new Date()).getTime() + 15 * 60_000;
    // Opaque, HMAC-signed, bound to deployment SHA + mode + expiry + last account id (never exposed raw).
    base.resumeToken = signEnvelope({ sha: env.VERCEL_GIT_COMMIT_SHA ?? "", exp, last: run.nextCursor }, resumeSecret());
  }
  return base;
}

function counts(run: BackfillResult) { return { scanned: run.scanned, backfilled: run.backfilled, verified: run.verified, cleared: run.legacyCleared, errors: run.errors }; }

/** DRY-RUN: read-only inventory/classification. Success ONLY when errors===0 and nothing mutated. */
export async function runCutoverDryRun(actor: CutoverActor, opts?: CutoverOpts): Promise<CutoverDispatchResult> {
  const gate = await ownerGate(actor);
  if (gate) { await platformAudit(actor.userId, "provider_credential.cutover_rejected", { resultCode: gate, summary: "dry-run gate" }).catch(() => {}); return { status: gate === "reauth_required" ? 401 : 403, body: { ok: false, mode: "dry-run", error: gate, readiness: await readiness(opts) } }; }
  const rl = limiterFor(opts);
  if (rl && !(await rl.check(`cutover:${actor.userId}`)).allowed) return { status: 429, body: { ok: false, mode: "dry-run", error: "rate_limited", readiness: await readiness(opts) } };
  const rdy = await readiness(opts);
  if (!rdy.ready) return { status: 409, body: { ok: false, mode: "dry-run", error: "runtime_not_ready", readiness: rdy } };

  const before = await providerCredentialInventory();
  const run = await backfillProviderCredentials({ apply: false, batchSize: BATCH_SIZE });
  const after = await providerCredentialInventory();
  const ok = verifyBackfillRun(run, after).ok && assertNoMutation(before, after).ok && run.errors === 0;
  await platformAudit(actor.userId, "provider_credential.cutover_dry_run", { resultCode: ok ? "ok" : "failed", summary: JSON.stringify(counts(run)) }).catch(() => {});
  return { status: ok ? 200 : 422, body: { ok, mode: "dry-run", error: ok ? undefined : "dry_run_failed", readiness: rdy, inventory: after, run: safeCounts(run, opts) } };
}

/** APPLY: owner + readiness + exact phrase + acknowledgement + a fresh clean dry-run, then the bounded cutover. */
export async function runCutoverApply(actor: CutoverActor, body: { confirmation?: unknown; acknowledge?: unknown; expectedSha?: unknown }, opts?: CutoverOpts): Promise<CutoverDispatchResult> {
  const rdyEarly = await readiness(opts);
  const gate = await ownerGate(actor);
  if (gate) { await platformAudit(actor.userId, "provider_credential.cutover_rejected", { resultCode: gate, summary: "apply gate" }).catch(() => {}); return { status: gate === "reauth_required" ? 401 : 403, body: { ok: false, mode: "apply", error: gate, readiness: rdyEarly } }; }
  const rl = limiterFor(opts);
  if (rl && !(await rl.check(`cutover-apply:${actor.userId}`)).allowed) return { status: 429, body: { ok: false, mode: "apply", error: "rate_limited", readiness: rdyEarly } };
  const rdy = await readiness(opts);
  if (!rdy.ready) return { status: 409, body: { ok: false, mode: "apply", error: "runtime_not_ready", readiness: rdy } };

  // Exact deployment-SHA match (a stale page cannot apply against a newer deployment).
  const currentSha = (opts?.env ?? process.env).VERCEL_GIT_COMMIT_SHA ?? "";
  if (typeof body.expectedSha !== "string" || body.expectedSha !== currentSha) return { status: 409, body: { ok: false, mode: "apply", error: "sha_mismatch", readiness: rdy } };
  // Exact phrase (NO trim) + explicit acknowledgement.
  if (body.confirmation !== CUTOVER_APPLY_PHRASE) { await platformAudit(actor.userId, "provider_credential.cutover_rejected", { resultCode: "confirmation_invalid" }).catch(() => {}); return { status: 400, body: { ok: false, mode: "apply", error: "confirmation_invalid", readiness: rdy } }; }
  if (body.acknowledge !== true) return { status: 400, body: { ok: false, mode: "apply", error: "acknowledgement_required", readiness: rdy } };

  // A FRESH dry-run must be clean before any apply.
  const preBefore = await providerCredentialInventory();
  const dry = await backfillProviderCredentials({ apply: false, batchSize: BATCH_SIZE });
  const preAfter = await providerCredentialInventory();
  if (dry.errors > 0 || !verifyBackfillRun(dry, preAfter).ok || !assertNoMutation(preBefore, preAfter).ok) {
    await platformAudit(actor.userId, "provider_credential.cutover_rejected", { resultCode: "dry_run_failed", summary: JSON.stringify(counts(dry)) }).catch(() => {});
    return { status: 422, body: { ok: false, mode: "apply", error: "dry_run_failed", readiness: rdy, inventory: preAfter, run: safeCounts(dry, opts) } };
  }

  // Re-read inventory immediately before apply, then the bounded, locked, single-transaction cutover.
  const before = await providerCredentialInventory();
  const run = await backfillProviderCredentials({ apply: true, batchSize: BATCH_SIZE });
  const after = await providerCredentialInventory();

  const invariantsOk =
    run.errors === 0 &&
    run.legacyCleared === run.verified &&
    after.vaultOnlyUnusable === 0 &&
    after.legacyPopulated === before.legacyPopulated - run.legacyCleared &&
    after.totalMetaAccounts === before.totalMetaAccounts &&
    verifyBackfillRun(run, after).ok;
  await platformAudit(actor.userId, "provider_credential.cutover_applied", { resultCode: invariantsOk ? "ok" : "failed", summary: JSON.stringify(counts(run)) }).catch(() => {});
  return { status: invariantsOk ? 200 : 422, body: { ok: invariantsOk, mode: "apply", error: invariantsOk ? undefined : "apply_verification_failed", readiness: rdy, inventory: after, run: safeCounts(run, opts) } };
}

/** Read-only view for the admin page (readiness + inventory). Owner-gated by the caller. */
export async function loadCutoverView(opts?: CutoverOpts): Promise<{ readiness: SafeReadiness; inventory: ProviderCredentialInventory }> {
  return { readiness: await readiness(opts), inventory: await providerCredentialInventory() };
}
