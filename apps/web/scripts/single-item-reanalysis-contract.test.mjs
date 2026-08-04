/**
 * Dependency-free contract regression for single-item Preview → Confirm re-analysis.
 * This complements the runtime/DB suites by pinning RSC, browser-input, canonical-pipeline,
 * i18n and migration/schema invariants with no provider or database access.
 */
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}${condition ? "" : ` — ${detail}`}`);
  condition ? passed++ : failed++;
}
function occurrences(source, token) {
  return source.split(token).length - 1;
}

const repo = read("packages/db/src/reanalysis-repo.ts");
const service = read("apps/web/src/server/inbox-reanalysis.ts");
const actions = read("apps/web/src/app/dashboard/inbox/[id]/actions.ts");
const page = read("apps/web/src/app/dashboard/inbox/[id]/page.tsx");
const comments = read("apps/web/src/app/dashboard/comments/page.tsx");
const limiter = read("apps/web/src/lib/rate-limit.ts");
const schema = read("packages/db/prisma/schema.prisma");
const migration = read("packages/db/prisma/migrations/20260902090000_single_item_reanalysis_foundation/migration.sql");
const sync = read("packages/sync/src/index.ts");
const inboxRepo = read("packages/db/src/inbox-repo.ts");
const fixtures = read("packages/ai/scripts/single-item-reanalysis-fixtures.test.ts");
const dictionaries = ["en", "sk", "de"].map((locale) => read(`apps/web/src/i18n/dictionaries/${locale}.ts`));

console.log("\n1) Preview/Confirm server boundary");
check("Preview reserves durable idempotency before classification", service.indexOf("beginReanalysisPreview(input)") < service.indexOf("classifyWithUsagePolicy("));
check("Preview has exactly one canonical classifier call site", occurrences(service, "classifyWithUsagePolicy(") === 1, String(occurrences(service, "classifyWithUsagePolicy(")));
check("Preview explicitly bypasses stale cache", service.includes("refresh: true"));
check("Preview completes the durable proposal after classification", service.indexOf("completeReanalysisPreview({") > service.indexOf("classifyWithUsagePolicy("));
check("Confirm action accepts only previewId from browser", actions.includes('formData.get("previewId")') && !/confirmReanalysisAction[\s\S]*formData\.get\("(?:risk|sentiment|priority|proposal|classification)/.test(actions));
check("Confirm path has no classifier/provider call", !repo.slice(repo.indexOf("export function confirmReanalysisPreview")).includes("classifyWithUsagePolicy") && !actions.slice(actions.indexOf("export async function confirmReanalysisAction")).includes("previewItemReanalysis"));
check("Page render has no provider/classifier call", !page.includes("classifyWithUsagePolicy") && !page.includes("previewItemReanalysis"));

console.log("\n2) Authorization, rate limit and durable protocol");
check("Both actions require session", occurrences(actions, "await requireSession()") >= 2);
check("Both actions require InboxAct", occurrences(actions, "assertCan(session.role, Permission.InboxAct)") >= 2);
check("Both actions enforce same-origin", occurrences(actions, "await isSameOrigin()") >= 2);
check("Preview uses fail-closed shared limiter", actions.includes("inboxReanalysisLimiter.check") && limiter.includes("failClosed: true"));
check("Reservation uses processing state and item row lock", repo.includes('status: "processing"') && repo.includes("FOR UPDATE"));
check("Duplicate in-flight Preview returns in_progress", repo.includes('reason: "in_progress"'));
check("Confirm verifies actor, expiry, digest and source fingerprint", ["wrong_actor", "expiresAt", "digest_mismatch", "sourceFingerprint"].every((token) => repo.includes(token)));
check("Lost-response Confirm is idempotent", repo.includes("consumedAuditId") && repo.includes("duplicate: true"));
check("Confirm uses one tenant transaction", repo.includes("return withTenantDb(input.tenantId, async (db) =>"));

console.log("\n3) Exact write-set and protected state");
const confirm = repo.slice(repo.indexOf("export function confirmReanalysisPreview"));
for (const field of [
  "riskLevel", "riskConfidence", "riskCategories", "sentiment", "riskRationale", "riskEngine",
  "assessedAt", "detectedLanguage", "languageConfidence", "translationStatus", "translatedText",
  "classificationMode", "aiProvider", "aiDiagnostics", "processingTier", "processingStatus",
  "lastProcessedAt", "classifierVersion", "contentHash", "customerClassificationState",
  "customerRiskLevel", "customerRiskCategories", "customerClassificationProjectionVersion",
  "customerRequiresReanalysis",
]) check(`Confirm writes ${field}`, new RegExp(`\\b${field}(?::|,)`).test(confirm));
check("Priority changes only for system provenance", confirm.includes("priorityProvenance === PriorityProvenance.system") && confirm.includes("...(priorityCanChange ?"));
check("Confirm does not overwrite human workflow fields", !/[\n\r]\s*(?:status|requiresApproval|isRead|archivedAt|assignedToUserId|inboxWorkflowStatus):/.test(confirm.slice(confirm.indexOf("db.reputationItem.update"), confirm.indexOf("db.autoProtectDecision.deleteMany"))));
check("Confirm replaces AutoProtect without platform action", confirm.includes("autoProtectDecision.deleteMany") && confirm.includes("autoProtectDecision.create") && !confirm.includes("platformActionExecution.") && !confirm.includes("actionQueueItem.") && !confirm.includes("moderationDecision."));
check("Audit is privacy bounded", confirm.includes('event: "inbox.item_reanalyzed"') && !/metadata:[\s\S]{0,900}(?:text|author|providerCalls|payload)/.test(confirm.slice(confirm.indexOf("const audit"), confirm.indexOf("reputationReanalysisPreview.update"))));

console.log("\n4) Priority provenance write paths");
check("Ingest marks system priority", sync.includes("priorityProvenance: PriorityProvenance.system") && sync.includes("prioritySetByUserId: null"));
check("Single manual priority marks human", inboxRepo.includes('priorityProvenance: "human"') && inboxRepo.includes("prioritySetByUserId: actorUserId"));
check("Bulk manual priority marks every row human", /case "set_priority":[\s\S]{0,350}priorityProvenance: "human"/.test(inboxRepo));

console.log("\n5) Prisma/migration parity and RLS");
for (const token of [
  "enum PriorityProvenance", "priorityProvenance", "prioritySetByUserId", "prioritySetAt",
  "model ReputationReanalysisPreview", '@@map("reputation_reanalysis_previews")',
  'map: "rrp_tenant_user_item_idem_key"', 'map: "reputation_reanalysis_previews_item_tenant_fkey"',
]) check(`schema contains ${token}`, schema.includes(token));
check("Migration uses unknown as fail-closed default", migration.includes("NOT NULL DEFAULT 'unknown'"));
check("Migration enables and forces RLS", migration.includes("ENABLE ROW LEVEL SECURITY") && migration.includes("FORCE ROW LEVEL SECURITY"));
check("Migration has tenant-safe composite FK", migration.includes('FOREIGN KEY ("reputationItemId", "tenantId")') && migration.includes('REFERENCES "reputation_items"("id", "tenantId")'));

console.log("\n6) UI, truthful badge and i18n");
check("Controls exist only inside InboxAct branch", page.indexOf("{act ? (") < page.indexOf('data-testid="item-reanalysis"'));
check("Preview renders current vs proposed and explicit Confirm", page.includes("t.reanalysis.current") && page.includes("t.reanalysis.proposed") && page.includes("confirmReanalysisAction"));
check("Detail stale state is neutral", page.includes('data-testid="auto-protect-stale"') && page.includes("t.reanalysis.requiresReanalysis"));
check("Stale detail hides review-required and raw legacy rationale", page.includes("view.requiresReview && !requiresReanalysis") && page.includes("item.riskRationale && !requiresReanalysis"));
check("Preview labels stale current categories as requiring re-analysis", page.includes("const currentCats = requiresReanalysis"));
check("Preview preserves human/unknown priority in proposed view", page.includes('item.priorityProvenance === "system" ? p.priority.proposed : item.priority'));
check("Comments list hides stale successful AI metadata", comments.includes('data-status={r.requiresReanalysis ? "requires_reanalysis"') && comments.includes("!r.requiresReanalysis && PROCESSING_LIMIT_STATES"));
const requiredI18n = ["title", "action", "confirm", "current", "proposed", "inProgress", "providerFailure", "conflict", "expired", "consumed", "superseded", "requiresReanalysis", "staleProcessing", "success"];
for (const locale of ["EN", "SK", "DE"]) {
  const dict = dictionaries[["EN", "SK", "DE"].indexOf(locale)];
  check(`${locale} reanalysis dictionary complete`, requiredI18n.every((key) => new RegExp(`\\b${key}:`).test(dict)));
}

console.log("\n7) Exact multilingual fixtures");
for (const exact of [
  "Which pattern would concern your brand most: repeated comments, suspicious profiles or sudden engagement spikes?",
  "What would be hardest for your brand to detect: fake accounts, false claims or coordinated comments?",
  "Ktorý vzorec by najviac znepokojoval vašu značku: opakované komentáre, podozrivé profily alebo náhly nárast interakcií?",
  "Welches Muster würde Ihre Marke am meisten beunruhigen: wiederholte Kommentare, verdächtige Profile oder plötzliche Interaktionsspitzen?",
]) check(`fixture present: ${exact.slice(0, 28)}…`, fixtures.includes(exact));
check("Positive SK/EN/DE vulgarity and scam retained", ["SK vulgarity", "EN vulgarity", "DE vulgarity", "SK scam", "EN scam", "DE scam"].every((label) => fixtures.includes(label)));
check("Threat and harassment positives retained", fixtures.includes('"Threat"') && fixtures.includes('"Harassment"'));

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — single-item re-analysis contract: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
