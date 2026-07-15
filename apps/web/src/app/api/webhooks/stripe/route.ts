import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, webhookSecret } from "@/server/billing/stripe";
import { normalizeSubscription, subscriptionFromEvent } from "@/server/billing/service";
import { recordAndApplyStripeEvent, type StripeSubStateInput } from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events that mutate billing state. Everything else is acknowledged + recorded as ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
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
    await recordAndApplyStripeEvent(event.id, event.type, null).catch(() => {});
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    let input: StripeSubStateInput | null = null;
    if (event.type !== "payment_intent.payment_failed") {
      const obj = event.data.object as unknown as Record<string, unknown>;
      const latestInvoiceStatus = event.type.startsWith("invoice.") && typeof obj.status === "string" ? obj.status : null;
      const sub = await subscriptionFromEvent(stripe, event);
      input = sub ? normalizeSubscription(sub, latestInvoiceStatus) : null;
    }

    const res = await recordAndApplyStripeEvent(event.id, event.type, input);
    if (res.outcome === "failed") {
      metrics.inc("billing_webhook_total", { result: "failed" });
      emitOpsEvent("billing.webhook_failed", { operation: event.type });
      // Do NOT acknowledge success on a DB failure → Stripe retries.
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }

    if (res.outcome === "processed") {
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
