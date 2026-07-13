/**
 * V1.39 — readiness probe. Fail-closed: reports whether the app can safely serve tenant
 * traffic. Runs SAFE checks (DB reachable, RLS runtime healthy, runtime DB config valid,
 * token encryption safe, session config present) and returns ONLY status strings — never
 * a DB URL, role credential, token or secret. 200 when ready, 503 otherwise.
 */
import { checkRlsRuntime, validateRuntimeDbConfig, tokenStorageStatus } from "@guardora/db";

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

  const anyUnavailable = checks.some((c) => c.status === "unavailable");
  const anyMisconfigured = checks.some((c) => c.status === "misconfigured");
  const overall: CheckStatus = anyUnavailable ? "unavailable" : anyMisconfigured ? "misconfigured" : checks.some((c) => c.status === "degraded") ? "degraded" : "healthy";
  const ready = overall === "healthy" || overall === "degraded";

  return Response.json({ status: overall, ready, checks }, { status: ready ? 200 : 503 });
}
