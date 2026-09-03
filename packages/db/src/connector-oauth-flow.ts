/**
 * M7 — the durable, provider-neutral OAuth authorization transaction.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RLS EXCEPTION, AND WHY IT IS NARROW.
 *
 * A provider callback arrives carrying only `code` and `state`. There is no cookie
 * and no bearer, so the tenant is not yet known — which means the FIRST lookup
 * cannot run through the tenant-scoped client. Exactly one function here uses
 * `systemDb` for that: {@link consumeConnectorOAuthState}. It may match ONLY by
 * `stateHash`, it atomically consumes in the same statement, and it returns a
 * bounded actor context. It takes no tenantId, so it cannot be pointed at another
 * tenant's data, and it is not a general escape hatch.
 *
 * Every other function in this module is tenant-scoped through `withTenantDb`, so
 * once the callback has resolved a tenant, normal RLS applies again.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IS NEVER STORED: a bearer, a session token, a provider authorization code,
 * a provider access or refresh token, a client secret. Only `sha256(oauthState)`,
 * the same hash-at-rest discipline as `UserSession` and `PasswordResetToken`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { systemDb } from "./index";
import { withTenantDb } from "./tenant-db";

/** Bounded surfaces. Web may adopt this table later without a schema change. */
export const OAUTH_FLOW_SURFACES = ["web", "mobile"] as const;
export type OAuthFlowSurface = (typeof OAUTH_FLOW_SURFACES)[number];

/** Bounded providers — the two connectors that exist in this product. */
export const OAUTH_FLOW_PROVIDERS = ["meta", "google_business"] as const;
export type OAuthFlowProvider = (typeof OAUTH_FLOW_PROVIDERS)[number];

export const OAUTH_FLOW_INTENTS = ["connect", "reconnect"] as const;
export type OAuthFlowIntent = (typeof OAUTH_FLOW_INTENTS)[number];

/**
 * Bounded lifecycle.
 *
 * `selection_required` is a first-class state, not a failure: a Meta authorization
 * that discovered Pages, or a Google grant that discovered locations, is genuinely
 * authorized but is NOT yet a connected account. Collapsing it into `completed`
 * would claim a connection that does not exist.
 */
export const OAUTH_FLOW_STATUSES = [
  "pending", "provider_pending", "selection_required",
  "completed", "failed", "cancelled", "expired",
] as const;
export type OAuthFlowStatus = (typeof OAUTH_FLOW_STATUSES)[number];

/** The lifetime of an authorization. Long enough for a real login + MFA + consent. */
export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** Terminal states. A flow in one of these accepts no further provider result. */
const TERMINAL: readonly OAuthFlowStatus[] = ["completed", "failed", "cancelled", "expired"];
export function isTerminalFlowStatus(status: string): boolean {
  return (TERMINAL as readonly string[]).includes(status);
}

/**
 * A fresh OAuth `state`.
 *
 * 32 cryptographically random bytes, base64url — the same entropy and encoding the
 * session tokens use. The RAW value goes to the provider (that is what OAuth state
 * is for) and is never persisted.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** `sha256(state)`, hex. The only form that is ever written to the database. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two state values, for callers that hold both.
 * Length is compared first because `timingSafeEqual` throws on a length mismatch.
 */
export function statesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface ConnectorOAuthFlowRecord {
  id: string;
  userId: string;
  tenantId: string;
  sessionId: string;
  surface: string;
  provider: string;
  intent: string;
  brandId: string | null;
  accountId: string | null;
  status: string;
  resultCode: string | null;
  resultAccountId: string | null;
  resultRefId: string | null;
  createdAt: Date;
  expiresAt: Date;
  stateConsumedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateConnectorOAuthFlowInput {
  userId: string;
  tenantId: string;
  sessionId: string;
  surface: OAuthFlowSurface;
  provider: OAuthFlowProvider;
  intent: OAuthFlowIntent;
  brandId?: string | null;
  accountId?: string | null;
  /** `sha256(state)`. The caller keeps the raw state and never passes it here. */
  stateHash: string;
  expiresAt: Date;
}

/**
 * Create a flow. Tenant-scoped, so a flow can only ever be created inside the
 * tenant the validated session resolved to.
 */
export async function createConnectorOAuthFlow(
  input: CreateConnectorOAuthFlowInput,
): Promise<{ id: string }> {
  return withTenantDb(input.tenantId, (db) =>
    db.connectorOAuthFlow.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        surface: input.surface,
        provider: input.provider,
        intent: input.intent,
        brandId: input.brandId ?? null,
        accountId: input.accountId ?? null,
        stateHash: input.stateHash,
        expiresAt: input.expiresAt,
        status: "pending",
      },
      select: { id: true },
    }),
  );
}

/** Why a state consume was refused. Every reason is bounded and non-revealing. */
export type ConsumeStateFailure =
  | "not_found"      // no row, a forged state, or a state from another deployment
  | "already_used"   // replay — the row exists but was consumed
  | "expired"
  | "terminal";      // the flow was cancelled/failed/completed before the callback landed

export type ConsumeStateResult =
  | { ok: true; flow: ConnectorOAuthFlowRecord }
  /** `flowId` is present whenever the row exists, so a rejection can still deep-link home. */
  | { ok: false; reason: ConsumeStateFailure; flowId: string | null; tenantId: string | null };

