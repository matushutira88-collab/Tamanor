/**
 * V1.61 — end-to-end round-trip of the ADMIN diagnostics breakdown: pipeline `diagnostics` →
 * `buildIntelFromHybrid` → JSONB persist on ReputationItem → `inboxItemSelect` read. Proves the exact
 * data the admin panel renders survives the DB round-trip (no text/prompt/key — verdicts + metadata only).
 * Real Postgres, deterministic `mock` provider (no network). Run: pnpm ai-diagnostics:test
 */
import { classifyHybrid, buildIntelFromHybrid, __setForceDiagnosticsErrorForTests, type ClassificationInput, type AiDiagnostics } from "@guardora/ai";
import { systemDb, listInboxPage } from "@guardora/db";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const SCAM = "This is a scam and fraud — total ripoff, you are a crook and a thief, I will sue you.";
const input = (text: string): ClassificationInput => ({ text, platform: "facebook_page" as ClassificationInput["platform"], locale: "en", rules: [] });

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: `Diag ${sfx}`, slug: `diag-${sfx}`, plan: "free" } });
  try {
    // Pipeline (all mode, mock) → intel with the diagnostics blob.
    const hybrid = await classifyHybrid(input(SCAM), {
      workspaceLocale: "en",
      translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
      aiRisk: { enabled: true, provider: "mock", minConfidence: 0, callMode: "all" },
      memoryRules: [],
    });
    check("pipeline emits diagnostics (callMode all, AI consulted, verdict present)", hybrid.diagnostics?.callMode === "all" && hybrid.diagnostics?.gate.aiCalled === true && !!hybrid.diagnostics?.ai.verdict);
    check("diagnostics carries NO model/tokens (joined from UsageEvent, not duplicated)", !!hybrid.diagnostics && !("model" in hybrid.diagnostics.ai) && !("inputTokens" in hybrid.diagnostics.ai) && !("outputTokens" in hybrid.diagnostics.ai));
    check("diagnostics records the gate reason", hybrid.diagnostics?.gate.reason === "all_mode", hybrid.diagnostics?.gate.reason);

    const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "B" } });
    const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `ACC_${sfx}`, health: "healthy" } });
    const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: br.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ext_${sfx}`, text: "x", publishedAt: new Date() } });
    const ri = await systemDb.reputationItem.create({ data: {
      tenantId: t.id, brandId: br.id, platform: "facebook_page", contentItemId: ci.id, status: "classified",
      processingStatus: "processed_paid", processingTier: "paid", contentHash: `h_${sfx}`,
      riskLevel: hybrid.level as never, riskCategories: hybrid.categories, riskConfidence: hybrid.confidence,
      ...buildIntelFromHybrid(hybrid),
    } });

    // Read back through the ACTUAL inbox select/query the admin panel uses.
    const page = await listInboxPage(t.id, {}, { cursor: null, dir: "next", pageSize: 10 });
    const row = page.rows.find((r) => r.id === ri.id);
    check("row is returned by listInboxPage with the new select", !!row);
    check("inbox select exposes classificationMode = ai_assisted", row?.classificationMode === "ai_assisted", row?.classificationMode);

    const d = (row?.aiDiagnostics ?? null) as AiDiagnostics | null;
    check("aiDiagnostics JSONB round-trips as a structured object", !!d && typeof d === "object");
    check("round-trip: callMode = all", d?.callMode === "all", d?.callMode);
    check("round-trip: gate (aiCalled + reason) present", d?.gate.aiCalled === true && d?.gate.reason === "all_mode", `${d?.gate.aiCalled}/${d?.gate.reason}`);
    check("round-trip: rules + merged snapshots present", !!d?.rules && !!d?.merged && d.merged.level === (hybrid.level as string));
    check("round-trip: AI verdict + status present", d?.ai.status === "classified" && !!d?.ai.verdict);
    check("round-trip carries NO comment text / prompt", !JSON.stringify(d).includes(SCAM.slice(0, 20)));

    // -------- FAIL-OPEN: a diagnostics build error must NOT block classification or persistence --------
    __setForceDiagnosticsErrorForTests(true);
    try {
      const baseline = hybrid; // same input, diagnostics succeeded above
      const forced = await classifyHybrid(input(SCAM), {
        workspaceLocale: "en",
        translation: { enabled: false, provider: "none", targetMode: "workspace_locale" },
        aiRisk: { enabled: true, provider: "mock", minConfidence: 0, callMode: "all" },
        memoryRules: [],
      });
      check("fail-open: classification still completes", typeof forced.level === "string" && forced.level.length > 0);
      check("fail-open: diagnostics is null (not thrown)", forced.diagnostics === null);
      check("fail-open: merged result preserved (level + categories unchanged)", forced.level === baseline.level && JSON.stringify(forced.categories) === JSON.stringify(baseline.categories));

      // Persist a ReputationItem with the forced (null-diagnostics) intel — must save cleanly.
      const ci2 = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: br.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: `ext2_${sfx}`, text: "x", publishedAt: new Date() } });
      const ri2 = await systemDb.reputationItem.create({ data: {
        tenantId: t.id, brandId: br.id, platform: "facebook_page", contentItemId: ci2.id, status: "classified",
        processingStatus: "processed_paid", processingTier: "paid", contentHash: `h2_${sfx}`,
        riskLevel: forced.level as never, riskCategories: forced.categories, riskConfidence: forced.confidence,
        ...buildIntelFromHybrid(forced),
      } });
      check("fail-open: ReputationItem persisted despite null diagnostics", !!ri2.id);
      const back = await systemDb.reputationItem.findUnique({ where: { id: ri2.id }, select: { aiDiagnostics: true, riskLevel: true } });
      check("fail-open: persisted aiDiagnostics is null", back?.aiDiagnostics === null, JSON.stringify(back?.aiDiagnostics));
      check("fail-open: merged risk still stored on ReputationItem", (back?.riskLevel as string) === forced.level);
    } finally {
      __setForceDiagnosticsErrorForTests(false); // never leak the test hook
    }
  } finally {
    await systemDb.reputationItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.contentItem.deleteMany({ where: { tenantId: t.id } });
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — AI diagnostics persistence round-trip (V1.61)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
