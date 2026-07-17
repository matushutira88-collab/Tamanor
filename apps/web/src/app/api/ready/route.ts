/**
 * V1.39 — readiness probe. Fail-closed: reports whether the app can safely serve tenant
 * traffic. Runs SAFE checks (DB reachable, RLS runtime healthy, runtime DB config valid,
 * token encryption safe, session config present) and returns ONLY status strings — never
 * a DB URL, role credential, token or secret. 200 when ready, 503 otherwise.
 */
import { checkRlsRuntime, validateRuntimeDbConfig, tokenStorageStatus } from "@guardora/db";
import { emitOpsEvent, stripeBillingReadiness } from "@guardora/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "healthy" | "degraded" | "unavailable" | "misconfigured";
interface Check { name: string; status: CheckStatus }

export async function GET() {
  const isProd = process.env.NODE_ENV === "production";
  const checks: Check[] = [];

  // 1+3) Database reachability AND RLS health from ONE sanctioned health check (no raw
  //      client, no credentials revealed). `checkRlsRuntime` reports "unavailable" when the
  //      database cannot be reached; otherwise it reports the RLS runtime status.
  const rls = await checkRlsRuntime();
  const dbReachable = rls.status !== "unavailable";
  checks.push({ name: "database", status: dbReachable ? "healthy" : "unavailable" });

  // 2) Runtime DB config (pure; production requires a distinct APP_DATABASE_URL).
  const cfg = validateRuntimeDbConfig();
  checks.push({ name: "runtime_db_config", status: cfg.ok ? "healthy" : "misconfigured" });

  // 3) RLS runtime. In production it MUST be healthy; in dev the owner-fallback is expected → degraded.
  const rlsStatus: CheckStatus = !dbReachable ? "unavailable" : rls.status === "healthy" ? "healthy" : isProd ? "misconfigured" : "degraded";
  checks.push({ name: "rls_runtime", status: rlsStatus });

  // 4) Token encryption (production must be encrypted-at-rest safe).
  const tok = tokenStorageStatus();
  checks.push({ name: "token_encryption", status: !isProd || tok.productionSafe ? "healthy" : "misconfigured" });

  // 5) Session config present.
  const sessionOk = Boolean((process.env.AUTH_SECRET ?? "").trim()) || !isProd;
  checks.push({ name: "session_config", status: sessionOk ? "healthy" : "misconfigured" });

  // 6) V1.51 — email link base URL. Transactional emails (verify/reset) embed one-time links built
  //    from APP_BASE_URL; in production it MUST be an absolute https origin (never a preview URL or a
  //    relative "") or the links break. Fail-closed so this surfaces before any email is sent.
  const emailBase = (process.env.APP_BASE_URL || process.env.APP_URL || "").trim();
  const emailBaseOk = !isProd || /^https:\/\/[^\s]+$/.test(emailBase);
  checks.push({ name: "email_base_url", status: emailBaseOk ? "healthy" : "misconfigured" });

  // 7) V1.51B — production transactional email MUST be the Google Workspace / Gmail API provider,
  //    with a tamanor.com sender and complete OAuth refresh-token credentials, and NO leftover Resend
  //    configuration. Fail-closed in production; never sends a real email. No secret is returned.
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const sender = (process.env.GOOGLE_EMAIL_SENDER ?? process.env.EMAIL_FROM ?? "").trim();
  const senderDomainOk = /@tamanor\.com$/i.test(sender);
  const googleCredsComplete = Boolean(
    (process.env.GOOGLE_EMAIL_CLIENT_ID ?? "").trim() &&
    (process.env.GOOGLE_EMAIL_CLIENT_SECRET ?? "").trim() &&
    (process.env.GOOGLE_EMAIL_REFRESH_TOKEN ?? "").trim(),
  );
  const resendResidue = Boolean((process.env.RESEND_API_KEY ?? "").trim()) || provider === "resend";
  const emailProviderOk = !isProd || (provider === "google" && senderDomainOk && googleCredsComplete && !resendResidue);
  checks.push({ name: "email_provider", status: emailProviderOk ? "healthy" : "misconfigured" });

  const anyUnavailable = checks.some((c) => c.status === "unavailable");
  const anyMisconfigured = checks.some((c) => c.status === "misconfigured");
  const overall: CheckStatus = anyUnavailable ? "unavailable" : anyMisconfigured ? "misconfigured" : checks.some((c) => c.status === "degraded") ? "degraded" : "healthy";
  const ready = overall === "healthy" || overall === "degraded";

  // V1.51 — emit the spec-required readiness alert on a NOT-READY result (503). The failing check
  // name is a low-cardinality label; no URL/credential/secret is included (fail-safe telemetry).
  if (!ready) {
    const failing = checks.find((c) => c.status === "unavailable" || c.status === "misconfigured");
    emitOpsEvent("service.readiness_failed", { reason: failing?.name ?? "unknown", severity: "critical" });
  }

  // V1.57.2 — Stripe billing configuration status (secret-free). Reported for observability but
  // intentionally NON-BLOCKING: missing/incomplete billing config makes BILLING unavailable, not the
  // whole app unready, so /api/ready stays 200 while billing is being configured. No secret values.
  const stripe = stripeBillingReadiness(process.env, { requireLive: isProd });
  const billing = {
    stripe_api_config: stripe.apiConfig,
    stripe_prices: stripe.prices,
    stripe_webhook_config: stripe.webhookConfig,
    stripe_portal_config: stripe.portalConfig,
    duplicate_price_ids: stripe.duplicatePriceIds,
    configured: stripe.configured,
  };

  return Response.json({ status: overall, ready, checks, billing }, { status: ready ? 200 : 503 });
}
