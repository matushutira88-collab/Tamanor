import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  resolveAccessState, resolveEntitlements, accessAllowsOperations, evaluateCheckoutGuard,
  type AccessState, type BillingStatus, type PlanEntitlements, type CheckoutGuardReason,
} from "@guardora/core";
import { systemDb } from "./index";

/**
 * V1.50D — billing persistence. All writes are SYSTEM-scoped and driven ONLY by trusted Stripe
 * data via the verified webhook (never by a browser tenantId). Stores safe Stripe identifiers +
 * billing state; never card data, payment methods, or raw payloads. The access decision is derived
 * centrally by {@link resolveAccessState}; the DB never invents access from a single field.
 */

export type TenantBilling = {
  tenantId: string;
  plan: string;
  billingStatus: string;
  accessState: string;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  subscription: {
    plan: string;
    status: string;
    billingInterval: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    latestInvoiceStatus: string | null;
    hasStripeCustomer: boolean;
  } | null;
};

export async function getTenantBilling(tenantId: string): Promise<TenantBilling | null> {
  const t = await systemDb.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, plan: true, billingStatus: true, accessState: true, trialStartsAt: true, trialEndsAt: true,
      subscription: {
        select: {
          plan: true, status: true, billingInterval: true, currentPeriodEnd: true,
          cancelAtPeriodEnd: true, canceledAt: true, latestInvoiceStatus: true, stripeCustomerId: true,
        },
      },
    },
  });
  if (!t) return null;
  return {
    tenantId: t.id, plan: t.plan, billingStatus: t.billingStatus, accessState: t.accessState,
    trialStartsAt: t.trialStartsAt, trialEndsAt: t.trialEndsAt,
    subscription: t.subscription
      ? {
          plan: t.subscription.plan, status: t.subscription.status, billingInterval: t.subscription.billingInterval,
          currentPeriodEnd: t.subscription.currentPeriodEnd, cancelAtPeriodEnd: t.subscription.cancelAtPeriodEnd,
          canceledAt: t.subscription.canceledAt, latestInvoiceStatus: t.subscription.latestInvoiceStatus,
          hasStripeCustomer: !!t.subscription.stripeCustomerId,
        }
      : null,
  };
}

/**
 * V1.50E — the tenant's resolved entitlements (limits + capabilities) with access-state precedence.
 * Deletion state > suspended/restricted (operations off, creation blocked) > plan. Unknown plan
 * fails safe to the lowest access. This is the single server-side entitlement resolver.
 */
export async function getTenantEntitlements(tenantId: string): Promise<PlanEntitlements> {
  const t = await systemDb.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, accessState: true, deletionState: true },
  });
  return resolveEntitlements(t?.plan, t?.accessState, { deletingTenant: !!t && t.deletionState !== "active" });
}

/** Whether NEW operations (sync, moderation execution, provider actions) may run for this tenant. */
export async function tenantAllowsOperations(tenantId: string): Promise<boolean> {
  return (await getTenantOperationGate(tenantId)).allowed;
}

export type OperationGateReason = "tenant_deleting" | "billing_restricted" | "suspended" | "tenant_missing";

/**
 * V1.50F — central operation gate with a NORMALIZED reason (for sync-pause skips + observability).
 * Precedence: deletion > suspended > restricted > allowed. This is the ONE place sync/execution
 * paths consult; they never re-derive restricted-state logic. Unknown/missing tenant → not allowed.
 */
export async function getTenantOperationGate(tenantId: string): Promise<{ allowed: boolean; reason: OperationGateReason | null }> {
  const t = await systemDb.tenant.findUnique({ where: { id: tenantId }, select: { accessState: true, deletionState: true } });
  if (!t) return { allowed: false, reason: "tenant_missing" };
  if (t.deletionState !== "active") return { allowed: false, reason: "tenant_deleting" };
  if (t.accessState === "suspended") return { allowed: false, reason: "suspended" };
  if (!accessAllowsOperations(t.accessState as AccessState)) return { allowed: false, reason: "billing_restricted" };
  return { allowed: true, reason: null };
}

