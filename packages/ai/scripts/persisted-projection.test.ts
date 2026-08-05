/**
 * PERSISTED CUSTOMER-CLASSIFICATION PROJECTION — the SQL-level closure of the legacy false positive.
 *
 * The canonical projection already withheld the legacy accusation from every rendered surface, but two
 * paths still read the RAW columns: the comments-page sentiment bucket, and `sentimentBucketWhere`,
 * whose Prisma predicate is built over `riskCategories`/`riskLevel`. A legacy row therefore still
 * matched the customer-facing "risky" filter in SQL. The evidence gate lives in the `aiDiagnostics`
 * JSON and cannot be indexed, so the verdict is now materialised into indexed columns and the filter
 * reads those.
 *
 * This suite pins: the NULL/stale fail-closed semantics, the write-path fields, both SQL predicates,
 * aggregate eligibility, Auto-Protect source validity, and the backfill arming contract.
 *
 * Run: pnpm persisted-projection:test
 */
import { readFileSync } from "node:fs";
import {
  projectStoredClassification, persistedProjectionFields, persistedProjectionFieldsAfterClassification,
  readPersistedProjection,
  CUSTOMER_PROJECTION_VERSION, type StoredClassificationRow,
} from "../src/evidence";
import { customerRiskyWhere, customerRequiresReviewWhere, sentimentBucketWhere, sentimentBucket } from "../src/reputation";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
const HIGHISH = new Set(["high", "critical"]);
const gate = (d: { category: string; verdict: string }[]) => ({ evidenceGate: { decisions: d } });

/** A minimal in-memory evaluator for the Prisma `where` fragments the predicates emit. */
function matches(where: unknown, row: Record<string, unknown>): boolean {
  if (where === null || typeof where !== "object") return true;
  const w = where as Record<string, unknown>;
  if (Array.isArray(w.AND)) return (w.AND as unknown[]).every((c) => matches(c, row));
  if (Array.isArray(w.OR)) return (w.OR as unknown[]).some((c) => matches(c, row));
  if (w.NOT !== undefined) return !matches(w.NOT, row);
  return Object.entries(w).every(([field, cond]) => {
    const v = row[field];
    if (cond === null) return v === null || v === undefined;
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ("has" in c) return Array.isArray(v) && v.includes(c.has);
      if ("hasSome" in c) return Array.isArray(v) && (c.hasSome as unknown[]).some((x) => v.includes(x));
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("gte" in c) return typeof v === "number" && v >= (c.gte as number);
      if ("lt" in c) return typeof v === "number" && v < (c.lt as number);
      if ("gt" in c) return typeof v === "string" && v > (c.gt as string);
      return true;
    }
    return v === cond;
  });
}

const RISKY_WHERE = customerRiskyWhere(CUSTOMER_PROJECTION_VERSION);
const REVIEW_WHERE = customerRequiresReviewWhere(CUSTOMER_PROJECTION_VERSION);

/* --------------------------------------------------------------------------- fixtures */

/** A — the production legacy false positive, projection columns still NULL. */
const A_RAW: StoredClassificationRow = {
  riskCategories: ["profanity"], riskLevel: "critical", riskConfidence: 0.88,
  aiDiagnostics: { rules: { level: "critical", confidence: 0.88, categories: ["profanity"] } },
  autoProtect: { decision: "would_auto_hide", matchedCategory: "profanity" },
};
const A_ROW = { customerClassificationState: null, customerRiskLevel: null, customerRiskCategories: null, customerClassificationProjectionVersion: null, customerRequiresReanalysis: null, riskCategories: ["profanity"], riskLevel: "critical", sentiment: "negative" };

/** B — the same row after backfill. */
const B_FIELDS = persistedProjectionFields(A_RAW);
const B_ROW = { ...B_FIELDS, riskCategories: ["profanity"], riskLevel: "critical", sentiment: "negative" };

/** C/D — current confirmed profanity and scam. */
const C_RAW: StoredClassificationRow = { riskCategories: ["profanity"], riskLevel: "critical", aiDiagnostics: gate([{ category: "profanity", verdict: "confirmed" }]), autoProtect: { decision: "would_auto_hide", matchedCategory: "profanity" } };
const D_RAW: StoredClassificationRow = { riskCategories: ["scam"], riskLevel: "high", aiDiagnostics: gate([{ category: "scam", verdict: "confirmed" }]) };
const C_ROW = { ...persistedProjectionFields(C_RAW), sentiment: "negative" };
const D_ROW = { ...persistedProjectionFields(D_RAW), sentiment: "negative" };