/**
 * ATOMICALLY consume an OAuth state and return its flow.
 *
 * ── THE ONE SYSTEM-ROLE LOOKUP IN THIS MODULE ──
 * The provider callback has no tenant context yet, so this runs on `systemDb`. It
 * is deliberately the narrowest possible shape: it accepts a state hash and a
 * clock and nothing else, so there is no parameter through which a caller could
 * reach a different tenant's rows. It never returns a credential.
 *
 * The consume is a single guarded `updateMany` — `stateConsumedAt IS NULL AND
 * expiresAt > now AND status NOT IN (terminal)` — so there is no read-then-write
 * window. Exactly one concurrent caller can see `count === 1`; every replay,
 * every late callback and every duplicate provider delivery sees `0` and is
 * rejected. The reason is then classified from a fresh read, purely for a bounded
 * error code — the authorization decision was already made by the guarded write.
 */
export async function consumeConnectorOAuthState(
  stateHash: string,
  now: Date = new Date(),
): Promise<ConsumeStateResult> {
  const guarded = await systemDb.connectorOAuthFlow.updateMany({
    where: {
      stateHash,
      stateConsumedAt: null,
      expiresAt: { gt: now },
      status: { notIn: [...TERMINAL] },
    },
    data: { stateConsumedAt: now, status: "provider_pending" },
  });

  if (guarded.count === 1) {
    const flow = await systemDb.connectorOAuthFlow.findUnique({ where: { stateHash } });
    // Cannot realistically be null after a successful guarded update, but a
    // missing row must fail closed rather than throw into the callback.
    return flow ? { ok: true, flow } : { ok: false, reason: "not_found", flowId: null, tenantId: null };
  }

  // Classify for a bounded code only. A forged state and a state for another
  // deployment are indistinguishable here by design.
  const existing = await systemDb.connectorOAuthFlow.findUnique({
    where: { stateHash },
    select: { id: true, tenantId: true, stateConsumedAt: true, expiresAt: true, status: true },
  });
  if (!existing) return { ok: false, reason: "not_found", flowId: null, tenantId: null };
  const ref = { flowId: existing.id, tenantId: existing.tenantId };
  if (existing.stateConsumedAt) return { ok: false, reason: "already_used", ...ref };
  if (isTerminalFlowStatus(existing.status)) return { ok: false, reason: "terminal", ...ref };
  return { ok: false, reason: "expired", ...ref };
}

/**
 * Whether the UserSession that started a flow is still usable.
 *
 * Checked at the callback, where no bearer is available: the raw token is not
 * stored (deliberately), so the strongest available test is that the session row
 * still exists, is not revoked, and has not passed either expiry. A logout revokes
 * the row, so a flow whose user logged out mid-authorization fails closed.
 */
export async function originatingSessionIsValid(
  sessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await systemDb.userSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true, absoluteExpiresAt: true },
  });
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  if (row.absoluteExpiresAt && row.absoluteExpiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Read one flow, tenant-scoped and owner-qualified.
 *
 * A flow belonging to another user — even inside the same tenant — reads back as
 * null, so the status endpoint answers `not_found` rather than confirming that
 * someone else's authorization exists.
 */
export async function readConnectorOAuthFlow(input: {
  tenantId: string;
  userId: string;
  flowId: string;
}): Promise<ConnectorOAuthFlowRecord | null> {
  return withTenantDb(input.tenantId, (db) =>
    db.connectorOAuthFlow.findFirst({
      where: { id: input.flowId, tenantId: input.tenantId, userId: input.userId },
    }),
  );
}

/** Update a flow's outcome. Tenant-scoped; used after the tenant is known. */
export async function updateConnectorOAuthFlow(input: {
  tenantId: string;
  flowId: string;
  status: OAuthFlowStatus;
  resultCode?: string | null;
  resultAccountId?: string | null;
  resultRefId?: string | null;
  completedAt?: Date | null;
}): Promise<number> {
  const { count } = await withTenantDb(input.tenantId, (db) =>
    db.connectorOAuthFlow.updateMany({
      where: { id: input.flowId, tenantId: input.tenantId },
      data: {
        status: input.status,
        ...(input.resultCode !== undefined ? { resultCode: input.resultCode } : null),
        ...(input.resultAccountId !== undefined ? { resultAccountId: input.resultAccountId } : null),
        ...(input.resultRefId !== undefined ? { resultRefId: input.resultRefId } : null),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : null),
      },
    }),
  );
  return count;
}

/**
 * Move a flow to a terminal state ONLY if it is not already terminal.
 *
 * This is what makes a late provider callback safe after a user cancelled, and a
 * duplicate selection submit safe after the first one completed: the second write
 * matches zero rows and the caller reports the existing state instead of
 * overwriting it.
 */
export async function finalizeConnectorOAuthFlow(input: {
  tenantId: string;
  flowId: string;
  status: Extract<OAuthFlowStatus, "completed" | "failed" | "cancelled">;
  resultCode?: string | null;
  resultAccountId?: string | null;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const { count } = await withTenantDb(input.tenantId, (db) =>
    db.connectorOAuthFlow.updateMany({
      where: {
        id: input.flowId,
        tenantId: input.tenantId,
        status: { notIn: [...TERMINAL] },
      },
      data: {
        status: input.status,
        resultCode: input.resultCode ?? null,
        ...(input.resultAccountId !== undefined ? { resultAccountId: input.resultAccountId } : null),
        completedAt: now,
      },
    }),
  );
  return count === 1;
}

/**
 * TTL sweep, batch-bounded, matching `deleteExpiredOnboardingSessions`.
 *
 * Expiry is ALSO enforced in every query, so an unswept row is already dead — this
 * only stops the table growing.
 */
export async function deleteExpiredConnectorOAuthFlows(
  now: Date = new Date(),
  batch = 500,
): Promise<{ count: number }> {
  const stale = await systemDb.connectorOAuthFlow.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true },
    take: batch,
  });
  if (stale.length === 0) return { count: 0 };
  return systemDb.connectorOAuthFlow.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
}
