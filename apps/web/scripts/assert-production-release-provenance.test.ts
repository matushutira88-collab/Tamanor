/**
 * FAIL-CLOSED PROVENANCE GATE — tests. Verifies the gate's exit code + safe output across: valid Git deploy,
 * valid approved-CI, missing/short/malformed SHA, wrong repo, wrong ref, preview, local (usable), malicious
 * strings, credential URL, and no-secret-leakage. Pure — drives `evaluateGate(env)` directly.
 */
import { evaluateGate, mustEnforce } from "./assert-production-release-provenance";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const SHA = "b".repeat(40);
const out = (env: Record<string, string | undefined>) => evaluateGate(env);
const text = (env: Record<string, string | undefined>) => out(env).lines.join("\n");

// enforcement context
check("mustEnforce: Vercel production", mustEnforce({ VERCEL_ENV: "production" }) === true);
check("mustEnforce: Vercel preview", mustEnforce({ VERCEL_ENV: "preview" }) === true);
check("mustEnforce: armed CI", mustEnforce({ APPROVED_CI_RELEASE: "true" }) === true);
check("mustEnforce: local NODE_ENV=production (NOT enforced)", mustEnforce({ NODE_ENV: "production" }) === false);
check("mustEnforce: bare local", mustEnforce({}) === false);

// valid Git-connected production deploy → pass
check("valid git prod → exit 0", out({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_SLUG: "Tamanor" }).code === 0);

// valid approved-CI → pass
check("valid approved-CI → exit 0", out({ APPROVED_CI_RELEASE: "true", APPROVED_CI_COMMIT_SHA: SHA, APPROVED_CI_COMMIT_REF: "main", APPROVED_CI_REPO_SLUG: "Tamanor" }).code === 0);

// local build (NODE_ENV=production, no Vercel) → usable, exit 0
{
  const r = out({ NODE_ENV: "production" });
  check("local prod-mode build → exit 0 (usable)", r.code === 0);
  check("local build → 'not enforced' message", /not enforced/.test(r.lines.join("")));
}
check("dev build → exit 0", out({ NODE_ENV: "development" }).code === 0);

// missing SHA on real deploy → fail closed
check("prod missing SHA → exit 1", out({ VERCEL_ENV: "production" }).code === 1);
// short / malformed SHA → fail closed
check("prod short SHA → exit 1", out({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc1234", VERCEL_GIT_REPO_SLUG: "Tamanor", VERCEL_GIT_COMMIT_REF: "main" }).code === 1);
// armed CI without SHA → fail closed
check("armed CI, no SHA → exit 1", out({ APPROVED_CI_RELEASE: "true" }).code === 1);
// wrong ref → fail closed (default allowed = main)
check("prod wrong ref → exit 1", out({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "feature/x", VERCEL_GIT_REPO_SLUG: "Tamanor" }).code === 1);
// wrong slug (default expected = Tamanor) → fail closed
check("prod wrong slug → exit 1", out({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_SLUG: "evil" }).code === 1);
// wrong owner when owner pinned → fail closed
check("prod wrong owner (pinned) → exit 1", out({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_SLUG: "Tamanor", VERCEL_GIT_REPO_OWNER: "evil", EXPECTED_RELEASE_OWNER: "acme-org" }).code === 1);
// preview with valid git provenance → pass (enforced but valid)
check("preview valid → exit 0", out({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_SLUG: "Tamanor" }).code === 0);

// malicious strings + credential URL → fail closed AND never echoed
{
  const env = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "<script>", VERCEL_GIT_COMMIT_REF: "main\n$(x)", VERCEL_URL: "https://user:s3cr3t@h.vercel.app/a?token=abc", VERCEL_GIT_REPO_SLUG: "Tamanor" };
  const t = text(env);
  check("malicious → exit 1", out(env).code === 1);
  check("malicious → no credential/script echoed", !/s3cr3t|token=abc|<script>|\$\(x\)/.test(t), t);
}
// no secret leakage: secret-shaped env vars never appear in output
{
  const env = { VERCEL_ENV: "production", SECRET_TOKEN: "bearer abc.def", DATABASE_URL: "postgres://u:p@h/db", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_SLUG: "Tamanor" };
  check("no-leak: secrets absent from output", !/bearer abc|postgres:\/\//.test(text(env)));
}
// disabling policy via empty env vars still passes core SHA requirement
check("policy disabled (empty slug/refs) still needs valid SHA", out({ VERCEL_ENV: "production", EXPECTED_RELEASE_SLUG: "", EXPECTED_RELEASE_REFS: "", VERCEL_GIT_COMMIT_SHA: SHA }).code === 0);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — release-provenance gate`);
process.exit(failures === 0 ? 0 : 1);