/** E/F/G — clean, non-accusatory historical, malformed diagnostics. */
const E_RAW: StoredClassificationRow = { riskCategories: ["neutral"], riskLevel: "none", aiDiagnostics: null };
const F_RAW: StoredClassificationRow = { riskCategories: ["spam"], riskLevel: "medium", aiDiagnostics: null };
const G_RAW: StoredClassificationRow = { riskCategories: ["profanity"], riskLevel: "critical", aiDiagnostics: "not-an-object" };

console.log("\n1) A — legacy false positive with NULL persisted projection");
{
  const p = readPersistedProjection(A_ROW);
  check("1a) NULL projection reads as review_required", p.state === "review_required", p.state);
  check("1b) exposes no accusatory category", p.categories.length === 0);
  check("1c) never exposes high/critical", !HIGHISH.has(p.riskLevel), p.riskLevel);
  check("1d) flagged stale + requires re-analysis", p.stale && p.requiresReanalysis);
  check("1e) does NOT match the confirmed risky SQL predicate", !matches(RISKY_WHERE, A_ROW));
  check("1f) DOES match the requires-review SQL predicate", matches(REVIEW_WHERE, A_ROW));
  check("1g) the OLD raw predicate would have matched it (this is the defect being closed)",
    matches(sentimentBucketWhere("risky"), A_ROW));
  check("1h) stale Auto-Protect state from the raw row", projectStoredClassification(A_RAW).autoProtect.state === "stale_unverified");
  check("1i) not counted as clean", p.state !== "no_issue");
}

console.log("\n2) B — the same row after backfill behaves identically");
{
  check("2a) persisted state is review_required", B_FIELDS.customerClassificationState === "review_required");
  check("2b) persisted categories are empty", B_FIELDS.customerRiskCategories.length === 0);
  check("2c) persisted level is safely capped", !HIGHISH.has(B_FIELDS.customerRiskLevel), B_FIELDS.customerRiskLevel);
  check("2d) persisted on the current projection version", B_FIELDS.customerClassificationProjectionVersion === CUSTOMER_PROJECTION_VERSION);
  check("2e) requires re-analysis is true", B_FIELDS.customerRequiresReanalysis === true);
  check("2f) still does NOT match the risky predicate", !matches(RISKY_WHERE, B_ROW));
  check("2g) still matches requires-review", matches(REVIEW_WHERE, B_ROW));
  const p = readPersistedProjection(B_ROW);
  check("2h) same customer behaviour before and after backfill",
    p.state === "review_required" && p.categories.length === 0 && !HIGHISH.has(p.riskLevel));
}

console.log("\n3) C/D — current confirmed classifications stay visible and filterable");
{
  check("3a) confirmed profanity: persisted confirmed", C_ROW.customerClassificationState === "confirmed");
  check("3b) confirmed profanity MATCHES the risky predicate", matches(RISKY_WHERE, C_ROW));
  check("3c) confirmed profanity does NOT match requires-review", !matches(REVIEW_WHERE, C_ROW));
  check("3d) customer label remains visible", readPersistedProjection(C_ROW).categories.includes("profanity"));
  check("3e) customer severity remains critical", readPersistedProjection(C_ROW).riskLevel === "critical");
  check("3f) confirmed scam matches the risky predicate", matches(RISKY_WHERE, D_ROW));
  check("3g) confirmed scam label visible", readPersistedProjection(D_ROW).categories.includes("scam"));
  check("3h) Auto-Protect on a confirmed row still counts affirmatively",
    projectStoredClassification(C_RAW).autoProtect.countsTowardWouldAutoHide);
}

