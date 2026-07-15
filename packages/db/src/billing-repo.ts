import { Prisma } from "@prisma/client";
import { resolveAccessState, type AccessState, type BillingStatus } from "@guardora/core";
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

/** Resolve the Stripe customer id already stored for a tenant (for reuse at checkout). */
export async function getStripeCustomerId(tenantId: string): Promise<string | null> {
  const s = await systemDb.subscription.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } });
  return s?.stripeCustomerId ?? null;
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

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "failed";

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

  try {
    await systemDb.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
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
        },
      });
      await tx.tenant.update({
        where: { id: tenantId },
        data: { plan: input.plan, billingStatus: String(input.status), accessState },
      });
      await tx.stripeWebhookEvent.upsert({
        where: { stripeEventId },
        create: { stripeEventId, eventType, result: "processed", processedAt: now },
        update: { result: "processed", processedAt: now },
      });
    });
    return { outcome: "processed", tenantId, accessState };
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