/** Resolve the Stripe customer id already stored for a tenant (for reuse at checkout). */
export async function getStripeCustomerId(tenantId: string): Promise<string | null> {
  const s = await systemDb.subscription.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } });
  return s?.stripeCustomerId ?? null;
}

/**
 * V1.57.3A — durable, tenant-scoped Checkout reservation. Replaces the V1.57.3 advisory-lock-only
 * guard, whose lock released before the Stripe network call and so could not prevent two concurrent
 * DIFFERENT-plan requests from each creating a Session. The reservation now persists a CREATING row
 * BEFORE the Stripe call; a DB-enforced partial unique index guarantees AT MOST ONE live attempt
 * (CREATING|OPEN) per tenant, so the guarantee survives the gap between the transaction ending and
 * the Stripe response. The Subscription row remains the entitlement source; this is workflow state.
 */
export type ReserveCheckoutInput = {
  tenantId: string;
  userId: string | null;
  plan: string;
  interval: string;
  priceId: string;
  /** Short crash-recovery TTL for the CREATING row (until the Stripe Session is created). */
  creatingTtlMs?: number;
  now?: Date;
};
export type ReserveCheckoutResult =
  // Guard blocked — no attempt row created, no Stripe call.
  | { kind: "blocked"; reason: CheckoutGuardReason }
  // A live attempt already exists (concurrent request, repeated click, or another tab). Carries the
  // stored per-attempt key so a same-plan resume re-drives Stripe with the SAME key (no duplicate).
  | { kind: "existing"; attemptId: string; samePlan: boolean; url: string | null; idempotencyKey: string }
  // Reserved a fresh CREATING attempt — the caller MUST now create the Stripe Session with this key.
  | { kind: "reserved"; attemptId: string; idempotencyKey: string; priceId: string };

const DEFAULT_CREATING_TTL_MS = 3 * 60 * 1000; // 3 min — a crashed invocation frees the tenant fast

/**
 * Atomic reservation (Phase 3). One short transaction: advisory lock (per tenant) → subscription
 * guard → expire stale live attempts → reuse an existing live attempt OR insert exactly one new
 * CREATING attempt with a stable per-attempt idempotency key. The transaction ENDS before Stripe is
 * called; the persisted CREATING row (backed by the partial unique index) is what holds the tenant.
 */
