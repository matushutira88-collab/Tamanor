/**
 * V1.50D — Stripe webhook signature verification (deterministic; no live Stripe / no charges).
 * Uses the Stripe SDK's own test-header generator to prove the exact primitive the webhook route
 * relies on: a valid signature over the RAW body is accepted; a tampered body / wrong secret / bad
 * signature is rejected. Also asserts the catalogue fails closed on an unknown price id.
 *
 * Run: pnpm billing-webhook:test
 */
import Stripe from "stripe";
import { planForStripePriceId, resolveStripePriceId } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

function verifies(stripe: Stripe, body: string, header: string, secret: string): boolean {
  try { stripe.webhooks.constructEvent(body, header, secret); return true; } catch { return false; }
}

async function run() {
  const stripe = new Stripe("sk_test_dummy_key_for_signature_only");
  const secret = "whsec_test_secret_1234567890";
  const payload = JSON.stringify({ id: "evt_test_1", type: "customer.subscription.updated", data: { object: {} } });

  const goodHeader = stripe.webhooks.generateTestHeaderString({ payload, secret });
  check("valid signature over the raw body is ACCEPTED", verifies(stripe, payload, goodHeader, secret));
  check("tampered body is REJECTED", !verifies(stripe, payload + " ", goodHeader, secret));
  check("wrong signing secret is REJECTED", !verifies(stripe, payload, goodHeader, "whsec_wrong_secret"));
  check("garbage signature header is REJECTED", !verifies(stripe, payload, "t=1,v1=deadbeef", secret));
  check("empty signature is REJECTED", !verifies(stripe, payload, "", secret));

  // Catalogue fail-closed (no client-supplied price can be honored).
  const env = { STRIPE_PRICE_STARTER_MONTHLY: "price_live_starter_m" };
  check("configured price reverse-maps", JSON.stringify(planForStripePriceId("price_live_starter_m", env)) === JSON.stringify({ plan: "starter", interval: "monthly" }));
  check("attacker-supplied price id → null (fail closed)", planForStripePriceId("price_attacker", env) === null);
  check("unconfigured plan price → null", resolveStripePriceId("agency", "monthly", env) === null);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — Stripe webhook signature verification (V1.50D)`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
