/**
 * V1.29 Reputation Analytics. Pure classification (state-truth aware) + page source
 * assertions. Normal criticism is never harmful; risky = spam/scam/hate/etc. No
 * provider codes / raw ids / demo data in the default view.
 *
 * Run via: pnpm reputation-analytics:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { sentimentBucket, topicOf, RISKY_CATEGORIES } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const bucket = (cats: string[], sentiment = "neutral", riskLevel = "none") => sentimentBucket({ categories: cats, sentiment, riskLevel });

async function run() {
  const page = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  // --- Pure classification (state truth) ---
  check("15) normal_criticism is NEVER risky", bucket(["normal_criticism"], "negative", "high") !== "risky" && bucket(["normal_criticism"], "negative") === "negative");
  check("harmful spam/scam/hate → risky", bucket(["spam"]) === "risky" && bucket(["scam"]) === "risky" && bucket(["hate_speech"]) === "risky" && bucket(["threat"], "neutral", "critical") === "risky");
  check("positive_feedback → positive; customer_question → neutral", bucket(["positive_feedback"]) === "positive" && bucket(["customer_question"]) === "neutral");
  check("refund/legal/safety complaints → negative (legitimate, not risky)", bucket(["refund_complaint"]) === "negative" && bucket(["legal_complaint"]) === "negative" && bucket(["safety_claim"]) !== "risky");
  check("high/critical without customer-voice → risky", bucket([], "neutral", "critical") === "risky" && bucket([], "negative", "low") === "negative");
  check("RISKY_CATEGORIES excludes customer-voice", !RISKY_CATEGORIES.has("normal_criticism") && !RISKY_CATEGORIES.has("refund_complaint") && !RISKY_CATEGORIES.has("customer_question"));
  check("topicOf maps category + keywords", topicOf(["scam"], "") === "scam" && topicOf([], "aká je cena tohto?") === "price" && topicOf([], "kedy príde doručenie") === "delivery" && topicOf([], "nič konkrétne") === "uncategorized");

  // --- Navigation (V1.30B: Reputation is a primary page) ---
  const repEntry = (nav.match(/\{\s*href: "\/dashboard\/reputation"[^{}]*?\}/s) ?? [""])[0];
  check("1) Reputation is a primary nav page", repEntry.length > 0 && !repEntry.includes("group:") && !repEntry.includes("hidden:") && en.includes('insights: "Reputation"'));
  const entries0 = nav.match(/\{\s*href: "\/dashboard[^{}]*?\}/gs) ?? [];
  check("primary nav still 5", entries0.filter((e) => !e.includes("group:") && !e.includes("hidden:")).length === 5);

  // --- Route + sections (source) ---
  check("2) /dashboard/reputation route exists", page.includes("export default async function ReputationPage"));
  check("3) date range Today/7d/30d", page.includes("rangeToday") && page.includes("range7d") && page.includes("range30d") && /RANGES = \{ today: 1, "7d": 7, "30d": 30 \}/.test(page));
  check("4) default range is 7d", /: "7d";/.test(page) || page.includes('? (sp.range as RangeKey) : "7d"'));
  check("5) sentiment breakdown (4 buckets)", page.includes("sentimentBreakdown") && page.includes("bucket_") && /buckets\.positive/.test(page) && /buckets\.risky/.test(page) && page.includes("riskyNote"));
  check("6) risky comments count", page.includes("riskyComments") && page.includes("riskyCount"));
  check("7) hidden-for-public count (from executions)", page.includes("hiddenPublic") && /reason: \{ in: HIDE_REASONS \}/.test(page) && page.includes('"live_hide_executed", "already_hidden"'));
  check("8) pending review count (approval_required only)", page.includes("pendingDecision") && /queueState: "approval_required"/.test(page));
  check("9) risk over time", page.includes("riskOverTime") && page.includes("riskyByDay") && page.includes("hiddenByDay"));
  check("10) top topics", page.includes("topTopics") && page.includes("topicOf"));
  check("11) top risky posts", page.includes("riskiestPosts") && page.includes("topPosts"));
  check("12) criticism vs harmful", page.includes("critVsHarmful") && page.includes("critLegit") && page.includes("critNote"));
  check("13) recommendations", page.includes("recommendations") && page.includes("recStable") && page.includes("recScam"));
  check("14) reputation summary", page.includes("reputationSummary") && page.includes("summaryTemplate"));
  check("16) autonomous hides count as auto-hidden", /hides\.filter\(\(h\) => h\.trigger === "autonomous"\)/.test(page) && page.includes("autoHidden"));
  check("17) no account/token error handling on reputation page", !page.includes("reconnect") && !page.includes("tokenHealth") && !page.includes("token_expired"));
  check("18) can_hide=false not shown as account error (not on reputation page)", !page.includes("facebook_can_hide_false"));
  check("19) no provider codes / raw ids by default", !page.includes("providerResponseCode") && !page.includes("providerErrorCode") && !page.includes("externalCommentId") && !page.includes("policyId"));
  check("21) mobile: no wide table; 2-col metric grid", !page.includes("<table") && page.includes("grid-cols-2"));
  check("22) product empty states", page.includes("emptyNoComments") && page.includes("emptyTopics") && page.includes("emptyRiskyPosts"));
  check("23) i18n SK/EN/DE rep keys present", en.includes("reputationSummary") && sk.includes("Reputačný súhrn") && de.includes("Reputationsübersicht") && sk.includes("Legitímna kritika"));

  // --- Functional: hidden count uses executions only, never labels normal criticism hidden ---
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Reputation Test Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: "REP_PG", pageId: "REP_PG" } });
    const mkComment = async (text: string, cats: string[], risk: string, sentiment: string, ext: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: ext, externalParentId: "POST_1", text, publishedAt: new Date() } });
      await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: risk as never, riskCategories: cats, sentiment: sentiment as never } });
    };
    try {
      await mkComment("toto je hnus, kokot", ["profanity"], "critical", "negative", "c1");
      await mkComment("služba bola pomalá, nespokojný", ["normal_criticism"], "low", "negative", "c2");
      const items = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { riskCategories: true, sentiment: true, riskLevel: true } });
      const risky = items.filter((r) => bucket(r.riskCategories, r.sentiment as string, r.riskLevel as string) === "risky").length;
      const negative = items.filter((r) => bucket(r.riskCategories, r.sentiment as string, r.riskLevel as string) === "negative").length;
      check("F1) profanity → risky; normal criticism → negative (not risky, not hidden)", risky === 1 && negative === 1);
      const hides = await prisma.platformActionExecution.count({ where: { brandId: brand.id, status: "executed", reason: { in: ["live_hide_executed", "already_hidden"] } } });
      check("F2) hidden count is 0 (no execution) — criticism never counted as hidden", hides === 0);
    } finally {
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  // 20) no demo/mock data.
  const [mock, demo] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("20) no demo/mock data", mock === 0 && demo === 0);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Reputation Analytics`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
