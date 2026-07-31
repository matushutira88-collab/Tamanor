/**
 * RELEASE PROVENANCE V1 — exhaustive unit tests. Pure, no I/O. Covers: valid Git deploy, valid approved-CI,
 * missing/short/malformed SHA, wrong repo, wrong ref, preview, local, malicious strings, credential URLs, and
 * no-secret-leakage (the resolver never echoes an env dump / credential-bearing URL).
 */
import {
  resolveReleaseMetadata, normalizeCommitSha, normalizeRef, normalizeDeploymentHost, classifyEnvironment,
  type ProvenanceEnv, type ProvenancePolicy,
} from "../src/release-provenance";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const SHA = "a".repeat(40); // valid full 40-char lowercase hex
const POLICY: ProvenancePolicy = { expectedOwner: "acme-org", expectedSlug: "Tamanor", allowedRefs: ["main"] };

// ---- normalizers -------------------------------------------------------------------------------------------
check("normalizeCommitSha accepts 40 lowercase hex", normalizeCommitSha(SHA) === SHA);
check("normalizeCommitSha lowercases + trims", normalizeCommitSha(`  ${"A".repeat(40)} `) === "a".repeat(40));
check("normalizeCommitSha rejects short (7)", normalizeCommitSha("abc1234") === null);
check("normalizeCommitSha rejects 41", normalizeCommitSha("a".repeat(41)) === null);
check("normalizeCommitSha rejects non-hex", normalizeCommitSha("g".repeat(40)) === null);
check("normalizeCommitSha rejects undefined", normalizeCommitSha(undefined) === null);
check("normalizeRef accepts main", normalizeRef("main") === "main");
check("normalizeRef accepts refs/heads/main", normalizeRef("refs/heads/main") === "refs/heads/main");
check("normalizeRef rejects spaces/injection", normalizeRef("main; rm -rf /") === null);
check("normalizeRef rejects newline", normalizeRef("main\nEVIL") === null);
check("normalizeDeploymentHost strips scheme+path", normalizeDeploymentHost("https://tamanor-x.vercel.app/secret?q=1") === "tamanor-x.vercel.app");
check("normalizeDeploymentHost strips credentials", normalizeDeploymentHost("https://user:pass@host.example.com/x") === "host.example.com");
check("normalizeDeploymentHost strips port", normalizeDeploymentHost("host.example.com:8443") === "host.example.com");
check("normalizeDeploymentHost rejects junk", normalizeDeploymentHost("not a host!!") === null);
check("classifyEnvironment VERCEL_ENV=production", classifyEnvironment({ VERCEL_ENV: "production" }) === "production");
check("classifyEnvironment VERCEL_ENV=preview", classifyEnvironment({ VERCEL_ENV: "preview" }) === "preview");
check("classifyEnvironment NODE_ENV=production fallback", classifyEnvironment({ NODE_ENV: "production" }) === "production");
check("classifyEnvironment empty → unknown", classifyEnvironment({}) === "unknown");

// ---- valid Git-connected production deploy -----------------------------------------------------------------
{
  const env: ProvenanceEnv = {
    VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor",
    VERCEL_DEPLOYMENT_ID: "dpl_abc123", VERCEL_URL: "tamanor-abc.vercel.app",
  };
  const m = resolveReleaseMetadata(env, POLICY);
  check("git prod: source=vercel_git", m.source === "vercel_git");
  check("git prod: full SHA", m.commitSha === SHA);
  check("git prod: ref main", m.commitRef === "main");
  check("git prod: repo owner/slug", m.repository?.owner === "acme-org" && m.repository?.slug === "Tamanor");
  check("git prod: deployment host hostname-only", m.deploymentHost === "tamanor-abc.vercel.app");
  check("git prod: provenanceValid=true", m.provenanceValid === true);
  check("git prod: no errors", m.errors.length === 0, JSON.stringify(m.errors));
}

// ---- valid approved-CI (armed) -----------------------------------------------------------------------------
{
  const env: ProvenanceEnv = {
    VERCEL_ENV: "production", APPROVED_CI_RELEASE: "true", APPROVED_CI_COMMIT_SHA: SHA,
    APPROVED_CI_COMMIT_REF: "refs/heads/main", APPROVED_CI_REPO_OWNER: "acme-org", APPROVED_CI_REPO_SLUG: "Tamanor",
  };
  const m = resolveReleaseMetadata(env, POLICY);
  check("ci: source=approved_ci", m.source === "approved_ci");
  check("ci: provenanceValid=true", m.provenanceValid === true, JSON.stringify(m.errors));
}