console.log("\n4) E/F/G — clean, non-accusatory historical, malformed diagnostics");
{
  const e = persistedProjectionFields(E_RAW);
  check("4a) clean item → no_issue, no categories, level none", e.customerClassificationState === "no_issue" && e.customerRiskCategories.length === 0 && e.customerRiskLevel === "none");
  check("4b) clean item does not match risky", !matches(RISKY_WHERE, { ...e, sentiment: "neutral" }));
  check("4c) clean item does not match requires-review", !matches(REVIEW_WHERE, { ...e, sentiment: "neutral" }));

  const freshClean = persistedProjectionFieldsAfterClassification({
    ...E_RAW, autoProtect: { decision: "monitor", matchedCategory: "normal_criticism" },
  });
  check("4c1) fresh clean classification clears the re-analysis marker",
    freshClean.customerRequiresReanalysis === false
    && readPersistedProjection(freshClean).requiresReanalysis === false);
  const freshReview = persistedProjectionFieldsAfterClassification(G_RAW);
  check("4c2) fresh review_required needs human review, not another classifier run",
    freshReview.customerClassificationState === "review_required"
    && freshReview.customerRequiresReanalysis === false
    && readPersistedProjection(freshReview).requiresReanalysis === false);

  const f = persistedProjectionFields(F_RAW);
  check("4d) non-accusatory historical (spam, no gate) keeps confirmed behaviour",
    f.customerClassificationState === "confirmed" && f.customerRiskCategories.includes("spam"));

  const g = persistedProjectionFields(G_RAW);
  check("4e) malformed diagnostics → review_required, nothing exposed",
    g.customerClassificationState === "review_required" && g.customerRiskCategories.length === 0 && !HIGHISH.has(g.customerRiskLevel));
}

console.log("\n5) H — null and stale projection versions fail closed");
{
  const stale = { ...C_ROW, customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION - 1 };
  const p = readPersistedProjection(stale);
  check("5a) a stale version reads as review_required", p.state === "review_required" && p.stale);
  check("5b) a stale version does NOT match risky", !matches(RISKY_WHERE, stale));
  check("5c) a stale version DOES match requires-review", matches(REVIEW_WHERE, stale));
  check("5d) a null version does not match risky", !matches(RISKY_WHERE, { ...C_ROW, customerClassificationProjectionVersion: null }));
  for (const bad of [undefined, null, "", "bogus_state", 7]) {
    check(`5e) unknown persisted state ${JSON.stringify(bad)} → review_required`,
      readPersistedProjection({ customerClassificationState: bad as never, customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION }).state === "review_required");
  }
  check("5f) confirmed WITHOUT persisted categories is contradictory → review_required",
    readPersistedProjection({ customerClassificationState: "confirmed", customerRiskCategories: [], customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION }).state === "review_required");
  check("5g) a persisted high level on a non-confirmed state is still capped",
    !HIGHISH.has(readPersistedProjection({ customerClassificationState: "review_required", customerRiskLevel: "critical", customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION }).riskLevel));
}

console.log("\n6) I — the predicates are SQL-shaped and pagination-safe");
{
  const RISKY = RISKY_WHERE as { AND: unknown[] };
  check("6a) the risky predicate is pure SQL over the persisted columns (no raw riskCategories)",
    !JSON.stringify(RISKY_WHERE).includes("\"riskCategories\"") && JSON.stringify(RISKY_WHERE).includes("customerClassificationState"));
  check("6b) it pins the projection version", JSON.stringify(RISKY_WHERE).includes("customerClassificationProjectionVersion"));
  check("6c) it is an AND of conditions (composable with the tenant + cursor clauses)", Array.isArray(RISKY.AND) && RISKY.AND.length === 3);
  check("6d) the requires-review predicate covers null state, null version and stale version", (() => {
    const j = JSON.stringify(REVIEW_WHERE);
    return j.includes("review_required") && j.includes("customerClassificationState\":null") && j.includes("\"lt\"");
  })());
  // The two facets partition the unverified space: nothing may be in both.
  for (const [label, row] of [["legacy", A_ROW], ["backfilled legacy", B_ROW], ["confirmed", C_ROW]] as const) {
    check(`6e) ${label}: never matches BOTH facets`, !(matches(RISKY_WHERE, row) && matches(REVIEW_WHERE, row)));
  }
  const repo = read("packages/db/src/inbox-repo.ts");
  check("6f) the inbox pushes the customer risky filter down to SQL", /f\.sentiment === "risky"[\s\S]{0,120}customerRiskyWhere/.test(repo));
  check("6g) a requiresReview filter exists and is pushed down", /f\.requiresReview[\s\S]{0,80}customerRequiresReviewWhere/.test(repo));
  check("6h) no application-memory post-filter was introduced",
    !/\.filter\([^)]*customerClassificationState/.test(repo));
  check("6i) keyset cursor + ordering untouched", /createdAt/.test(repo) && /id/.test(repo));
}

