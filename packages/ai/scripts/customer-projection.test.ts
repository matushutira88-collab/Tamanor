/**
 * CUSTOMER-VISIBLE CLASSIFICATION PROJECTION — cross-surface consistency guard.
 *
 * The evidence gate was correct but only `/dashboard/comments` consulted it. Every other customer
 * surface read `riskCategories`, `riskLevel` and `AutoProtectDecision` raw, so the legacy false
 * positive still rendered as "Vulgarizmy / Kritické / would auto-hide" on the item detail page and
 * still counted toward confirmed profanity, risky, critical and would_auto_hide totals.
 *
 * `projectStoredClassification` is now the ONE interpretation. This suite pins its behaviour and adds
 * a change detector so a new surface cannot reintroduce a raw read.
 *
 * Run: pnpm customer-projection:test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  projectStoredClassification, tallyProjected, readEvidenceGateDecisions,
  customerClassificationDisplay, customerVisibleRiskLevel, isLegacyUnverifiedVerdict,
  EVIDENCE_REQUIRED_CATEGORIES, type StoredClassificationRow,
} from "../src/evidence";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
const HIGHISH = new Set(["high", "critical"]);

/** THE exact production legacy row. Permanent fixture. */
const LEGACY: StoredClassificationRow = {
  riskCategories: ["profanity"],
  riskLevel: "critical",
  riskConfidence: 0.88,
  aiDiagnostics: { callMode: "value_gated", rules: { level: "critical", confidence: 0.88, categories: ["profanity"] } }, // no evidenceGate
  autoProtect: { decision: "would_auto_hide", matchedCategory: "profanity" },
};

const gate = (decisions: { category: string; verdict: string }[]) => ({ evidenceGate: { decisions } });

console.log("\n1) the legacy fixture, across every customer surface");
{
  const v = projectStoredClassification(LEGACY);
  check("1a) state is review_required", v.state === "review_required", v.state);
  check("1b) no profanity label is exposed", v.categories.length === 0 && !JSON.stringify(v.categories).includes("profanity"));
  check("1c) no critical customer severity", !HIGHISH.has(v.riskLevel), v.riskLevel);
  check("1d) flagged legacy/unverified", v.legacyUnverified && v.requiresReview);
  check("1e) EXCLUDED from confirmed category totals", !v.eligibleForCategoryTotals);
  check("1f) EXCLUDED from confirmed high/critical totals", !v.eligibleForSeverityTotals);
  check("1g) Auto-Protect is stale_unverified, decision + category withheld",
    v.autoProtect.state === "stale_unverified" && v.autoProtect.decision === null && v.autoProtect.matchedCategory === null,
    JSON.stringify(v.autoProtect));
  check("1h) no affirmative would_auto_hide representation", !v.autoProtect.countsTowardWouldAutoHide);
  check("1i) marked as requiring re-analysis", v.autoProtect.requiresReanalysis);
  check("1j) raw stored values remain available for ADMIN diagnostics only",
    v.stored.riskLevel === "critical" && v.stored.categories[0] === "profanity"
    && v.stored.autoProtectDecision === "would_auto_hide" && v.stored.matchedCategory === "profanity");
  check("1k) it is NOT counted as clean/no_issue", v.state !== "no_issue");
}

console.log("\n2) aggregate integrity — excluded from confirmed totals, visible as requires-review");
{
  const CONFIRMED_PROF: StoredClassificationRow = { riskLevel: "critical", riskCategories: ["profanity"], aiDiagnostics: gate([{ category: "profanity", verdict: "confirmed" }]), autoProtect: { decision: "would_auto_hide", matchedCategory: "profanity" } };
  const CONFIRMED_SCAM: StoredClassificationRow = { riskLevel: "critical", riskCategories: ["scam"], aiDiagnostics: gate([{ category: "scam", verdict: "confirmed" }]) };
  const CLEAN: StoredClassificationRow = { riskLevel: "none", riskCategories: ["neutral"], aiDiagnostics: gate([{ category: "neutral", verdict: "confirmed" }]) };
  const DESCRIPTIVE: StoredClassificationRow = { riskLevel: "medium", riskCategories: ["spam"], aiDiagnostics: null };

  const t = tallyProjected([LEGACY, CONFIRMED_PROF, CONFIRMED_SCAM, CLEAN, DESCRIPTIVE]);
  check("2a) confirmed profanity total counts only the evidenced row", t.confirmed.get("profanity") === 1, String(t.confirmed.get("profanity")));
  check("2b) confirmed scam total counts only the evidenced row", t.confirmed.get("scam") === 1, String(t.confirmed.get("scam")));
  check("2c) confirmed high/critical total excludes the legacy row", t.confirmedHighOrCritical === 2, String(t.confirmedHighOrCritical));
  check("2d) the legacy row appears in the requires-review bucket", t.requiresReview === 1, String(t.requiresReview));
  check("2e) the legacy row appears in the legacy-unverified bucket", t.legacyUnverified === 1, String(t.legacyUnverified));
  check("2f) nothing is silently dropped", t.total === 5);
  check("2g) confirmed Auto-Protect totals exclude the stale decision",
    [LEGACY, CONFIRMED_PROF].filter((r) => projectStoredClassification(r).autoProtect.countsTowardWouldAutoHide).length === 1);
}