// ---- approved-CI arming marker WITHOUT a valid SHA → invalid -----------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production", APPROVED_CI_RELEASE: "true" }, POLICY);
  check("ci-no-sha: not valid", m.provenanceValid === false);
  check("ci-no-sha: ci_marker_without_sha error", m.errors.includes("ci_marker_without_sha"));
}

// ---- production, missing SHA (not armed, not git) → untrusted + missing ------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production" }, POLICY);
  check("prod-missing: not valid", m.provenanceValid === false);
  check("prod-missing: sha_missing", m.errors.includes("sha_missing"));
  check("prod-missing: untrusted_source", m.errors.includes("untrusted_source"));
  check("prod-missing: source=unknown", m.source === "unknown");
}

// ---- short / malformed SHA --------------------------------------------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc1234", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor" }, POLICY);
  check("short-sha: commitSha null", m.commitSha === null);
  check("short-sha: sha_malformed", m.errors.includes("sha_malformed"));
  check("short-sha: not valid", m.provenanceValid === false);
}

// ---- wrong repo -------------------------------------------------------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "evil", VERCEL_GIT_REPO_SLUG: "phish" }, POLICY);
  check("wrong-repo: repo_mismatch", m.errors.includes("repo_mismatch"));
  check("wrong-repo: not valid", m.provenanceValid === false);
}

// ---- wrong ref --------------------------------------------------------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "feature/x", VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor" }, POLICY);
  check("wrong-ref: ref_not_allowed", m.errors.includes("ref_not_allowed"));
  check("wrong-ref: not valid", m.provenanceValid === false);
}

// ---- preview deployment (valid SHA, informational preview flag) --------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor" }, POLICY);
  check("preview: preview_deployment flag", m.errors.includes("preview_deployment"));
  check("preview: still valid (trusted+sha, non-blocking flag)", m.provenanceValid === true, JSON.stringify(m.errors));
}

// ---- local / dev (no SHA) ---------------------------------------------------------------------------------
{
  const m = resolveReleaseMetadata({ NODE_ENV: "development" }, POLICY);
  check("local: source=local", m.source === "local");
  check("local: environment=development", m.environment === "development");
  check("local: no sha_missing (non-prod)", !m.errors.includes("sha_missing"));
  check("local: provenanceValid=false (no trusted SHA)", m.provenanceValid === false);
}

// ---- malicious strings + credential URL: sanitized, never echoed verbatim ----------------------------------
{
  const env: ProvenanceEnv = {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_SHA: "<script>alert(1)</script>",
    VERCEL_GIT_COMMIT_REF: "main\n$(curl evil)",
    VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor",
    VERCEL_URL: "https://user:s3cr3t@tamanor-x.vercel.app/admin?token=abc",
    VERCEL_DEPLOYMENT_ID: "dpl_../../etc/passwd",
  };
  const m = resolveReleaseMetadata(env, POLICY);
  const blob = JSON.stringify(m);
  check("malicious: SHA rejected → null", m.commitSha === null);
  check("malicious: ref rejected → null", m.commitRef === null);
  check("malicious: host is hostname-only (no creds/scheme/path)", m.deploymentHost === "tamanor-x.vercel.app");
  check("malicious: deploymentId path-traversal rejected", m.deploymentId === null);
  check("malicious: no credential in output", !/s3cr3t|token=abc|user:/.test(blob));
  check("malicious: no script/injection in output", !/<script>|curl evil|etc\/passwd/.test(blob));
  check("malicious: not valid", m.provenanceValid === false);
}

// ---- no env dump: output keys are the fixed metadata shape only --------------------------------------------
{
  const env: ProvenanceEnv = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, SECRET_TOKEN: "bearer abc.def", DATABASE_URL: "postgres://u:p@h/db", VERCEL_GIT_REPO_OWNER: "acme-org", VERCEL_GIT_REPO_SLUG: "Tamanor", VERCEL_GIT_COMMIT_REF: "main" };
  const m = resolveReleaseMetadata(env, POLICY);
  const keys = Object.keys(m).sort().join(",");
  check("no-dump: fixed key set", keys === "commitRef,commitSha,deploymentHost,deploymentId,environment,errors,provenanceValid,repository,source");
  check("no-dump: no secret value leaked", !/bearer abc|postgres:\/\//.test(JSON.stringify(m)));
  check("frozen: result is immutable", Object.isFrozen(m));
}

// ---- no policy provided: repo/ref not enforced ------------------------------------------------------------
{
  const m = resolveReleaseMetadata({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "any-branch" });
  check("no-policy: valid with any ref/repo", m.provenanceValid === true, JSON.stringify(m.errors));
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — release provenance (V1)`);
process.exit(failures === 0 ? 0 : 1);
