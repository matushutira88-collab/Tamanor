/**
 * V1.44 — PROVIDER BOUNDARY test. Statically proves that no worker/server code can reach a paid AI
 * provider without going through the central metering service (`classifyWithUsagePolicy`). Fails on:
 *   - any real AI SDK import (openai / anthropic / cohere / mistral / google-generativeai / @ai-sdk),
 *   - any direct AI-provider HTTP endpoint,
 *   - the paid provider factories (getAiRiskProvider / getTranslationProvider) referenced outside the
 *     AI package's own internals,
 *   - `classifyHybrid` called from any PRODUCTION module other than the metering service,
 *   - the production ingest not routing through `classifyWithUsagePolicy`.
 *
 * Run: pnpm ai-boundary:test
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === ".next" || e === ".next-e2e") continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const SRC_DIRS = [
  join(ROOT, "packages", "ai", "src"), join(ROOT, "packages", "sync", "src"), join(ROOT, "packages", "db", "src"),
  join(ROOT, "packages", "core", "src"), join(ROOT, "packages", "connectors", "src"), join(ROOT, "packages", "config", "src"),
  join(ROOT, "apps", "worker", "src"), join(ROOT, "apps", "web", "src"),
];
const rel = (p: string) => p.slice(ROOT.length + 1);
// Dev/test surfaces excluded from production-boundary checks: scripts, tests, prisma seed, and the
// fail-closed E2E seam routes (404 in real production).
const isDevOrTest = (p: string) => /(\/scripts\/|\.test\.|\.spec\.|prisma\/seed|\/api\/e2e\/)/.test(p);

function run() {
  const files = SRC_DIRS.flatMap((d) => walk(d));

  // 1) The official AI SDK may be imported ONLY inside the one approved server-side openai adapter —
  //    never in any other package, and never in browser/UI code (apps/web/src). This confines all direct
  //    SDK access to the central provider.
  const sdk = /(from\s+['"](openai|@anthropic-ai\/[^'"]+|cohere-ai|mistralai|@google\/generative-ai|google-generativeai|@ai-sdk\/[^'"]+)['"])|import\(\s*['"]openai['"]\s*\)/;
  const sdkAllow = new Set(["packages/ai/src/openai-provider.ts"]);
  const sdkHits = files.filter((f) => sdk.test(readFileSync(f, "utf8")) && !sdkAllow.has(rel(f))).map(rel);
  check("1) AI SDK import confined to the approved openai adapter (never elsewhere, never in web/UI)", sdkHits.length === 0, sdkHits.join(", "));
  // 1b) The approved adapter really is the one importing the SDK (allowlist is not stale).
  const adapterSrc = readFileSync(join(ROOT, "packages", "ai", "src", "openai-provider.ts"), "utf8");
  check("1b) the approved openai adapter imports the official SDK", sdk.test(adapterSrc));
  // 1c) No browser/UI code imports the openai adapter directly (it is server-only, reached via the factory).
  const webAdapterHits = walk(join(ROOT, "apps", "web", "src")).filter((f) => /openai-provider/.test(readFileSync(f, "utf8"))).map(rel);
  check("1c) openai adapter not imported by any web/UI file", webAdapterHits.length === 0, webAdapterHits.join(", "));

  // 2) No direct AI-provider HTTP endpoints.
  const http = /(api\.openai\.com|api\.anthropic\.com|api\.cohere\.|generativelanguage\.googleapis\.com|api\.mistral\.ai)/;
  const httpHits = files.filter((f) => http.test(readFileSync(f, "utf8"))).map(rel);
  check("2) no direct paid-provider HTTP endpoint", httpHits.length === 0, httpHits.join(", "));

  // 3) Paid provider factories only inside the AI package internals.
  const factoryAllow = new Set(["packages/ai/src/providers.ts", "packages/ai/src/pipeline.ts", "packages/ai/src/index.ts"]);
  const factoryHits = files.filter((f) => /getAiRiskProvider|getTranslationProvider/.test(readFileSync(f, "utf8")) && !factoryAllow.has(rel(f)) && !isDevOrTest(f)).map(rel);
  check("3) paid provider factories referenced only inside AI-package internals", factoryHits.length === 0, factoryHits.join(", "));

  // 4) classifyHybrid called only from the metering service (+ its own definition), in prod code.
  const chAllow = new Set(["packages/ai/src/pipeline.ts", "packages/sync/src/metered-classify.ts"]);
  const chHits = files.filter((f) => /classifyHybrid\s*\(/.test(readFileSync(f, "utf8")) && !chAllow.has(rel(f)) && !isDevOrTest(f)).map(rel);
  check("4) classifyHybrid invoked only via the metering service in production code", chHits.length === 0, chHits.join(", "));

  // 5) Production ingest routes through the metering service.
  const ingest = readFileSync(join(ROOT, "packages", "sync", "src", "index.ts"), "utf8");
  check("5) production ingest calls classifyWithUsagePolicy (metered)", /classifyWithUsagePolicy\s*\(/.test(ingest) && !/\bclassifyHybrid\s*\(/.test(ingest));

  // 6) The GLOBAL usage store is never referenced from tenant-facing web code.
  const webFiles = walk(join(ROOT, "apps", "web", "src"));
  const globalHits = webFiles.filter((f) => /reserveGlobalDailyCall|finalizeGlobalDailyCall|releaseGlobalDailyCall|globalAiUsagePeriod/.test(readFileSync(f, "utf8"))).map(rel);
  check("6) global usage store not reachable from tenant-facing web code", globalHits.length === 0, globalHits.join(", "));

  // 7) Processing state is written ONLY by the metering/classification service — never by the inbox
  //    mutation surface (server actions / client components).
  const mutationSurface = webFiles.filter((f) => /comments\/(inbox-actions|inbox-selection|inbox-controls|label-editor|assignee-editor|notes-section)\.tsx?$/.test(f));
  const procWriteHits = mutationSurface.filter((f) => /processingStatus|processingTier/.test(readFileSync(f, "utf8"))).map(rel);
  check("7) inbox mutation surface never writes processing state", procWriteHits.length === 0, procWriteHits.join(", "));

  // 8) The single production writer of processingStatus is the metered ingest.
  const procWriters = files.filter((f) => /processingStatus:\s*hybrid\.processingStatus|data:\s*\{[^}]*processingStatus/.test(readFileSync(f, "utf8")) && !isDevOrTest(f)).map(rel);
  check("8) processingStatus is DB-written only by the metering ingest", procWriters.length === 1 && procWriters[0] === "packages/sync/src/index.ts", procWriters.join(", "));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — AI provider boundary (V1.44)`);
  process.exit(failures === 0 ? 0 : 1);
}
run();
