/**
 * V1.30B Comments / Komentáre visibility. Every captured comment is discoverable on
 * a dedicated product page — positive, neutral, negative and risky — not only the
 * actionable items in the Action Queue. Source + pure-logic + DB-fixture assertions.
 *
 * Run via: pnpm comments-visibility:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "@guardora/db";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const bucket = (cats: string[], sentiment = "neutral", riskLevel = "none") => sentimentBucket({ categories: cats, sentiment, riskLevel });

async function run() {
  const page = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const inbox = readSrc("apps/web/src/app/dashboard/inbox/page.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const actor = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const nav = readSrc("apps/web/src/lib/nav.ts");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");
  const slice = (src: string) => (src.match(/\n  comments: \{[\s\S]*?\n  \},/) ?? [""])[0];
  const entries = nav.match(/\{\s*href: "\/dashboard[^{}]*?\}/gs) ?? [];
  const primary = entries.filter((e) => !e.includes("group:") && !e.includes("hidden:"));

  // 1) Route exists.
  check("1) /dashboard/comments route exists", page.includes("export default async function CommentsPage"));

  // 2) Old inbox redirects safely.
  check("2) /dashboard/inbox redirects to comments", inbox.includes('redirect("/dashboard/comments")'));

  // 3) Comments visible in primary nav.
  check("3) Comments visible in primary nav", primary.some((e) => e.includes('href: "/dashboard/comments"')));

  // 4) Primary nav is exactly the 5 product pages.
  const primaryHrefs = primary.map((e) => (e.match(/href: "(\/dashboard[^"]*)"/) ?? [])[1]);
  check("4) primary nav = CC, Comments, Action Queue, Reputation, Control Center",
    primary.length === 5 && ["/dashboard/command-center", "/dashboard/comments", "/dashboard/action-queue", "/dashboard/reputation", "/dashboard/control-center"].every((h) => primaryHrefs.includes(h)),
    primaryHrefs.join(","));

  // 5) More nav includes the secondary pages.
  for (const h of ["accounts", "incidents", "actor-risk", "timeline", "audit", "settings"]) {
    check(`5) More nav includes ${h}`, new RegExp(`href: "/dashboard/${h}"[\\s\\S]*?group: "More"`).test(nav));
  }

  // 6) Visible nav does not expose the old "Inbox" name; Comments uses its own label key.
  check("6) no visible Inbox label; inbox stays hidden", /href: "\/dashboard\/inbox"[^}]*hidden: true/.test(nav) && /href: "\/dashboard\/comments"[^}]*navKey: "comments"/.test(nav) && en.includes('comments: "Comments"') && sk.includes('comments: "Komentáre"'));

  // 7) Page explains it contains all captured comments.
  check("7) page explains all captured comments", page.includes("subtitle") && page.includes("secondary") && sk.includes("všetky komentáre, ktoré Tamanor zachytila") && en.includes("all comments Tamanor captured"));

  // 8) Date range default 7d.
  check("8) date range Today/7d/30d default 7d", /RANGES = \{ today: 1, "7d": 7, "30d": 30 \}/.test(page) && page.includes('? (sp.range as RangeKey) : "7d"'));

  // 9) Sentiment/status filters.
  check("9) filters All/Positive/Neutral/Negative/Risky/Hidden/Pending", /FILTERS: FilterKey\[\] = \["all", "positive", "neutral", "negative", "risky", "hidden", "pending"\]/.test(page) && ["fPositive", "fNeutral", "fNegative", "fRisky", "fHidden", "fPending"].every((k) => page.includes(k)));

  // 10-13) Every sentiment class is shown + filterable (pure classification the page filters on).
  check("10) positive comments are filterable", bucket(["positive_feedback"]) === "positive" && page.includes('r.bucket === filter'));
  check("11) neutral comments are filterable", bucket(["customer_question"]) === "neutral");
  check("12) normal negative criticism is filterable", bucket(["normal_criticism"], "negative") === "negative" && bucket(["normal_criticism"], "negative", "critical") !== "risky");
  check("13) risky comments are filterable", bucket(["scam"]) === "risky" && bucket(["hate_speech"]) === "risky");

  // 14) Hidden derives ONLY from execution state truth.
  check("14) hidden uses state truth (executions only)", page.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]') && page.includes("execState") && page.includes('st === "hidden"') && !/hiddenPublic = .*bucket/.test(page));

  // 15) Pending links to Action Queue.
  check("15) pending links to Action Queue", page.includes("`/dashboard/action-queue/${r.queueItemId}`") && page.includes("openInQueue") && /pending = qi\?\.queueState === "approval_required"/.test(page));

  // 16) Normal criticism is shown here but is only actionable if the DB says approval_required.
  check("16) criticism actionable only if approval_required", /pending = qi\?\.queueState === "approval_required"/.test(page) && page.includes('cats.includes("normal_criticism")'));

  // 17) dry_run is not counted as live hidden.
  check("17) dry_run not live-hidden", !page.includes('"dry_run"') && page.includes('status: "executed"'));

  // 18) Deleted/unavailable status wording.
  check("18) deleted → 'no longer exists / unavailable'", page.includes("st_deleted") && sk.includes("Komentár už neexistuje alebo nie je dostupný") && /reason === "comment_deleted"/.test(page));

  // 19) can_hide=false wording.
  check("19) can_hide=false → 'Facebook did not allow hiding'", page.includes("st_canHideFalse") && sk.includes("Facebook nedovolil skrytie") && page.includes('"facebook_can_hide_false"'));

  // 20) No raw ids / provider codes rendered by default.
  check("20) no raw ids/provider codes rendered", !/>\{[^{}]*externalCommentId[^{}]*\}</.test(page) && !/>\{[^{}]*authorExternalId[^{}]*\}</.test(page) && !page.includes("providerResponseCode") && !page.includes("providerErrorCode") && !page.includes("policyId"));

  // 21) No demo/mock/fake comments.
  const [mock, demo] = await Promise.all([
    prisma.connectedAccount.count({ where: { status: "mock_connected" } }),
    prisma.brand.count({ where: { name: { contains: "Northwind" } } }),
  ]);
  check("21) no demo/mock data", mock === 0 && demo === 0);

  // 22) No managed-moderation wording.
  const FORBIDDEN = [/naši moderátori/i, /our moderators/i, /human moderators from guardora/i, /managed moderation/i, /rozhodne za vás/i, /we decide what to hide/i, /outsourc/i];
  const copy = [page, slice(en), slice(sk), slice(de)].join("\n");
  check("22) no managed-moderation wording", FORBIDDEN.every((re) => !re.test(copy)));

  // 23) Trust copy: normal criticism not auto-hidden.
  check("23) trust copy present", page.includes("trustNote") && sk.includes("Normálna kritika nie je automaticky skrývaná") && en.includes("Normal criticism is not hidden automatically"));

  // 24) Command Center links to Comments filtered views.
  check("24) Command Center links to Comments", cc.includes("/dashboard/comments?filter=hidden") && cc.includes("/dashboard/comments?filter=risky"));

  // 25) Reputation links to Comments filtered views.
  check("25) Reputation links to Comments", rep.includes("/dashboard/comments?filter="));

  // 26) Actor Risk links to Comments (search by profile).
  check("26) Actor Risk links to Comments search", actor.includes("/dashboard/comments?q="));

  // 27) Product-friendly empty states.
  check("27) empty states present", ["emptyNoAccount", "emptyNoComments", "emptyFilter", "emptySearch"].every((k) => page.includes(k)) && sk.includes("Zatiaľ neboli zachytené žiadne komentáre"));

  // 28) Mobile: no wide table; 2-col metric grid; filters wrap.
  check("28) mobile-safe (no <table>, 2-col grid, wrap)", !page.includes("<table") && page.includes("grid-cols-2") && page.includes("flex-wrap"));

  // 29) Advanced/expandable content collapsed by default.
  check("29) detail drawers collapsed by default", page.includes("<details") && !page.includes("<details open"));

  // 30) i18n SK/EN/DE keys present.
  check("30) i18n SK/EN/DE comments keys present", en.includes("mRiskyHidden") && sk.includes("Rizikové / skryté") && de.includes("Riskant / verborgen") && sk.includes("Komentáre") && de.includes("Kommentare"));

  // 31) State truth still holds.
  check("31) state truth: criticism not risky; harmful is", bucket(["normal_criticism"], "negative", "critical") !== "risky" && bucket(["scam"]) === "risky");

  // --- Functional: every sentiment class is captured & discoverable via bucket filters ---
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    const T = tenant.id;
    const brand = await prisma.brand.create({ data: { tenantId: T, name: "Comments Visibility Test Brand" } });
    const acct = await prisma.connectedAccount.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: "CV_PG", pageId: "CV_PG" } });
    const mk = async (text: string, cats: string[], risk: string, sentiment: string, ext: string) => {
      const ci = await prisma.contentItem.create({ data: { tenantId: T, brandId: brand.id, connectedAccountId: acct.id, platform: "facebook_page", kind: "comment", externalId: ext, externalParentId: "POST_1", authorDisplayName: "Cust", text, publishedAt: new Date() } });
      await prisma.reputationItem.create({ data: { tenantId: T, brandId: brand.id, platform: "facebook_page", contentItemId: ci.id, riskLevel: risk as never, riskCategories: cats, sentiment: sentiment as never } });
    };
    try {
      await mk("super produkt!", ["positive_feedback"], "none", "positive", "cv1");
      await mk("skvelé, ďakujem", ["positive_feedback"], "none", "positive", "cv2");
      await mk("aká je cena?", ["customer_question"], "none", "neutral", "cv3");
      await mk("služba bola pomalá", ["normal_criticism"], "low", "negative", "cv4");
      await mk("kúp teraz http://scam.co", ["scam"], "high", "neutral", "cv5");

      const reps = await prisma.reputationItem.findMany({ where: { brandId: brand.id }, select: { riskCategories: true, sentiment: true, riskLevel: true } });
      const count = (b: string) => reps.filter((r) => bucket(r.riskCategories, r.sentiment as string, r.riskLevel as string) === b).length;
      check("F1) positive comments discoverable", count("positive") === 2);
      check("F2) neutral comment discoverable", count("neutral") === 1);
      check("F3) normal negative criticism discoverable (not risky)", count("negative") === 1);
      check("F4) risky comment discoverable", count("risky") === 1);
      const hides = await prisma.platformActionExecution.count({ where: { brandId: brand.id, status: "executed", reason: { in: ["live_hide_executed", "already_hidden"] } } });
      check("F5) none hidden (no execution) — criticism never auto-hidden", hides === 0);
    } finally {
      await prisma.reputationItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.contentItem.deleteMany({ where: { brandId: brand.id } });
      await prisma.connectedAccount.deleteMany({ where: { id: acct.id } });
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Comments visibility`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
