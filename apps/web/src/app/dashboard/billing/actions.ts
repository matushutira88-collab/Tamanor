"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  Permission, can, emitOpsEvent, metrics,
  isSelfServePlan, isBillingInterval, type BillingPlanId, type BillingInterval,
} from "@guardora/core";
import { getSession } from "@/server/auth";
import { isSameOrigin } from "@/server/csrf";
import { authLimiter, ipKeyFromHeader } from "@/lib/rate-limit";
import { createCheckout, createPortal } from "@/server/billing/service";

/**
 * V1.50D — billing server actions. Every write requires a verified session with the OWNER-exclusive
 * BillingManage permission, is CSRF- + rate-limited, and uses the TRUSTED session tenantId (never a
 * client-supplied tenant). Prices are resolved server-side from a (plan, interval) pair — a
 * client-supplied Stripe price ID is impossible.
 */
async function requireBillingOwner() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.emailVerified) redirect("/verify-email");
  if (!can(session.role, Permission.BillingManage)) redirect("/dashboard/billing?error=forbidden");
  return session;
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  return h.get("origin") || (h.get("host") ? `https://${h.get("host")}` : process.env.APP_BASE_URL || process.env.APP_URL || "");
}

export async function startCheckout(formData: FormData): Promise<void> {
  if (!(await isSameOrigin())) redirect("/dashboard/billing?error=csrf");
  const session = await requireBillingOwner();

  const ip = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!authLimiter.check(`checkout:${ip}`).allowed) redirect("/dashboard/billing?error=rate_limited");

  const plan = String(formData.get("plan") ?? "");
  const interval = String(formData.get("interval") ?? "monthly");
  if (!isSelfServePlan(plan)) redirect("/dashboard/billing?error=invalid_plan");
  if (!isBillingInterval(interval)) redirect("/dashboard/billing?error=invalid_interval");

  const res = await createCheckout({
    tenantId: session.tenantId,
    ownerEmail: session.userEmail,
    plan: plan as BillingPlanId,
    interval: interval as BillingInterval,
    origin: await requestOrigin(),
  });
  if (!res.ok) {
    metrics.inc("billing_checkout_total", { result: "error" });
    emitOpsEvent("billing.checkout_failed", { reason: res.reason });
    redirect(`/dashboard/billing?error=${encodeURIComponent(res.reason)}`);
  }
  metrics.inc("billing_checkout_total", { result: "ok" });
  redirect(res.url); // → Stripe Checkout (external)
}

export async function openBillingPortal(): Promise<void> {
  if (!(await isSameOrigin())) redirect("/dashboard/billing?error=csrf");
  const session = await requireBillingOwner();

  const ip = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!authLimiter.check(`portal:${ip}`).allowed) redirect("/dashboard/billing?error=rate_limited");

  const res = await createPortal({ tenantId: session.tenantId, origin: await requestOrigin() });
  if (!res.ok) {
    metrics.inc("billing_portal_total", { result: "error" });
    emitOpsEvent("billing.portal_failed", { reason: res.reason });
    redirect(`/dashboard/billing?error=${encodeURIComponent(res.reason)}`);
  }
  metrics.inc("billing_portal_total", { result: "ok" });
  redirect(res.url); // → Stripe Customer Portal (external)
}