console.log("\n2b) fresh no-issue Auto-Protect replacement stays current and non-affirmative");
{
  const current = projectStoredClassification({
    riskLevel: "none", riskCategories: [], aiDiagnostics: null,
    autoProtect: { decision: "monitor", matchedCategory: "normal_criticism" },
  });
  check("2h) current no-issue monitor is not stale",
    current.state === "no_issue" && current.autoProtect.state === "confirmed"
    && !current.autoProtect.requiresReanalysis && !current.autoProtect.countsTowardWouldAutoHide);
  const impossible = projectStoredClassification({
    riskLevel: "none", riskCategories: [], aiDiagnostics: null,
    autoProtect: { decision: "would_auto_hide", matchedCategory: "profanity" },
  });
  check("2i) affirmative no-issue decision still fails closed",
    impossible.autoProtect.state === "stale_unverified" && impossible.autoProtect.decision === null);
}

console.log("\n3) the full verdict matrix");
{
  const cases: [string, StoredClassificationRow, "confirmed" | "review_required" | "no_issue"][] = [
    ["current confirmed profanity", { riskLevel: "critical", riskCategories: ["profanity"], aiDiagnostics: gate([{ category: "profanity", verdict: "confirmed" }]) }, "confirmed"],
    ["current confirmed scam", { riskLevel: "high", riskCategories: ["scam"], aiDiagnostics: gate([{ category: "scam", verdict: "confirmed" }]) }, "confirmed"],
    ["current review_required", { riskLevel: "none", riskCategories: ["neutral"], aiDiagnostics: gate([{ category: "profanity", verdict: "review_required" }]) }, "review_required"],
    ["non-accusatory historical (spam, no gate)", { riskLevel: "medium", riskCategories: ["spam"], aiDiagnostics: null }, "confirmed"],
    ["clean item", { riskLevel: "none", riskCategories: ["neutral"], aiDiagnostics: null }, "no_issue"],
    ["legacy scam, no gate", { riskLevel: "critical", riskCategories: ["scam"], aiDiagnostics: null }, "review_required"],
    ["empty evidenceGate", { riskLevel: "critical", riskCategories: ["profanity"], aiDiagnostics: gate([]) }, "review_required"],
    ["gate confirms a DIFFERENT category", { riskLevel: "critical", riskCategories: ["profanity"], aiDiagnostics: gate([{ category: "spam", verdict: "confirmed" }]) }, "review_required"],
    ["mixed confirmed + review_required", { riskLevel: "critical", riskCategories: ["spam", "profanity"], aiDiagnostics: gate([{ category: "spam", verdict: "confirmed" }, { category: "profanity", verdict: "review_required" }]) }, "review_required"],
  ];
  for (const [label, row, expected] of cases) {
    const v = projectStoredClassification(row);
    check(`3) ${label} → ${expected}`, v.state === expected, v.state);
  }
  const mixed = projectStoredClassification(cases[8]![1]);
  check("3z) a mixed row withholds BOTH categories (fact is never mixed with suspicion)",
    mixed.categories.length === 0 && !mixed.eligibleForCategoryTotals);
}

console.log("\n4) malformed diagnostics fail CLOSED");
{
  for (const bad of [undefined, null, "string", 42, [], {}, { evidenceGate: null }, { evidenceGate: "x" }, { evidenceGate: { decisions: "x" } }, { evidenceGate: { decisions: [null, 1, {}] } }, { evidenceGate: { decisions: [{ category: 3, verdict: "confirmed" }] } }]) {
    check(`4a) malformed diagnostics ${JSON.stringify(bad)?.slice(0, 30)} → no decisions`, readEvidenceGateDecisions(bad).length === 0);
    check(`4b) …and an accusatory row with it → review_required`,
      projectStoredClassification({ riskLevel: "critical", riskCategories: ["profanity"], aiDiagnostics: bad }).state === "review_required");
  }
  check("4c) a well-formed gate still parses", readEvidenceGateDecisions(gate([{ category: "profanity", verdict: "confirmed" }])).length === 1);
}

console.log("\n5) the projection reuses the existing helpers (no parallel concepts)");
{
  const v = projectStoredClassification(LEGACY);
  const d = customerClassificationDisplay(LEGACY.riskCategories!, readEvidenceGateDecisions(LEGACY.aiDiagnostics));
  check("5a) state agrees with customerClassificationDisplay", (d.kind === "review_required") === (v.state === "review_required"));
  check("5b) level agrees with customerVisibleRiskLevel", v.riskLevel === customerVisibleRiskLevel(LEGACY.riskLevel, d));
  check("5c) legacy flag agrees with isLegacyUnverifiedVerdict",
    v.legacyUnverified === isLegacyUnverifiedVerdict(LEGACY.riskCategories!, readEvidenceGateDecisions(LEGACY.aiDiagnostics)));
  check("5d) profanity is still an evidence-gated category", EVIDENCE_REQUIRED_CATEGORIES.has("profanity"));
}

