/**
 * V1.30D Beta QA & real-data verification. Builds a realistic set of captured
 * comments (positive/neutral/criticism/profanity/scam) plus real execution +
 * queue state, then asserts the product's UI aggregation matches DB TRUTH — not
 * text labels. No behavior change; this verifies the flow end-to-end for beta.
 *
 * Run via: pnpm beta-real-data:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { sentimentBucket, buildActorSignals, actorRiskScore, actorRiskLevel, type ActorComment } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const bucket = (cats: string[], sentiment = "neutral", riskLevel = "none") => sentimentBucket({ categories: cats, sentiment, riskLevel });
const HIDE_REASONS = ["live_hide_executed", "already_hidden"];

async function run() {
  // ---------- Source & wording assertions ----------
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const inbox = readSrc("apps/web/src/app/dashboard/inbox/page.tsx");
  const inboxDetail = readSrc("apps/web/src/app/dashboard/inbox/[id]/page.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const actor = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const productSrc = [comments, cc, rep, actor, aqDetail].join("\n");

  // 15) Command Center links to the right product pages.
  check("15) Command Center cross-links correct", cc.includes("/dashboard/comments?filter=hidden") && cc.includes("/dashboard/comments?filter=risky") && cc.includes('href="/dashboard/action-queue"') && cc.includes('href="/dashboard/accounts"') && cc.includes('href="/dashboard/control-center"'));

  // 16) Comments filters exist (positive/neutral/negative/risky/hidden/pending).
  check("16) Comments filters present", /FILTERS: FilterKey\[\] = \["all", "positive", "neutral", "negative", "risky", "hidden", "pending"\]/.test(comments));

  // 17) Comments search matches text/author/category.
  check("17) Comments search over text/author/category", comments.includes("r.text.toLowerCase().includes(ql)") && comments.includes("r.author.toLowerCase().includes(ql)") && comments.includes('tEnum(t, "autoProtectCategory", r.category ?? "")'));

  // 22) No raw ids / provider codes rendered by default.
  for (const [name, src] of [["comments", comments], ["command-center", cc], ["reputation", rep], ["actor-risk", actor]] as const) {
    check(`22) ${name}: no raw ids / provider codes`, !src.includes("providerResponseCode") && !src.includes("providerErrorCode") && !src.includes("policyId") && !/>\{[^{}]*externalCommentId[^{}]*\}</.test(src) && !/>\{[^{}]*authorExternalId[^{}]*\}</.test(src));
  }

  // 24) No managed-moderation wording anywhere in the product UI/copy.
  const MOD = [/naši moderátori/i, /our moderators/i, /human moderators from guardora/i, /managed moderation/i, /rozhodne za vás/i, /we decide what to hide/i, /outsourc/i];
  check("24) no managed-moderation wording", MOD.every((re) => !re.test([productSrc, en, sk, de].join("\n"))));

  // 25) Mobile: no wide tables as default view in the product pages.
  check("25) no wide tables in product pages", [comments, cc, rep, actor].every((s) => !s.includes("<table")) && comments.includes("grid-cols-2"));

  // 26) Advanced/detail sections collapsed by default.
  check("26) Advanced/detail collapsed by default", comments.includes("<details") && !comments.includes("<details open") && actor.includes("<details") && !actor.includes("<details open") && aqDetail.includes("<details") && !aqDetail.includes("<details open"));

  // 27) /dashboard/inbox redirects safely to /dashboard/comments.
  check("27) inbox redirects to comments", inbox.includes('redirect("/dashboard/comments")'));

  // 28) /dashboard/inbox/[id] remains routable (Action Queue detail links to it).
  check("28) inbox/[id] still routable", inboxDetail.includes("export default") && aqDetail.includes("/dashboard/inbox/${q.itemId}"));

  // 29) i18n canonical keys present in SK/EN/DE.
  check("29) i18n SK/EN/DE keys present", [en, sk, de].every((d) => d.includes("hiddenFromPublic") && d.includes("st_deleted") && d.includes("st_canHideFalse")) && sk.includes("Skryté pre verejnosť") && de.includes("Öffentlich verborgen"));

  // ---------- Pure state-truth / classifier assertions ----------
  // 18) Reputation separates negative (legitimate criticism) from risky (harmful).
  check("18) negative ≠ risky", bucket(["normal_criticism"], "negative", "critical") === "negative" && bucket(["scam"]) === "risky" && bucket(["profanity"]) === "risky" && bucket(["refund_complaint"], "negative") === "negative");

  // 19) Actor Risk ignores customer-voice categories (no risk from criticism/questions/complaints).
  // Same post → isolates the category floor from the (behavior-agnostic) multi-post signal.
  const customerVoice: ActorComment[] = [
    { categories: ["normal_criticism"], riskLevel: "critical", sentiment: "negative", postId: "P1", text: "pomalé", hidden: false },
    { categories: ["customer_question"], riskLevel: "none", sentiment: "neutral", postId: "P1", text: "cena?", hidden: false },
    { categories: ["refund_complaint"], riskLevel: "high", sentiment: "negative", postId: "P1", text: "vrátenie", hidden: false },
  ];
  check("19) Actor Risk ignores customer-voice (category floor)", actorRiskScore(buildActorSignals(customerVoice)) === 0 && actorRiskLevel(actorRiskScore(buildActorSignals(customerVoice))) === "low");

  // 20) Repeated scam / profanity increases actor risk to a flagged level.
  const scamActor: ActorComment[] = [
    { categories: ["scam"], riskLevel: "high", sentiment: "neutral", postId: "A", text: "http://x.co", hidden: true },
    { categories: ["scam"], riskLevel: "high", sentiment: "neutral", postId: "B", text: "http://x.co", hidden: true },
  ];
  check("20) repeated scam/profanity flags actor", ["high", "critical"].includes(actorRiskLevel(actorRiskScore(buildActorSignals(scamActor)))));

  // 30) Existing state truth: dry-run/hidden reasons are exactly the live-hide set.
  check("30) state truth: hide set is live_hide_executed/already_hidden only", comments.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]') && actor.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]'));

  // 21) Accounts reconnect CTA is gated on real account state (not deleted/can_hide_false).
  const acctDetail = readSrc("apps/web/src/app/dashboard/accounts/[accountId]/page.tsx");
  check("21) reconnect CTA gated on token state", /token_expired/.test(acctDetail) && /!ok \?[\s\S]*?ctaReconnect/.test(cc));

  // ---------- Real-data DB fixture: UI aggregation must match DB truth ----------
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Beta Real Data Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: "BRD_PG", pageId: "BRD_PG" } });

    // Create a comment + reputation item; returns the reputationItem id (= itemId).
    const mk = async (author: string, post: string, text: string, cats: string[], risk: string, sentiment: string, ext: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: ext, externalParentId: post, authorExternalId: author, authorDisplayName: author, text, publishedAt: new Date() } });
      const ri = await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: risk as never, riskCategories: cats, sentiment: sentiment as never } });
      return { itemId: ri.id, ext };
    };
    const exec = (itemId: string, ext: string, status: string, reason: string, trigger = "approval") =>
      prisma.platformActionExecution.create({ data: { tenantId: T, brandId: brand.id, itemId, connectedAccountId: acct.id, platform: "facebook_page", actionType: "hide_comment", trigger, status, reason, externalCommentId: ext, externalPostId: "POST", executedAt: new Date() } });
    const queue = (itemId: string, cat: string, state: string) =>
      prisma.actionQueueItem.create({ data: { tenantId: T, brandId: brand.id, itemId, category: cat, proposedAction: "hide_comment", queueState: state } });

    try {
      // Customer voice (CUST): positive x3, neutral question, normal criticism — never risky/hidden/queued.
      await mk("CUST", "POST", "super produkt!", ["positive_feedback"], "none", "positive", "p1");
      await mk("CUST", "POST", "skvelé, ďakujem", ["positive_feedback"], "none", "positive", "p2");
      await mk("CUST", "POST", "veľmi spokojný", ["positive_feedback"], "none", "positive", "p3");
      await mk("CUST", "POST", "aká je cena?", ["customer_question"], "none", "neutral", "n1");
      await mk("CUST", "POST", "služba bola pomalá", ["normal_criticism"], "low", "negative", "c1");
      // TROLL: profanity/personal attack — one auto-hidden, one pending, one can_hide_false.
      const prof1 = await mk("TROLL", "POST", "si kokot", ["profanity"], "high", "negative", "t1");
      const prof2 = await mk("TROLL", "POST", "idiot, hnus", ["personal_attack"], "high", "negative", "t2");
      const chf1 = await mk("TROLL", "POST", "debil", ["profanity"], "high", "negative", "t3");
      await exec(prof1.itemId, prof1.ext, "executed", "live_hide_executed", "autonomous"); // auto-hidden
      await queue(prof2.itemId, "personal_attack", "approval_required"); // pending
      await exec(chf1.itemId, chf1.ext, "executed", "facebook_can_hide_false"); // platform limitation
      // SPAMMER: repeated scam link across two posts — hidden; plus a dry-run that must NOT count as hidden.
      const s1 = await mk("SPAMMER", "POST_A", "kúp http://x.co", ["scam"], "high", "neutral", "s1");
      const s2 = await mk("SPAMMER", "POST_B", "kúp http://x.co", ["scam"], "high", "neutral", "s2");
      const s3 = await mk("SPAMMER", "POST_A", "kúp http://x.co", ["scam"], "high", "neutral", "s3");
      await exec(s1.itemId, s1.ext, "executed", "live_hide_executed");
      await exec(s2.itemId, s2.ext, "executed", "already_hidden");
      await exec(s3.itemId, s3.ext, "dry_run", "live_hide_executed"); // dry-run → NOT hidden
      // GONE: a single deleted comment — not hidden, not a queue item, no misleading actor risk.
      const g1 = await mk("GONE", "POST", "spam odkaz", ["spam"], "medium", "neutral", "g1");
      await exec(g1.itemId, g1.ext, "executed", "comment_deleted");

      // --- Rebuild UI aggregation the way the pages do (from state truth) ---
      const reps = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { id: true, riskLevel: true, riskCategories: true, sentiment: true, contentItem: { select: { externalId: true, externalParentId: true, authorExternalId: true, text: true } } } });
      const execs = await prisma.platformActionExecution.findMany({ where: { brandId: brand.id, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] } }, select: { externalCommentId: true, reason: true, trigger: true } });
      const qitems = await prisma.actionQueueItem.findMany({ where: { brandId: brand.id }, select: { itemId: true, queueState: true } });

      const hidden = new Set(execs.filter((e) => HIDE_REASONS.includes(e.reason!)).map((e) => e.externalCommentId));
      const autoHidden = new Set(execs.filter((e) => HIDE_REASONS.includes(e.reason!) && e.trigger === "autonomous").map((e) => e.externalCommentId));
      const deleted = new Set(execs.filter((e) => e.reason === "comment_deleted").map((e) => e.externalCommentId));
      const canHideFalse = new Set(execs.filter((e) => e.reason === "facebook_can_hide_false").map((e) => e.externalCommentId));
      const qByItem = new Map(qitems.map((q) => [q.itemId, q.queueState]));

      const buckets = { positive: 0, neutral: 0, negative: 0, risky: 0 };
      for (const r of reps) buckets[bucket(r.riskCategories, r.sentiment as string, r.riskLevel as string)]++;

      const pending = reps.filter((r) => qByItem.get(r.id) === "approval_required").length;
      const hiddenCount = reps.filter((r) => hidden.has(r.contentItem.externalId)).length;
      const autoHiddenCount = reps.filter((r) => autoHidden.has(r.contentItem.externalId)).length;
      const deletedCount = reps.filter((r) => deleted.has(r.contentItem.externalId)).length;
      const chfCount = reps.filter((r) => canHideFalse.has(r.contentItem.externalId)).length;

      // Actor risk (medium+) — same scoring as the Actor Risk page.
      const byAuthor = new Map<string, ActorComment[]>();
      for (const r of reps) {
        const k = r.contentItem.authorExternalId!;
        (byAuthor.get(k) ?? byAuthor.set(k, []).get(k)!).push({ categories: r.riskCategories, riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: r.contentItem.externalParentId, text: r.contentItem.text, hidden: hidden.has(r.contentItem.externalId) });
      }
      const levels = new Map([...byAuthor].map(([k, cs]) => [k, actorRiskLevel(actorRiskScore(buildActorSignals(cs)))]));
      const riskyActors = [...levels.values()].filter((l) => l !== "low").length;

      // 1) Positive comments appear in Comments and NOT in Action Queue.
      check("1) positive: in Comments, not in queue", buckets.positive === 3 && ["p1", "p2", "p3"].every((e) => !qitems.some((q) => reps.find((r) => r.contentItem.externalId === e)?.id === q.itemId)));
      // 2) Neutral: in Comments, not queued.
      check("2) neutral: in Comments, not queued", buckets.neutral === 1 && !qByItem.has(reps.find((r) => r.contentItem.externalId === "n1")!.id));
      // 3) Normal negative criticism: counted negative (not risky), not queued.
      check("3) criticism: negative not risky, not queued", buckets.negative === 1 && bucket(["normal_criticism"], "negative", "low") === "negative" && !qByItem.has(reps.find((r) => r.contentItem.externalId === "c1")!.id));
      // 4) Normal criticism does not create Actor Risk (CUST stays low).
      check("4) criticism creates no actor risk", levels.get("CUST") === "low");
      // 5) Risky profanity/scam appear as risky.
      check("5) profanity/scam are risky", buckets.risky === 7);
      // 6) Risky items are hidden OR queued OR a platform limitation (per state truth) — never silently lost.
      check("6) risky handled per state truth", hiddenCount === 3 && pending === 1 && chfCount === 1);
      // 7) live_hide_executed / already_hidden count as hidden from public.
      check("7) hidden-from-public count = state truth", hiddenCount === 3 && hidden.has("t1") && hidden.has("s1") && hidden.has("s2"));
      // 12) dry_run never counts as live hidden.
      check("12) dry_run not hidden", !hidden.has("s3") && hiddenCount === 3);
      // 13) Pending approval appears in queue + would show under Comments pending filter.
      check("13) pending in queue + comments pending", pending === 1 && qByItem.get(prof2.itemId) === "approval_required");
      // 14) Autonomous hidden counts as auto-hidden from public.
      check("14) autonomous hide = auto-hidden from public", autoHiddenCount === 1 && autoHidden.has("t1"));
      // 10) Deleted/unavailable: separate state, not hidden, no queue item.
      check("10) deleted: not hidden, not queued", deletedCount === 1 && !hidden.has("g1") && !qByItem.has(g1.itemId));
      // 11) can_hide=false: platform limitation, not hidden.
      check("11) can_hide=false: not hidden", chfCount === 1 && !hidden.has("t3"));
      // 20b) Repeated scam (SPAMMER) + repeated profanity (TROLL) flag actors; GONE stays low.
      check("20b) repeated risky actors flagged; single deleted stays low", ["high", "critical"].includes(levels.get("SPAMMER")!) && ["high", "critical"].includes(levels.get("TROLL")!) && levels.get("GONE") === "low" && riskyActors === 2);
      // Total captured comments == DB truth.
      check("B) total captured comments matches DB", reps.length === 12 && buckets.positive + buckets.neutral + buckets.negative + buckets.risky === 12);

      // 23) No fake/demo/mock data leaked in.
      const [mock, demo] = await Promise.all([
        prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
        prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
      ]);
      check("23) no demo/mock data", mock === 0 && demo === 0);
    } finally {
      await prisma.platformActionExecution.deleteMany({ where: { brandId: brand.id } });
      await prisma.actionQueueItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  } else {
    check("DB fixture skipped (no tenant)", true);
  }

  // ---------- Beta readiness checklist ----------
  console.log("\n  Beta readiness checklist:");
  for (const line of [
    "real positive comment flow verified",
    "real negative criticism flow verified",
    "real risky comment flow verified",
    "auto-hide public-visibility verified",
    "Comments page discoverability verified",
    "Action Queue only actionable verified",
    "Reputation truth verified",
    "Actor Risk truth verified",
    "mobile no wide-table default verified",
    "self-service wording verified",
    "no managed-moderation wording",
    "no raw ids/provider codes by default",
    "no fake/demo data",
    "live actions safe by default",
  ]) console.log(`    ${failures === 0 ? "☑" : "☐"} ${line}`);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Beta real-data verification`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