export async function reserveCheckoutAttempt(input: ReserveCheckoutInput): Promise<ReserveCheckoutResult> {
  const now = input.now ?? new Date();
  const creatingTtlMs = input.creatingTtlMs ?? DEFAULT_CREATING_TTL_MS;
  return systemDb.$transaction(async (tx) => {
    // Serialize same-tenant reservations (different tenants never block). Belt to the unique-index
    // suspenders below: with the lock, the loser reads the winner's committed row instead of racing.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${input.tenantId}`}, 0))`;

    // 1) Subscription guard — an active/recoverable subscription blocks any new checkout entirely.
    const sub = await tx.subscription.findUnique({
      where: { tenantId: input.tenantId },
      select: { status: true, currentPeriodEnd: true },
    });
    const decision = evaluateCheckoutGuard(sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd } : null);
    if (!decision.allowed) return { kind: "blocked", reason: decision.reason };

    // 2) Expire stale live attempts (crashed CREATING or lapsed OPEN) so a tenant is never locked out.
    await tx.stripeCheckoutAttempt.updateMany({
      where: { tenantId: input.tenantId, status: { in: ["CREATING", "OPEN"] }, expiresAt: { lt: now } },
      data: { status: "EXPIRED", failedAt: null },
    });

    // 3) A still-live attempt? Reuse it — never open a parallel session (Phase 6).
    const live = await tx.stripeCheckoutAttempt.findFirst({
      where: { tenantId: input.tenantId, status: { in: ["CREATING", "OPEN"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, requestedPlan: true, requestedInterval: true, status: true, idempotencyKey: true,
        stripeCheckoutUrl: true, stripeCheckoutUrlExpiresAt: true,
      },
    });
    if (live) {
      const samePlan = live.requestedPlan === input.plan && live.requestedInterval === input.interval;
      const urlUsable =
        live.status === "OPEN" && !!live.stripeCheckoutUrl &&
        (!live.stripeCheckoutUrlExpiresAt || live.stripeCheckoutUrlExpiresAt.getTime() > now.getTime());
      return { kind: "existing", attemptId: live.id, samePlan, url: urlUsable ? live.stripeCheckoutUrl : null, idempotencyKey: live.idempotencyKey };
    }

    // 4) Reserve exactly one new CREATING attempt. The per-attempt idempotency key is generated once
    //    here and stored, so every retry of THIS attempt reuses it (Stripe dedupes), while a later
    //    genuinely-new attempt gets a fresh key. Not derived from priceId. The partial unique index
    //    guarantees this INSERT fails if any concurrent live attempt slipped past the lock.
    const idempotencyKey = `checkout_attempt:${randomUUID()}`;
    const attempt = await tx.stripeCheckoutAttempt.create({
      data: {
        tenantId: input.tenantId,
        status: "CREATING",
        requestedPlan: input.plan,
        requestedInterval: input.interval,
        stripePriceId: input.priceId,
        idempotencyKey,
        createdByUserId: input.userId,
        expiresAt: new Date(now.getTime() + creatingTtlMs),
      },
      select: { id: true },
    });
    return { kind: "reserved", attemptId: attempt.id, idempotencyKey, priceId: input.priceId };
  });
}

/**
 * Transition a reserved CREATING attempt to OPEN after Stripe returns a Session (Phase 4). Guarded:
 * updates ONLY while the row is still CREATING for the same tenant (never resurrects a completed/
 * failed/expired attempt, never touches another tenant). Extends expiry to the Stripe Session expiry.
 */
export async function markCheckoutAttemptOpen(args: {
  attemptId: string; tenantId: string; sessionId: string; url: string | null; sessionExpiresAt: Date | null;
}): Promise<void> {
  await systemDb.stripeCheckoutAttempt.updateMany({
    where: { id: args.attemptId, tenantId: args.tenantId, status: "CREATING" },
    data: {
      status: "OPEN",
      stripeCheckoutSessionId: args.sessionId,
      stripeCheckoutUrl: args.url,
      stripeCheckoutUrlExpiresAt: args.sessionExpiresAt,
      expiresAt: args.sessionExpiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

/** Mark a reserved attempt FAILED after a Stripe error (Phase 4). Stores only a safe failure code. */
export async function markCheckoutAttemptFailed(args: { attemptId: string; tenantId: string; failureCode: string }): Promise<void> {
  await systemDb.stripeCheckoutAttempt.updateMany({
    where: { id: args.attemptId, tenantId: args.tenantId, status: "CREATING" },
    data: { status: "FAILED", failedAt: new Date(), failureCode: args.failureCode.slice(0, 64) },
  });
}

/** Webhook: mark the attempt COMPLETED by trusted Stripe Session id (Phase 7). Never grants access. */
export async function completeCheckoutAttemptBySession(sessionId: string): Promise<void> {
  await systemDb.stripeCheckoutAttempt.updateMany({
    where: { stripeCheckoutSessionId: sessionId, status: { in: ["CREATING", "OPEN"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/** Webhook: mark the attempt EXPIRED by trusted Stripe Session id (checkout.session.expired). */
export async function expireCheckoutAttemptBySession(sessionId: string): Promise<void> {
  await systemDb.stripeCheckoutAttempt.updateMany({
    where: { stripeCheckoutSessionId: sessionId, status: { in: ["CREATING", "OPEN"] } },
    data: { status: "EXPIRED" },
  });
}

/**
 * Belt: when a subscription becomes active for a tenant (subscription webhook may precede
 * checkout.session.completed), retire any lingering live attempt so state stays truthful. Safe —
 * the subscription guard already blocks new checkouts once a subscription is active.
 */
export async function completeLiveCheckoutAttemptsForTenant(tenantId: string): Promise<void> {
  await systemDb.stripeCheckoutAttempt.updateMany({
    where: { tenantId, status: { in: ["CREATING", "OPEN"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/** Derive the tenant from a Stripe customer id (webhook path — never from the browser). */
export async function findTenantIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const s = await systemDb.subscription.findUnique({ where: { stripeCustomerId }, select: { tenantId: true } });
  return s?.tenantId ?? null;
}

/**
 * Persist the Stripe customer id for a tenant at checkout time (before the subscription exists), so
 * later webhooks can derive the tenant from the customer. Upsert by tenantId; the customer id is
 * unique across tenants (a customer can never map to two tenants).
 */
export async function ensureStripeCustomer(tenantId: string, stripeCustomerId: string): Promise<void> {
  await systemDb.subscription.upsert({
    where: { tenantId },
    create: { tenantId, stripeCustomerId, plan: "free_trial", status: "no_subscription" },
    update: { stripeCustomerId },
  });
}

export type StripeSubStateInput = {
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  plan: string;
  billingInterval?: string | null;
  status: BillingStatus | string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  trialEndsAt?: Date | null;
  latestInvoiceStatus?: string | null;
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "failed" | "stale";

function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Process a Stripe webhook event EXACTLY ONCE, atomically. The Stripe event id is the idempotency
 * key: a successfully-processed event is recorded; a retried/replayed delivery is a no-op
 * ("duplicate"). If `input` is null the event is recorded as "ignored". On any DB error nothing is
 * committed (rolled back) and "failed" is returned — the caller must then return a non-2xx so
 * Stripe retries. The tenant is derived from the trusted Stripe customer id, never a browser value.
 */
export async function recordAndApplyStripeEvent(
  stripeEventId: string,
  eventType: string,
  input: StripeSubStateInput | null,
  eventCreated: number,
  now: Date = new Date(),
): Promise<{ outcome: WebhookOutcome; tenantId: string | null; accessState: AccessState | null }> {
  // Fast path: already fully processed → duplicate (no work).
  const existing = await systemDb.stripeWebhookEvent.findUnique({ where: { stripeEventId }, select: { result: true } });
  if (existing && existing.result === "processed") return { outcome: "duplicate", tenantId: null, accessState: null };

  // Ignored events: record and stop (no subscription mutation).
  if (!input) {
    await systemDb.stripeWebhookEvent.upsert({
      where: { stripeEventId },
      create: { stripeEventId, eventType, result: "ignored", processedAt: now },
      update: { result: "ignored", processedAt: now },
    }).catch((e) => { if (!isUnique(e)) throw e; });
    return { outcome: "ignored", tenantId: null, accessState: null };
  }

  const tenantId = await findTenantIdByStripeCustomer(input.stripeCustomerId);
  if (!tenantId) {
    // No tenant maps to this customer → record ignored (cannot grant access to an unknown tenant).
    await systemDb.stripeWebhookEvent.upsert({
      where: { stripeEventId },
      create: { stripeEventId, eventType, result: "ignored", processedAt: now },
      update: { result: "ignored", processedAt: now },
    }).catch((e) => { if (!isUnique(e)) throw e; });
    return { outcome: "ignored", tenantId: null, accessState: null };
  }

  const accessState = resolveAccessState({
    status: input.status,
    trialEndsAt: input.trialEndsAt ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    now,
  });

  // V1.58.4 — out-of-order guard. This subscription aggregate advances only to a NEWER event; an
  // older (delayed/retried) event is stale. Terminality = the subscription ended (deleted / canceled).
  const eventCreatedAt = new Date(eventCreated * 1000);
  const terminal = eventType === "customer.subscription.deleted" || input.status === "canceled";
  // Atomic, race-safe predicate — the SAME rule as core `shouldApplyStripeEvent`, expressed as a
  // conditional UPDATE so concurrent webhooks serialize on the subscription row (no TOCTOU): apply
  // when no prior event, or strictly newer, or (equal created AND this event is terminal while the
  // stored one is not — terminal wins the second-resolution tie and is never overwritten).
  const orderingOr: Prisma.SubscriptionWhereInput[] = [
    { lastStripeEventAt: null },
    { lastStripeEventAt: { lt: eventCreatedAt } },
    ...(terminal ? [{ lastStripeEventAt: eventCreatedAt, lastStripeEventTerminal: false }] : []),
  ];

  try {
    let applied = false;
    await systemDb.$transaction(async (tx) => {
      const upd = await tx.subscription.updateMany({
        where: { tenantId, OR: orderingOr },
        data: {
          stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
          stripePriceId: input.stripePriceId ?? undefined,
          plan: input.plan,
          billingInterval: input.billingInterval ?? undefined,
          status: String(input.status),
          currentPeriodStart: input.currentPeriodStart ?? undefined,
          currentPeriodEnd: input.currentPeriodEnd ?? undefined,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? undefined,
          canceledAt: input.canceledAt ?? undefined,
          trialEndsAt: input.trialEndsAt ?? undefined,
          latestInvoiceStatus: input.latestInvoiceStatus ?? undefined,
          lastStripeEventAt: eventCreatedAt,
          lastStripeEventTerminal: terminal,
        },
      });
      applied = upd.count > 0;
      // Only advance tenant access when THIS event actually applied (won the ordering guard).
      if (applied) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { plan: input.plan, billingStatus: String(input.status), accessState },
        });
      }
      // Record the event barrier either way (idempotent replay-safe); a stale event is recorded as
      // "stale" and changes no access state.
      await tx.stripeWebhookEvent.upsert({
        where: { stripeEventId },
        create: { stripeEventId, eventType, result: applied ? "processed" : "stale", processedAt: now },
        update: { result: applied ? "processed" : "stale", processedAt: now },
      });
    });
    return applied
      ? { outcome: "processed", tenantId, accessState }
      : { outcome: "stale", tenantId, accessState: null };
  } catch {
    // Rolled back — do NOT record a barrier; Stripe will retry.
    return { outcome: "failed", tenantId, accessState: null };
  }
}

/**
 * Recompute a tenant's access state from its current stored billing (used by the trial-expiry
 * sweep and on read). Central mapping; never invents access. Returns the new access state.
 */
export async function recomputeTenantAccess(tenantId: string, now: Date = new Date()): Promise<AccessState | null> {
  const t = await systemDb.tenant.findUnique({
    where: { id: tenantId },
    select: { billingStatus: true, trialEndsAt: true, subscription: { select: { currentPeriodEnd: true, cancelAtPeriodEnd: true } } },
  });
  if (!t) return null;
  const access = resolveAccessState({
    status: t.billingStatus,
    trialEndsAt: t.trialEndsAt,
    currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: t.subscription?.cancelAtPeriodEnd,
    now,
  });
  await systemDb.tenant.updateMany({ where: { id: tenantId, accessState: { not: access } }, data: { accessState: access } });
  return access;
}

/**
 * Worker sweep: tenants whose trial has ended with NO active paid subscription are moved to
 * restricted access (never deleted, never disconnected). Bounded batches, idempotent. Returns the
 * count restricted this pass.
 */
export async function sweepTrialExpirations(now: Date = new Date(), batchSize = 500): Promise<number> {
  const candidates = await systemDb.tenant.findMany({
    where: {
      billingStatus: "no_subscription",
      accessState: "full_access",
      trialEndsAt: { lt: now },
    },
    select: { id: true },
    take: Math.min(Math.max(batchSize, 1), 5000),
  });
  let restricted = 0;
  for (const c of candidates) {
    const r = await systemDb.tenant.updateMany({
      where: { id: c.id, billingStatus: "no_subscription", accessState: "full_access" },
      data: { accessState: "restricted" },
    });
    restricted += r.count;
  }
  return restricted;
}

/** Bounded, index-backed purge of old Stripe webhook audit rows (retention). Id-scoped deletes. */
export async function purgeStripeWebhookEvents(cutoff: Date, batchSize = 500, maxBatches = 20): Promise<number> {
  let removed = 0;
  const take = Math.min(Math.max(batchSize, 1), 5000);
  for (let i = 0; i < maxBatches; i++) {
    const ids = await systemDb.stripeWebhookEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take });
    if (ids.length === 0) break;
    const del = await systemDb.stripeWebhookEvent.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
    removed += del.count;
    if (ids.length < take) break;
  }
  return removed;
}
