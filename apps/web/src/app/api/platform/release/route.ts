import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { requirePlatformCapability } from "@guardora/db";
import { resolveReleaseMetadata, emitSafeLog, type ProvenanceEnv, type ProvenancePolicy } from "@guardora/core";

/**
 * Authenticated internal RELEASE metadata — GET /api/platform/release. Platform `system_health.view` only.
 * Returns the sanitized, immutable release metadata (environment, full commit SHA, ref, source, deployment
 * host, provenanceValid, stable error codes) from the pure resolver — NEVER a secret, user, tenant, DB/storage
 * id, or an env dump. On invalid PRODUCTION provenance it emits a privacy-safe structured diagnostic.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function policyFromEnv(env: ProvenanceEnv): ProvenancePolicy {
  const p: ProvenancePolicy = {};
  if (env.EXPECTED_RELEASE_OWNER?.trim()) p.expectedOwner = env.EXPECTED_RELEASE_OWNER.trim();
  const slug = env.EXPECTED_RELEASE_SLUG === undefined ? "Tamanor" : env.EXPECTED_RELEASE_SLUG.trim();
  if (slug) p.expectedSlug = slug;
  const refs = env.EXPECTED_RELEASE_REFS === undefined ? ["main"] : env.EXPECTED_RELEASE_REFS.split(",").map((r) => r.trim()).filter(Boolean);
  if (refs.length) p.allowedRefs = refs;
  return p;
}

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !session.emailVerified) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  try {
    await requirePlatformCapability(session.userId, "system_health.view");
  } catch {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const env = process.env as ProvenanceEnv;
  const m = resolveReleaseMetadata(env, policyFromEnv(env));
  if (m.environment === "production" && !m.provenanceValid) {
    emitSafeLog({
      event: "release.provenance.invalid",
      severity: "error",
      releaseSha: m.commitSha,
      deploymentId: m.deploymentId,
      routeTemplate: "/api/platform/release",
      outcome: "invalid_production_provenance",
      detail: { source: m.source, errors: m.errors },
    });
  }
  // The resolver output is already sanitized (no secrets/ids); return it verbatim.
  return NextResponse.json({ ok: true, release: m }, { headers: { "cache-control": "no-store" } });
}