console.log("\n6) SK/EN/DE copy for the new customer-visible states");
{
  const KEYS = ["reviewRequired", "reanalysisRequired", "staleExplain", "mStale"] as const;
  for (const loc of ["en", "sk", "de"] as const) {
    const src = read(`apps/web/src/i18n/dictionaries/${loc}.ts`);
    check(`6a) ${loc}: every new Auto-Protect key exists`, KEYS.every((k) => new RegExp(`\\b${k}:\\s*"`).test(src)),
      KEYS.filter((k) => !new RegExp(`\\b${k}:\\s*"`).test(src)).join(","));
  }
  const en = read("apps/web/src/i18n/dictionaries/en.ts");
  const sk = read("apps/web/src/i18n/dictionaries/sk.ts");
  check("6b) the SK review label is the existing product wording", /reviewRequired: "Vyžaduje kontrolu"/.test(sk));
  check("6c) the copy is genuinely translated, not English everywhere",
    /reanalysisRequired: "Re-analysis required"/.test(en) && /reanalysisRequired: "Vyžaduje opätovnú analýzu"/.test(sk));
  check("6d) no stale-decision copy implies pending/approved/executable",
    !/staleExplain: "[^"]*(pending|approved|executable)[^"]*"/.test(en) || /not pending, approved or executable/.test(en));
}

console.log("\n7) CHANGE DETECTOR — no customer surface may read raw accusatory classification");
{
  const walk = (rel: string): string[] => {
    const out: string[] = [];
    const rec = (p: string) => {
      for (const e of readdirSync(`${ROOT}${p}`)) {
        const child = `${p}/${e}`;
        if (statSync(`${ROOT}${child}`).isDirectory()) rec(child);
        else if (child.endsWith(".ts") || child.endsWith(".tsx")) out.push(child);
      }
    };
    rec(rel);
    return out;
  };
  /** Files allowed to touch raw values: the projection itself, the ingest write path, admin diagnostics. */
  const ALLOWED = new Set([
    "packages/ai/src/evidence.ts",
    "packages/ai/src/reputation.ts",          // pure bucket helper — operates on values already projected
    "packages/sync/src/index.ts",             // ingest WRITE path (produces the gate)
    "packages/sync/src/maintenance.ts",       // retention snapshot (not customer-facing)
    "apps/web/src/app/api/e2e/seed-inbox-bulk/route.ts", // e2e fixture seeding
    "apps/web/src/app/dashboard/inbox/[id]/actions.ts",  // brand-memory feedback (internal)
    "apps/web/src/server/proposals.ts",       // proposal payload (internal)
    "apps/worker/src/proposals.ts",
  ]);
  const files = [...walk("apps/web/src"), ...walk("packages/db/src"), ...walk("packages/ai/src")]
    .filter((f) => !ALLOWED.has(f));
  const offenders: string[] = [];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A raw read is only safe when the same file also imports the canonical projection.
    const readsRaw = /\br\.riskCategories\b|\bitem\.riskCategories\b|\bit\.riskCategories\b|autoDecision\.decision|autoDecision\.matchedCategory/.test(src);
    if (readsRaw && !/projectStoredClassification/.test(src)) offenders.push(f);
  }
  check(`7a) every surface reading raw classification also uses the canonical projection (${files.length} files scanned)`,
    offenders.length === 0, offenders.join(", "));

  // The repaired surfaces must each actually import it.
  const REPAIRED = [
    "apps/web/src/app/dashboard/comments/page.tsx",
    "apps/web/src/app/dashboard/inbox/[id]/page.tsx",
    "apps/web/src/app/dashboard/reputation/page.tsx",
    "apps/web/src/app/dashboard/insights/page.tsx",
    "apps/web/src/app/dashboard/actor-risk/page.tsx",
    "apps/web/src/app/dashboard/action-queue/[id]/page.tsx",
    "apps/web/src/app/dashboard/reports/page.tsx",
    "packages/db/src/dashboard-metrics.ts",
    "packages/db/src/export-repo.ts",
  ];
  for (const f of REPAIRED) {
    check(`7b) ${f.replace(/^apps\/web\/src\/app\/|^packages\//, "")} routes through the projection`,
      /projectStoredClassification/.test(read(f)));
  }
  check("7c) the inbox detail page no longer renders raw category badges",
    !/item\.riskCategories\.map/.test(read("apps/web/src/app/dashboard/inbox/[id]/page.tsx")));
  check("7d) the inbox detail page no longer asserts a raw would_auto_hide badge",
    !/autoDecision\.decision === "would_auto_hide"/.test(read("apps/web/src/app/dashboard/inbox/[id]/page.tsx")));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — customer classification projection: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
