/**
 * V1.30 Actor Risk / Rizikové profily. Deterministic behavior-based scoring +
 * page/source assertions. Repeated risky behavior from a visible profile in
 * comments on connected accounts — NOT an identity/legal claim. Customer voice
 * (criticism, questions, complaints) never makes an actor risky.
 *
 * Run via: pnpm actor-risk:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import {
  buildActorSignals, actorRiskScore, actorRiskLevel, actorRiskReasons,
  sentimentBucket, type ActorComment,
} from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const mk = (o: Partial<ActorComment> = {}): ActorComment => ({ categories: [], riskLevel: "none", sentiment: "neutral", postId: "P1", text: "x", hidden: false, ...o });
const scoreOf = (c: ActorComment[]) => actorRiskScore(buildActorSignals(c));

async function run() {
  const page = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const actorSlice = (src: string) => (src.match(/\n  actor: \{[\s\S]*?\n  \},/) ?? [""])[0];

  // 1) Route exists.
  check("1) /dashboard/actor-risk route exists", page.includes("export default async function ActorRiskPage"));

  // 2) Nav placement — More group, not primary.
  check("2) Actor Risk in More nav group", /href: "\/dashboard\/actor-risk"[\s\S]*?group: "More"/.test(nav) && en.includes('actorRisk: "Actor Risk"') && sk.includes('actorRisk: "Rizikové profily"'));

  // 3) Primary nav still exactly 5 (Actor Risk is not primary).
  const entries = nav.match(/\{\s*href: "\/dashboard[^{}]*?\}/gs) ?? [];
  const primaryCount = entries.filter((e) => !e.includes("group:") && !e.includes("hidden:")).length;
  check("3) exactly 5 primary nav items", primaryCount === 5, String(primaryCount));

  // 4) Date range Today/7d/30d, default 7d.
  check("4) date range default 7d", /RANGES = \{ today: 1, "7d": 7, "30d": 30 \}/.test(page) && page.includes('? (sp.range as RangeKey) : "7d"') && page.includes("rangeToday"));

  // 5) Four metric cards.
  check("5) four metric cards", page.includes("mRiskyActors") && page.includes("mHighRisk") && page.includes("mRepeatedRisky") && page.includes("mTopRisk") && /grid-cols-2[\s\S]*?lg:grid-cols-4/.test(page));

  // 6) Actor card fields.
  check("6) actor cards show required fields", ["a.display", "a.platform", "a.account", "a.comments.length", "signals.riskyComments", "a.hidden", "a.pending", "signals.postsAppeared", "topRisk", "lastActivity", "viewComments"].every((s) => page.includes(s)));

  // 7) Deterministic scoring (same input → same score; known clamp/bands).
  const repeatedScam = [mk({ categories: ["scam"], postId: "P1", text: "http://x.co" }), mk({ categories: ["scam"], postId: "P2", text: "http://x.co" })];
  check("7) deterministic scoring", scoreOf(repeatedScam) === scoreOf(repeatedScam) && actorRiskScore({ totalComments: 9, riskyComments: 9, scamPhishing: 9, postsAppeared: 9, repeatedPhrase: true, profanityAttackHate: 9, hiddenForPublic: 9, highCritical: 9, inIncident: true }) === 100);

  // 8) Normal criticism does NOT make an actor risky.
  const criticism = [mk({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "high", text: "služba pomalá" }), mk({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical", text: "nespokojný" })];
  check("8) normal criticism → score 0 / low", scoreOf(criticism) === 0 && actorRiskLevel(scoreOf(criticism)) === "low");

  // 9) Customer questions + legit complaints do NOT make an actor risky.
  const questions = [mk({ categories: ["customer_question"], text: "aká je cena?" }), mk({ categories: ["refund_complaint"], sentiment: "negative", text: "chcem vrátiť peniaze" }), mk({ categories: ["legal_complaint"], sentiment: "negative" })];
  check("9) customer questions/complaints → score 0", scoreOf(questions) === 0);

  // 10) Scam/phishing links increase risk.
  check("10) scam/phishing increases risk", scoreOf([mk({ categories: ["scam"] }), mk({ categories: ["phishing"] })]) > scoreOf(questions) && buildActorSignals([mk({ categories: ["scam"] })]).scamPhishing === 1);

  // 11) Profanity/personal attack/hate/threat increase risk.
  check("11) profanity/attacks increase risk", buildActorSignals([mk({ categories: ["profanity"] })]).profanityAttackHate === 1 && scoreOf([mk({ categories: ["personal_attack"], riskLevel: "high" }), mk({ categories: ["hate_speech"], riskLevel: "high" })]) >= 30);

  // 12) Multiple posts increase risk.
  const onePost = [mk({ categories: ["scam"], postId: "P1" }), mk({ categories: ["scam"], postId: "P1" })];
  const twoPosts = [mk({ categories: ["scam"], postId: "P1" }), mk({ categories: ["scam"], postId: "P2" })];
  check("12) multiple posts increase risk", buildActorSignals(twoPosts).postsAppeared === 2 && scoreOf(twoPosts) > scoreOf(onePost));

  // 13) Hidden uses state truth (executions), not classification.
  check("13) hidden derives from executions (state truth)", page.includes("hiddenSet") && /status: "executed", reason: \{ in: \[\.\.\.HIDE_REASONS, "comment_deleted"\] \}/.test(page) && page.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]'));
  check("13b) buildActorSignals counts only truly-hidden comments", buildActorSignals([mk({ hidden: true }), mk({ hidden: false })]).hiddenForPublic === 1);

  // 14) Dry-run is NOT counted as hidden.
  check("14) dry_run not counted as hidden", !page.includes('"dry_run"') && buildActorSignals([mk({ hidden: false })]).hiddenForPublic === 0);

  // 15) A deleted comment is resolved, never an account error.
  check("15) deleted comment → resolved (not account error)", page.includes("resolvedSet") && page.includes('reason === "comment_deleted"') && page.includes("resolvedWord") && !page.includes("reconnect") && !page.includes("token_expired"));

  // 16) can_hide=false is a platform limitation, not surfaced as an account error here.
  check("16) can_hide=false not an actor/account error", !page.includes("facebook_can_hide_false") && !page.includes("tokenHealth"));

  // 17) Risk reasons are shown (behavior-based, no identity claims).
  check("17) reasons shown", page.includes("actorRiskReasons") && page.includes("reasonsLabel") && page.includes("reason_${rk}") && en.includes('reason_repeatedRisky: "Repeated risky comments"'));
  const reasons = actorRiskReasons(buildActorSignals(repeatedScam));
  check("17b) reasons reflect signals", reasons.includes("scamLink") && reasons.includes("multiPost") && reasons.includes("repeatedPhrase"));

  // 18) Detail shows recent comments + posts.
  check("18) detail shows comments + posts", page.includes("detailRecentComments") && page.includes("a.recent.slice") && page.includes("detailPosts") && page.includes("signals.postsAppeared"));

  // 19) Reputation links to Actor Risk (small link, not a full list).
  check("19) Reputation links to Actor Risk", rep.includes('href="/dashboard/actor-risk"') && rep.includes("actorRiskLink") && en.includes("actorRiskLink"));

  // 20) Action Queue shows a lightweight actor-risk badge (does not block approval).
  check("20) Action Queue actor-risk badge", aqDetail.includes("actorLevel") && aqDetail.includes("buildActorSignals") && aqDetail.includes("t.actor.badgePrefix") && aqDetail.includes('href="/dashboard/actor-risk"'));

  // 21) Empty states.
  check("21) empty states", page.includes("emptyNoActors") && page.includes("emptyNoRisky") && page.includes("emptyFiltered") && sk.includes("Zatiaľ neboli zistené rizikové profily"));

  // 22) No raw external ids rendered by default — the visible identity is the display
  //     name (or "Unknown profile"); the author id is only an opaque, prefixed group key.
  check("22) no raw author/comment ids rendered", page.includes("a.display") && page.includes("unknownProfile")
    && page.includes("actorIdentityKey(platformKeyFor(ci.platform)") // opaque, platform-scoped internal key
    && !/>\{[^{}]*authorExternalId[^{}]*\}</.test(page) // never inside a JSX text node
    && !page.includes("providerResponseCode") && !page.includes("providerErrorCode"));

  // 23) No demo/mock/fake data.
  const [mock, demo] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("23) no demo/mock data", mock === 0 && demo === 0);

  // 24) No forbidden accusatory wording in the Actor Risk UI/copy.
  const FORBIDDEN = [
    /fake account/i, /\bbot account\b/i, /bot účet/i, /\bscammer/i, /\bcriminal/i, /troll farm/i, /troll farma/i,
    /confirmed attacker/i, /revealed attacker/i, /\bperpetrator/i, /podvodník/i, /falošný účet/i, /páchateľ/i,
    /garantovaný útočník/i, /odhalený útočník/i,
  ];
  const actorCopy = [page, actorSlice(en), actorSlice(sk), actorSlice(de)].join("\n");
  check("24) no forbidden accusatory wording", FORBIDDEN.every((re) => !re.test(actorCopy)), FORBIDDEN.find((re) => re.test(actorCopy))?.source ?? "");

  // 25) Trust copy present (behavior, not legal/personal designation).
  check("25) trust copy present", page.includes("trustNote") && page.includes("behaviorNote") && sk.includes("Neznamená právne ani osobné označenie profilu") && sk.includes("nie z tvrdenia o identite osoby"));

  // 26) Mobile: no wide tables; 2-col metric grid; filters wrap; details drawer.
  check("26) mobile-safe (no <table>, 2-col grid, wrap)", !page.includes("<table") && page.includes("grid-cols-2") && page.includes("flex-wrap"));

  // 27) Advanced/expandable content collapsed by default (no open <details>).
  check("27) detail drawers collapsed by default", page.includes("<details") && !page.includes("<details open"));

  // 28) i18n SK/EN/DE keys present.
  check("28) i18n SK/EN/DE actor keys present", en.includes("mRiskyActors") && sk.includes("Rizikoví aktéri") && de.includes("Riskante Akteure") && sk.includes("Kritické riziko") && de.includes("Kritisches Risiko"));

  // 29) State truth (pure): customer voice never risky; risky categories bucket as risky.
  check("29) state truth: criticism not risky, harmful is", sentimentBucket({ categories: ["normal_criticism"], sentiment: "negative", riskLevel: "critical" }) !== "risky" && sentimentBucket({ categories: ["scam"], sentiment: "neutral", riskLevel: "none" }) === "risky");

  // --- Functional: aggregate by visible author; customer-voice actor stays low ---
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Actor Risk Test Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: "AR_PG", pageId: "AR_PG" } });
    const mkComment = async (author: string, name: string, post: string, text: string, cats: string[], risk: string, sentiment: string, ext: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: ext, externalParentId: post, authorExternalId: author, authorDisplayName: name, text, publishedAt: new Date() } });
      await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: risk as never, riskCategories: cats, sentiment: sentiment as never } });
    };
    try {
      // Risky actor: scam link repeated across two posts + profanity.
      await mkComment("RAY", "Ray", "POST_A", "kúp teraz http://scam.co", ["scam"], "high", "neutral", "ar1");
      await mkComment("RAY", "Ray", "POST_B", "kúp teraz http://scam.co", ["scam"], "high", "neutral", "ar2");
      await mkComment("RAY", "Ray", "POST_A", "si kokot", ["profanity"], "critical", "negative", "ar3");
      // Customer-voice actor: criticism + question only.
      await mkComment("NICK", "Nick", "POST_A", "služba bola pomalá", ["normal_criticism"], "low", "negative", "an1");
      await mkComment("NICK", "Nick", "POST_A", "aká je cena?", ["customer_question"], "none", "neutral", "an2");

      const reps = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { riskLevel: true, riskCategories: true, sentiment: true, contentItem: { select: { authorExternalId: true, externalParentId: true, text: true } } } });
      const byAuthor = new Map<string, ActorComment[]>();
      for (const r of reps) {
        const k = r.contentItem.authorExternalId!;
        (byAuthor.get(k) ?? byAuthor.set(k, []).get(k)!).push({ categories: r.riskCategories, riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: r.contentItem.externalParentId, text: r.contentItem.text, hidden: false });
      }
      const rayLevel = actorRiskLevel(actorRiskScore(buildActorSignals(byAuthor.get("RAY")!)));
      const nickScore = actorRiskScore(buildActorSignals(byAuthor.get("NICK")!));
      check("F1) risky actor aggregates to high/critical", rayLevel === "high" || rayLevel === "critical", rayLevel);
      check("F2) customer-voice actor stays low (score 0, excluded)", nickScore === 0 && actorRiskLevel(nickScore) === "low");
    } finally {
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Actor Risk`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