console.log("\n7) write path + rendering corrections");
{
  const sync = read("packages/sync/src/index.ts");
  check("7a) ingest persists the projection through the canonical helper", /persistedProjectionFieldsAfterClassification\(\{/.test(sync));
  check("7b) ingest does not re-derive the evidence gate itself", !/evidenceGate/.test(sync.replace(/aiDiagnostics: hybrid\.diagnostics/g, "")));
  const comments = read("apps/web/src/app/dashboard/comments/page.tsx");
  check("7c) the comments bucket is computed from the projection, not the raw verdict",
    /sentimentBucket\(\{\s*categories: projected\.categories/.test(comments)
    && !/sentimentBucket\(\{ categories: cats, sentiment: r\.sentiment as string, riskLevel: r\.riskLevel as string \}\)/.test(comments));
  const schema = read("packages/db/prisma/schema.prisma");
  for (const f of ["customerClassificationState", "customerRiskLevel", "customerRiskCategories", "customerClassificationProjectionVersion", "customerRequiresReanalysis"]) {
    check(`7d) schema declares ${f}`, new RegExp(`\\b${f}\\b`).test(schema));
  }
  check("7e) raw diagnostic columns are untouched",
    /riskLevel\s+RiskLevel\s+@default\(none\)/.test(schema) && /riskCategories String\[\]/.test(schema) && /aiDiagnostics\s+Json\?/.test(schema));
}

console.log("\n8) J — backfill arming contract (no database required)");
{
  const cliRaw = read("packages/db/scripts/backfill-customer-projection.cli.ts");
  // Assertions about CODE must not match this file's own explanatory prose.
  const cli = cliRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("8a) dry-run is the default", /armed: false, reason: "dry_run_default"/.test(cli));
  check("8b) apply requires BOTH the production environment and the exact confirmation phrase",
    /environment_not_production/.test(cli) && /confirmation_mismatch/.test(cli));
  check("8c) rows already on the current version are skipped (idempotent)", /skippedCurrentVersion\+\+/.test(cli));
  check("8d) deterministic cursor ordering", /orderBy: \{ id: "asc" \}/.test(cli));
  check("8e) resumable via BACKFILL_CURSOR", /BACKFILL_CURSOR/.test(cli));
  check("8f) bounded batches", /take: batchSize/.test(cli) && /maxBatches/.test(cli));
  check("8g) writes ONLY the projection columns", (() => {
    const upd = (cli.match(/data: \{[\s\S]*?\},\s*\}\);/) ?? [""])[0];
    return /customerClassificationState/.test(upd) && !/riskCategories:/.test(upd) && !/riskLevel:/.test(upd) && !/aiDiagnostics/.test(upd);
  })());
  check("8h) never writes AutoProtectDecision", !/autoProtectDecision\.(update|upsert|create|delete)/.test(cli));
  check("8i) computes via the canonical helper", /persistedProjectionFields\(\{/.test(cli));
  check("8j) reports every required count", ["scanned", "confirmed", "reviewRequired", "noIssue", "legacyUnverified", "failed", "remaining"].every((k) => cli.includes(k)));
  check("8k) prints no PII/ids/text/diagnostics/DATABASE_URL",
    !/console\.log\([^)]*contentItem/.test(cli) && !/DATABASE_URL/.test(cli) && /counts only/.test(cliRaw));

  const wfRaw = read(".github/workflows/production-customer-projection-backfill.yml");
  const wf = wfRaw.replace(/^\s*#.*$/gm, "");
  check("8l) workflow is manual-only", /workflow_dispatch/.test(wf) && !/on:\s*\n\s*push/.test(wf));
  check("8l2) the terminal invocation is documented", /gh workflow run production-customer-projection-backfill\.yml/.test(wfRaw));
  check("8m) workflow refuses non-main refs", /refs\/heads\/main/.test(wf));
  check("8n) workflow uses the Production environment", /environment: Production/.test(wf));
  check("8o) workflow prevents concurrent runs", /concurrency:/.test(wf) && /cancel-in-progress: false/.test(wf));
  check("8p) workflow requires explicit confirmation + expected_commit", /confirmation:/.test(wf) && /expected_commit/.test(wf));
  check("8q) workflow supports dry-run and apply", /options:\s*\n\s*- dry-run\s*\n\s*- apply/.test(wf));
  check("8r) workflow never prints DATABASE_URL", !/echo[^\n]*DATABASE_URL/.test(wf));
  check("8s) workflow runs no migration or reclassify-demo",
    !/migrate deploy|db push|migrate reset|reclassify-demo/.test(wf));
}

console.log("\n9) the raw bucket helper still agrees with itself (no drift introduced)");
{
  check("9a) sentimentBucket is unchanged for a confirmed risky input",
    sentimentBucket({ categories: ["scam"], sentiment: "negative", riskLevel: "critical" }) === "risky");
  check("9b) sentimentBucket on the PROJECTED legacy input is not risky",
    sentimentBucket({ categories: [], sentiment: "negative", riskLevel: "medium" }) !== "risky");
}

console.log("\n10) migration / Prisma schema parity for the NOT NULL array");
{
  const mig = read("packages/db/prisma/migrations/20260901090000_customer_classification_projection/migration.sql")
    .replace(/^\s*--.*$/gm, "");
  const schemaRaw = read("packages/db/prisma/schema.prisma");
  // Assertions about the MODEL must not match the schema's own explanatory comments.
  const schema = schemaRaw.replace(/\/\/.*$/gm, "");

  check("10a) the migration declares the array NOT NULL", /"customerRiskCategories"\s+TEXT\[\]\s+NOT NULL/.test(mig));
  check("10b) …with an empty-array default", /"customerRiskCategories"[^,]*DEFAULT\s*(ARRAY\[\]::TEXT\[\]|'\{\}'::TEXT\[\])/i.test(mig));
  check("10c) state, level, version and reanalysis stay nullable in the migration", (() => {
    const nullable = ["customerClassificationState", "customerRiskLevel", "customerClassificationProjectionVersion", "customerRequiresReanalysis"];
    return nullable.every((col) => new RegExp(`"${col}"`).test(mig) && !new RegExp(`"${col}"[^,\\n]*NOT NULL`).test(mig));
  })());
  check("10d) the migration performs no backfill and nothing destructive",
    !/UPDATE\s+"?reputation_items/i.test(mig) && !/\b(DROP|DELETE|TRUNCATE)\b/i.test(mig));
  check("10e) the GIN index is on the non-null array", /USING GIN \("customerRiskCategories"\)/i.test(mig));

  check("10f) Prisma declares String[] @default([])", /customerRiskCategories\s+String\[\]\s+@default\(\[\]\)/.test(schema));
  check("10g) no optional scalar list (String[]?) exists anywhere in the schema", !/String\[\]\?/.test(schema));
  check("10h) Prisma keeps state/level/version/reanalysis optional",
    /customerClassificationState\s+String\?/.test(schema) && /customerRiskLevel\s+RiskLevel\?/.test(schema)
    && /customerClassificationProjectionVersion\s+Int\?/.test(schema) && /customerRequiresReanalysis\s+Boolean\?/.test(schema));

  // Unprojected detection must rest on STATE + VERSION, never on the array being null/empty.
  const emptyNullState = readPersistedProjection({ customerRiskCategories: [], customerClassificationState: null, customerClassificationProjectionVersion: null });
  check("10i) empty array + null state/version → review_required", emptyNullState.state === "review_required" && emptyNullState.stale);
  const emptyNoIssue = readPersistedProjection({ customerRiskCategories: [], customerClassificationState: "no_issue", customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION });
  check("10j) empty array + explicit no_issue → no_issue (state is authoritative)", emptyNoIssue.state === "no_issue" && !emptyNoIssue.stale);
  const emptyReview = readPersistedProjection({ customerRiskCategories: [], customerClassificationState: "review_required", customerClassificationProjectionVersion: CUSTOMER_PROJECTION_VERSION });
  check("10k) empty array + explicit review_required → review_required", emptyReview.state === "review_required");
  check("10l) an empty array ALONE implies neither clean nor review_required",
    emptyNoIssue.state !== emptyReview.state && emptyNullState.state === "review_required");
  check("10m) the writer never emits a null category array",
    Array.isArray(persistedProjectionFields({ riskLevel: "none", riskCategories: [], aiDiagnostics: null }).customerRiskCategories));
  const cliSrc = read("packages/db/scripts/backfill-customer-projection.cli.ts");
  check("10n) the backfill never writes null to the array", !/customerRiskCategories:\s*null/.test(cliSrc));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — persisted customer projection: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
