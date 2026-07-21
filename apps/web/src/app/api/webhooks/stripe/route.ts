import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, webhookSecret } from "@/server/billing/stripe";
import { normalizeSubscription, subscriptionFromEvent } from "@/server/billing/service";
import {
  recordAndApplyStripeEvent, enforceMonitoringLimits,
  completeCheckoutAttemptBySession, expireCheckoutAttemptBySession, completeLiveCheckoutAttemptsForTenant,
  type StripeSubStateInput,
} from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events that mutate billing state. Everything else is acknowledged + recorded as ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.finalization_failed",
  "customer.subscription.trial_will_end",
  "payment_intent.payment_failed",
]);

/**
 * V1.50D — Stripe webhook. Verifies the signature against the RAW body, is idempotent by Stripe
 * event id, derives the tenant from the trusted Stripe customer (never a browser value), applies
 * state in a transaction, and returns non-2xx if the DB write fails so Stripe retries. Never logs
 * payment data, a full payload, email, card metadata, or the Stripe response body.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const stripe = getStripe();
  const secret = webhookSecret();
  if (!stripe || !secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text(); // RAW body — required for Stripe signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? "", secret);
  } catch {
    metrics.inc("billing_webhook_total", { result: "signature_invalid" });
    emitOpsEvent("billing.webhook_signature_invalid", {});
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    await recordAndApplyStripeEvent(event.id, event.type, null, event.created).catch(() => {});
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    // V1.57.3A — Checkout attempt lifecycle. Best-effort: the Subscription row is the entitlement
    // source of truth, so a bookkeeping update must never fail the webhook (which would cause Stripe
    // retries). The reservation guard/expiry already prevent duplicates even if a row lingers.
    if (event.type === "checkout.session.completed") {
      const sid = (event.data.object as { id?: string }).id;
      if (sid) await completeCheckoutAttemptBySession(sid).catch(() => {});
    } else if (event.type === "checkout.session.expired") {
      const sid = (event.data.object as { id?: string }).id;
      if (sid) await expireCheckoutAttemptBySession(sid).catch(() => {});
      // No subscription reference on this event → acknowledge as ignored for subscription state.
      await recordAndApplyStripeEvent(event.id, event.type, null, event.created).catch(() => {});
      metrics.inc("billing_webhook_total", { result: "ignored" });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    let input: StripeSubStateInput | null = null;
    if (event.type !== "payment_intent.payment_failed") {
      const obj = event.data.object as unknown as Record<string, unknown>;
      const latestInvoiceStatus = event.type.startsWith("invoice.") && typeof obj.status === "string" ? obj.status : null;
      const sub = await subscriptionFromEvent(stripe, event);
      input = sub ? normalizeSubscription(sub, latestInvoiceStatus) : null;
    }

    const res = await recordAndApplyStripeEvent(event.id, event.type, input, event.created);
    if (res.outcome === "failed") {
      metrics.inc("billing_webhook_total", { result: "failed" });
      emitOpsEvent("billing.webhook_failed", { operation: event.type });
      // Do NOT acknowledge success on a DB failure → Stripe retries.
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }
    // V1.58.4 — an out-of-order (older) event is recorded as "stale" and changes no access state; ACK
    // 200 so Stripe does not retry. No state-change ops events are emitted for a stale event.
    if (res.outcome === "stale") {
      metrics.inc("billing_webhook_total", { result: "stale" });
      emitOpsEvent("billing.webhook_stale", { operation: event.type });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (res.outcome === "processed") {
      // Belt: a subscription webhook can arrive before checkout.session.completed — retire any live
      // attempt for the now-subscribed tenant so workflow state stays truthful (best-effort).
      if (res.tenantId && (event.type === "customer.subscription.created" || event.type === "invoice.paid")) {
        await completeLiveCheckoutAttemptsForTenant(res.tenantId).catch(() => {});
      }
      // V1.68 (Release A / A2) — a downgrade lowers the plan's structural caps: reconcile monitored
      // accounts keep-oldest (disable monitoring on the excess; never delete or disconnect). Best-effort
      // — the persisted plan is the source of truth, so this bookkeeping must never fail the webhook.
      if (res.tenantId && (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created" || event.type === "customer.subscription.deleted" || event.type === "invoice.paid")) {
        await enforceMonitoringLimits(res.tenantId).catch(() => {});
      }
      if (event.type === "customer.subscription.deleted") emitOpsEvent("billing.subscription_canceled", {});
      else if (event.type === "invoice.payment_failed" || event.type === "invoice.finalization_failed") emitOpsEvent("billing.payment_failed", {});
      else if (event.type === "checkout.session.completed" || event.type === "invoice.paid") emitOpsEvent("billing.subscription_activated", {});
      if (res.accessState === "restricted") emitOpsEvent("billing.access_restricted", {});
    }
    metrics.inc("billing_webhook_total", { result: res.outcome });
    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    metrics.inc("billing_webhook_total", { result: "error" });
    emitOpsEvent("billing.webhook_failed", { operation: event.type });
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}
