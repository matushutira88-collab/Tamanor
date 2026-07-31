/**
 * FAIL-CLOSED PRODUCTION RELEASE-PROVENANCE GATE.
 *
 * Runs at the start of the web build. On a REAL deployment build (Vercel, or an armed approved-CI run) it fails
 * the build (exit 1) unless the release carries valid provenance: a trusted source (Vercel Git integration or an
 * armed approved-CI SHA) AND a full 40-char lowercase commit SHA AND (when configured) the expected repo/branch.
 *
 * Local/dev/test builds remain usable (exit 0) — even though the web `build` script sets `NODE_ENV=production`,
 * the gate only ENFORCES when `VERCEL_ENV` is set (a Vercel build) or `APPROVED_CI_RELEASE=true` (armed CI).
 *
 * Prints ONLY safe values (status, source, the full SHA, the sanitized ref, stable error codes). It NEVER prints
 * a secret, a credential-bearing URL, or an environment dump — all sanitization lives in the pure resolver.
 *
 * Repo/branch pinning is OPT-IN via env (so an unverifiable slug string can never false-block a real deploy):
 *   EXPECTED_RELEASE_OWNER  — required owner (case-insensitive); unset → not enforced
 *   EXPECTED_RELEASE_SLUG   — required slug  (default "Tamanor"); set to "" to disable
 *   EXPECTED_RELEASE_REFS   — comma list of allowed refs (default "main"); set to "" to disable
 */
import { resolveReleaseMetadata, environmentAwarePolicy, type ProvenancePolicy, type ProvenanceEnv } from "@guardora/core";

/**
 * Tamanor defaults (slug "Tamanor", allowed ref "main", owner opt-in via env) fed into the ENVIRONMENT-AWARE
 * policy builder: repo pinning applies to production + preview, but the `main`-only ref restriction applies
 * ONLY to production / armed approved-CI — a Vercel Preview from a feature branch is validated without it.
 */
function buildPolicy(env: ProvenanceEnv): ProvenancePolicy {
  const slugRaw = env.EXPECTED_RELEASE_SLUG;
  const refsRaw = env.EXPECTED_RELEASE_REFS;
  const slug = slugRaw === undefined ? "Tamanor" : slugRaw.trim();
  const refs = refsRaw === undefined ? ["main"] : refsRaw.split(",").map((r) => r.trim()).filter(Boolean);
  return environmentAwarePolicy(env, {
    expectedOwner: env.EXPECTED_RELEASE_OWNER?.trim() || undefined,
    expectedSlug: slug || undefined,
    allowedRefs: refs,
  });
}

/** True when this build must carry valid provenance (a real deploy), regardless of NODE_ENV. */
export function mustEnforce(env: ProvenanceEnv): boolean {
  const onVercel = typeof env.VERCEL_ENV === "string" && env.VERCEL_ENV.trim() !== "";
  const ciArmed = (env.APPROVED_CI_RELEASE ?? "").trim().toLowerCase() === "true";
  return onVercel || ciArmed;
}

/** Pure evaluation (testable): returns the exit code + a safe, printable status line. */
export function evaluateGate(env: ProvenanceEnv): { code: 0 | 1; lines: string[] } {
  const m = resolveReleaseMetadata(env, buildPolicy(env));
  const shaShown = m.commitSha ?? "(none)";
  const refShown = m.commitRef ?? "(none)";
  if (!mustEnforce(env)) {
    return { code: 0, lines: [`✓ release-provenance gate: local/dev build — not enforced (source=${m.source}, sha=${shaShown})`] };
  }
  if (!m.provenanceValid) {
    return {
      code: 1,
      lines: [
        `✗ release-provenance gate: REFUSING ${m.environment} deployment build — invalid/missing release provenance.`,
        `  environment=${m.environment} source=${m.source} sha=${shaShown} ref=${refShown}`,
        `  errors=[${m.errors.join(", ")}]`,
        "  A production/preview deployment must carry a trusted Vercel Git commit SHA (or an armed approved-CI SHA).",
      ],
    };
  }
  return { code: 0, lines: [`✓ release-provenance gate: valid (source=${m.source} env=${m.environment} sha=${m.commitSha} ref=${refShown})`] };
}

// Run only when executed directly (not when imported by the test).
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMain) {
  const { code, lines } = evaluateGate(process.env as ProvenanceEnv);
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  process.exit(code);
}
