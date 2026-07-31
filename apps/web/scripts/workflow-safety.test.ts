/**
 * WORKFLOW SAFETY GATE — static checks over .github/workflows. Enforces: every `uses:` is pinned to a 40-hex
 * commit SHA (no floating tags); every workflow declares a least-privilege `permissions:` block; every
 * production-mutating workflow is workflow_dispatch-only, bound to a protected Environment, and serialized by a
 * `concurrency:` group; and the sanctioned production-deploy workflow neither runs migrations nor cron calls.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const WF = resolve(process.cwd(), "../../.github/workflows");
check("workflows dir exists", existsSync(WF), WF);
const files = existsSync(WF) ? readdirSync(WF).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")) : [];
check("at least the CI + deploy workflows are present", files.length >= 2, files.join(", "));

// Documented exceptions to SHA-pinning (narrow; none today). Add repo names here ONLY with review.
const PIN_EXCEPTIONS: string[] = [];

for (const f of files) {
  const s = readFileSync(join(WF, f), "utf8");
  const usesLines = s.split("\n").map((l, i) => ({ l: l.trim(), i })).filter((x) => /^-?\s*uses:\s*\S+/.test(x.l));
  // 1) every `uses:` pinned to a full 40-hex SHA (unless an explicit documented exception)
  for (const u of usesLines) {
    const m = u.l.match(/uses:\s*([^\s@]+)@(\S+)/);
    const repo = m?.[1] ?? "?"; const rev = m?.[2] ?? "";
    const pinned = /^[0-9a-f]{40}$/.test(rev) || PIN_EXCEPTIONS.includes(repo);
    check(`${f}: '${repo}' pinned to SHA`, pinned, `got @${rev}`);
  }
  // 2) least-privilege permissions block present
  check(`${f}: declares a permissions block`, /^permissions:/m.test(s));
}

// 3) production-mutating workflows: dispatch-only + Environment + concurrency
const prodFiles = files.filter((f) => /^production-/.test(f) || f === "platform-owner-bootstrap.yml");
check("found production-mutating workflows to check", prodFiles.length >= 3, prodFiles.join(", "));
for (const f of prodFiles) {
  const s = readFileSync(join(WF, f), "utf8");
  check(`${f}: workflow_dispatch present`, /on:\s*[\s\S]*workflow_dispatch:/.test(s));
  check(`${f}: no push/pull_request trigger`, !/^\s*(push|pull_request):/m.test(s), "must be dispatch-only");
  check(`${f}: bound to an Environment`, /^\s*environment:\s*(Production|production)\s*$/m.test(s));
  check(`${f}: has a concurrency group`, /^concurrency:/m.test(s));
}

// 4) sanctioned deploy workflow exists and does NOT run migrations / cron calls automatically
{
  const dp = join(WF, "production-deploy.yml");
  check("production-deploy.yml exists", existsSync(dp));
  if (existsSync(dp)) {
    const s = readFileSync(dp, "utf8");
    check("deploy: workflow_dispatch-only", /workflow_dispatch:/.test(s) && !/^\s*(push|pull_request):/m.test(s));
    check("deploy: confirmation phrase input", /DEPLOY_APPROVED_PRODUCTION_RELEASE/.test(s));
    check("deploy: requires 40-hex SHA input validation", /\[0-9a-f\]\{40\}/.test(s));
    check("deploy: verifies ancestor of origin/main", /merge-base --is-ancestor/.test(s));
    check("deploy: prebuilt deploy", /deploy --prebuilt --prod/.test(s));
    check("deploy: does NOT run prisma migrate", !/prisma\s+migrate|migrate\s+deploy/.test(s));
    check("deploy: does NOT call a cron endpoint", !/\/api\/internal\/cron|curl[^\n]*cron/.test(s));
    check("deploy: references only secret NAMES (VERCEL_TOKEN/ORG/PROJECT)", /secrets\.VERCEL_TOKEN/.test(s) && /secrets\.VERCEL_ORG_ID/.test(s) && /secrets\.VERCEL_PROJECT_ID/.test(s));
    check("deploy: least-privilege permissions (contents: read)", /permissions:\s*[\s\S]*contents:\s*read/.test(s));
  }
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — workflow safety`);
process.exit(failures === 0 ? 0 : 1);
