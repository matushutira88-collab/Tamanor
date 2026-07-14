"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createLead } from "@guardora/db";
import { emitOpsEvent, metrics } from "@guardora/core";
import { publicFormLimiter, ipKeyFromHeader } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public lead capture. Saves a Lead to the database. Success is only signalled
 * (?sent=1) AFTER the row is actually written — there is no fake "email sent".
 */
export async function submitLead(formData: FormData): Promise<void> {
  const source = String(formData.get("source") ?? "book_demo");
  const backTo = source === "contact" ? "/contact" : "/book-demo";

  const fail = (reason: string): never =>
    redirect(`${backTo}?error=${encodeURIComponent(reason)}`);

  // V1.48P — bounded per-IP rate limit (fail-closed). Blocks lead-form spam without storing PII/IP.
  const ipKey = ipKeyFromHeader((await headers()).get("x-forwarded-for"));
  if (!publicFormLimiter.check(ipKey).allowed) {
    metrics.inc("public_form_rate_limited_total", { operation: "lead_submit" });
    emitOpsEvent("web.5xx", { operation: "lead_submit", reason: "rate_limited" });
    fail("Too many requests. Please try again in a minute.");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const consent = formData.get("consent") === "on";

  if (!name) fail("Please enter your name.");
  if (!EMAIL_RE.test(email)) fail("Please enter a valid email address.");
  if (!consent) fail("Please accept the consent checkbox to continue.");

  const platforms = formData
    .getAll("platforms")
    .map((p) => String(p))
    .filter(Boolean);

  // V1.34 — segment + account count are captured into the message (no schema change).
  const segment = String(formData.get("segment") ?? "").trim();
  const accounts = String(formData.get("accounts") ?? "").trim();
  const rawMessage = String(formData.get("message") ?? "").trim();
  const message = [
    segment ? `Segment: ${segment}` : "",
    accounts ? `Social accounts: ${accounts}` : "",
    rawMessage,
  ].filter(Boolean).join("\n") || null;

  // Global marketing-capture table (no tenant) — system write via a narrow repo.
  await createLead({
    name,
    email,
    company: String(formData.get("company") ?? "").trim() || null,
    website: String(formData.get("website") ?? "").trim() || null,
    platforms,
    message,
    source,
    consent,
  });

  redirect(`${backTo}?sent=1`);
}
