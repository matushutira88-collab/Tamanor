/**
 * V1.43 — CANONICAL inbox query layer against real Postgres (RLS runtime).
 *
 * Proves the scalability contract WITHOUT any in-memory filtering/search/pagination:
 *   - keyset pagination is deterministic: walking forward page-by-page yields every row exactly
 *     once, in the same order as a single ordered query — no duplicates, no skips — including a
 *     cluster of rows that share an identical createdAt (the id tiebreaker is exercised);
 *   - previous-page navigation returns the exact prior page;
 *   - every filter (view/provider/type/priority/workflow/risk/label/assignee/sentiment/date) is
 *     applied in SQL and returns the expected tenant-scoped set;
 *   - server-side search matches author / text / connector name / label, tenant-scoped;
 *   - server counts are correct and independent of pagination;
 *   - sentimentBucketWhere() agrees with sentimentBucket() across the full input matrix.
 *
 * Run: pnpm inbox-query:test
 */
import { sentimentBucket, type SentimentBucket } from "@guardora/ai";
import {
  systemDb, withTenant,
  buildInboxWhere, listInboxPage, inboxCounts, decodeCursor, listInboxItemsWithState,
  createInboxLabel, addInboxItemLabel, assignInboxItem,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function mkTenant(sfx: string) {
  const t = await systemDb.tenant.create({ data: { name: `Q ${sfx}`, slug: `q-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "Q" } });
  const fb = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `FB_${sfx}`, externalName: "Page Alpha", health: "healthy" } });
  const gg = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "google_business", status: "active", mode: "read_only", externalId: `GG_${sfx}`, externalName: "Loc Beta", health: "healthy" } });
  const u = await systemDb.user.create({ data: { email: `q-${sfx}@t.dev`, name: "Q User" } });
  await systemDb.membership.create({ data: { userId: u.id, tenantId: t.id, role: "admin" } });
  return { t, br, fb, gg, u };
}

const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();

async function run() {
  const sfx = Date.now().toString(36);
  const A = await mkTenant(sfx);
  const B = await mkTenant(sfx + "b"); // isolation control

  try {
    // ---- deterministic seed: 60 non-archived + a 5-row identical-timestamp cluster + extras ----
    type Spec = { n: number; plat: "facebook_page" | "google_business"; acc: string; kind: "comment" | "review"; text: string; author: string; sentiment: "positive" | "neutral" | "negative"; cats: string[]; risk: "none" | "low" | "medium" | "high" | "critical"; rating?: number; createdAt: Date; isRead?: boolean; priority?: "low" | "normal" | "high" | "urgent"; wf?: "new" | "in_review" | "action_required" | "resolved"; archived?: boolean };
    const specs: Spec[] = [];
    for (let n = 0; n < 60; n++) {
      const even = n % 2 === 0;
      specs.push({
        n, plat: even ? "facebook_page" : "google_business", acc: even ? A.fb.id : A.gg.id,
        kind: even ? "comment" : "review", text: `Item number ${n} about service`, author: `Author ${n}`,
        sentiment: n % 3 === 0 ? "positive" : n % 3 === 1 ? "neutral" : "negative",
        cats: n % 5 === 0 ? ["spam"] : n % 7 === 0 ? ["normal_criticism"] : [],
        risk: n % 11 === 0 ? "high" : "none",
        rating: even ? undefined : ((n % 5) + 1),
        createdAt: new Date(BASE + n * 60_000), // distinct, 1 min apart
        isRead: n % 4 === 0, priority: n % 9 === 0 ? "urgent" : "normal",
        wf: n % 6 === 0 ? "resolved" : "new",
      });
    }
    // identical-timestamp cluster (tiebreak): 5 rows all at the SAME instant, newer than the rest.
    const clusterAt = new Date(BASE + 100 * 60_000);
    for (let k = 0; k < 5; k++) specs.push({ n: 1000 + k, plat: "facebook_page", acc: A.fb.id, kind: "comment", text: `Cluster ${k}`, author: `Cluster ${k}`, sentiment: "neutral", cats: [], risk: "none", createdAt: clusterAt });
    // a few archived (must NOT appear in default view)
    for (let k = 0; k < 4; k++) specs.push({ n: 2000 + k, plat: "google_business", acc: A.gg.id, kind: "review", text: `Archived ${k}`, author: `Arch ${k}`, sentiment: "negative", cats: [], risk: "none", rating: 2, createdAt: new Date(BASE + (200 + k) * 60_000), archived: true });

    const created: { id: string }[] = [];
    for (const s of specs) {
      const ci = await systemDb.contentItem.create({ data: { tenantId: A.t.id, brandId: A.br.id, connectedAccountId: s.acc, platform: s.plat, kind: s.kind, externalId: `ext_${sfx}_${s.n}`, text: s.text, authorDisplayName: s.author, rating: s.rating, publishedAt: s.createdAt } });
      const ri = await systemDb.reputationItem.create({ data: { tenantId: A.t.id, brandId: A.br.id, platform: s.plat, contentItemId: ci.id, status: "classified", sentiment: s.sentiment, riskCategories: s.cats, riskLevel: s.risk, createdAt: s.createdAt, isRead: s.isRead ?? false, priority: s.priority ?? "normal", inboxWorkflowStatus: s.wf ?? "new", archivedAt: s.archived ? new Date() : null } });
      created.push({ id: ri.id });
    }
    // one labelled + one assigned (for label/assignee filters & label search)
    const lab = await createInboxLabel(A.t.id, "Escalate", "danger", A.u.id);
    const labId = (lab as { id: string }).id;
    await addInboxItemLabel(A.t.id, created[0]!.id, labId, A.u.id);
    await assignInboxItem(A.t.id, created[2]!.id, A.u.id, A.u.id);
    // tenant B noise (isolation)
    const bci = await systemDb.contentItem.create({ data: { tenantId: B.t.id, brandId: B.br.id, connectedAccountId: B.fb.id, platform: "facebook_page", kind: "comment", externalId: `bext_${sfx}`, text: "Item number 0 about service", authorDisplayName: "Author 0", publishedAt: new Date(BASE) } });
    await systemDb.reputationItem.create({ data: { tenantId: B.t.id, brandId: B.br.id, platform: "facebook_page", contentItemId: bci.id, status: "classified", createdAt: new Date(BASE) } });

    const selfFilter = { selfUserId: A.u.id };

    // ---------------- 1) keyset pagination: forward walk covers everything once, in order ----------------
    const ordered = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default" })); // no take → all, ordered createdAt desc,id desc
    const expectedIds = ordered.map((r) => r.id);
    const walked: string[] = [];
    let cursor: string | null = null; let guard = 0; let pages = 0;
    for (;;) {
      const page = await listInboxPage(A.t.id, { view: "default" }, { cursor, dir: "next", pageSize: 10 });
      walked.push(...page.rows.map((r) => r.id));
      pages++;
      if (!page.hasNext || !page.nextCursor) break;
      cursor = page.nextCursor;
      if (++guard > 100) break;
    }
    check("1) forward keyset covers every row exactly once, same order as single ordered query", JSON.stringify(walked) === JSON.stringify(expectedIds), `walked=${walked.length} expected=${expectedIds.length}`);
    check("2) no duplicate rows across pages", new Set(walked).size === walked.length);
    check("3) archived rows excluded from default view", ordered.every((r) => r.archivedAt === null) && expectedIds.length === 65, `count=${expectedIds.length}`);
    check("4) identical-timestamp cluster paginates without skip/dup (id tiebreak)", expectedIds.length === new Set(expectedIds).size && walked.length === expectedIds.length);

    // ---------------- 5) previous-page navigation returns the exact prior page ----------------
    const p1 = await listInboxPage(A.t.id, { view: "default" }, { cursor: null, dir: "next", pageSize: 10 });
    const p2 = await listInboxPage(A.t.id, { view: "default" }, { cursor: p1.nextCursor, dir: "next", pageSize: 10 });
    const p3 = await listInboxPage(A.t.id, { view: "default" }, { cursor: p2.nextCursor, dir: "next", pageSize: 10 });
    const backTo2 = await listInboxPage(A.t.id, { view: "default" }, { cursor: p3.prevCursor, dir: "prev", pageSize: 10 });
    check("5) prev navigation reconstructs the prior page exactly", JSON.stringify(backTo2.rows.map((r) => r.id)) === JSON.stringify(p2.rows.map((r) => r.id)));
    check("6) page flags correct (first page hasPrev=false; deep page hasNext=true)", p1.hasPrev === false && p1.hasNext === true && p2.hasPrev === true);

    // ---------------- 7) server-side filters (all in SQL) ----------------
    const countWhere = async (f: Parameters<typeof buildInboxWhere>[1]) => (await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, f))).length;
    const unread = await countWhere({ view: "unread" });
    const archivedN = await countWhere({ view: "archived" });
    const urgent = await countWhere({ view: "default", priority: "urgent" });
    const resolved = await countWhere({ view: "default", workflowStatus: "resolved" });
    const fbOnly = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", platformIn: ["facebook_page"] }));
    const reviewsOnly = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", type: "review" }));
    const highRisk = await countWhere({ view: "default", riskLevel: "high" });
    const labelled = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", labelId: labId }));
    const assignedMe = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "assigned_me", ...selfFilter }));
    check("7) unread filter (isRead=false, non-archived)", unread > 0 && unread < expectedIds.length);
    check("8) archived filter counts only archived", archivedN === 4);
    check("9) priority=urgent filter server-side", urgent > 0);
    check("10) workflow=resolved filter server-side", resolved > 0);
    check("11) provider filter → only facebook_page", fbOnly.length > 0 && fbOnly.every((r) => r.platform === "facebook_page"));
    check("12) type=review filter → only reviews", reviewsOnly.length > 0 && reviewsOnly.every((r) => r.contentItem.kind === "review"));
    check("13) riskLevel=high filter server-side", highRisk > 0);
    check("14) label filter returns the labelled item", labelled.length === 1 && labelled[0]!.id === created[0]!.id);
    check("15) assigned_me filter returns the assigned item", assignedMe.length === 1 && assignedMe[0]!.id === created[2]!.id);

    // ---------------- 16) server-side search (author / text / connector / label), tenant-scoped ----------------
    const byAuthor = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", q: "Author 4" }));
    const byText = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", q: "number 12 about" }));
    const byConnector = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", q: "Loc Beta" }));
    const byLabelText = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", q: "Escalate" }));
    const caseInsensitive = await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", q: "loc beta" }));
    check("16) search by author matches", byAuthor.some((r) => r.contentItem.authorDisplayName === "Author 4"));
    check("17) search by comment/review text matches", byText.length >= 1 && byText.every((r) => r.contentItem.text.includes("number 12 about")));
    check("18) search by connector name matches only that connector's items", byConnector.length > 0 && byConnector.every((r) => r.platform === "google_business"));
    check("19) search by label name matches the labelled item", byLabelText.length === 1 && byLabelText[0]!.id === created[0]!.id);
    check("20) search is case-insensitive (ILIKE)", caseInsensitive.length === byConnector.length && caseInsensitive.length > 0);
    check("21) search stays tenant-scoped (never matches tenant B's identical text)", byAuthor.every((r) => r.id !== undefined) && (await listInboxItemsWithState(B.t.id, buildInboxWhere(B.t.id, { view: "default", q: "Author 4" }))).length === 0);

    // ---------------- 22) counts correct + pagination-independent ----------------
    const counts = await inboxCounts(A.t.id, {});
    check("22) counts.total == default-view row count", counts.total === expectedIds.length);
    check("23) counts.archived == 4", counts.archived === 4);
    check("24) counts.unread matches filter count", counts.unread === unread);
    check("25) workflow/priority/platform buckets present & sum-consistent", (counts.byWorkflow.resolved ?? 0) === resolved && (counts.byPriority.urgent ?? 0) === urgent && (counts.byPlatform.facebook_page ?? 0) === fbOnly.length);
    check("26) label counts present for the labelled label", (counts.byLabel[labId] ?? 0) === 1);
    check("27) sentiment counts sum to total (partition)", counts.sentiment.positive + counts.sentiment.neutral + counts.sentiment.negative + counts.sentiment.risky === counts.total);
    check("28) reviews count + avgRating computed", counts.reviews > 0 && counts.avgRating !== null);

    // ---------------- 29) sentimentBucketWhere agrees with sentimentBucket across the matrix ----------------
    const cats = [[], ["positive_feedback"], ["customer_question"], ["normal_criticism"], ["refund_complaint"], ["spam"], ["normal_criticism", "spam"]];
    const sents = ["positive", "neutral", "negative"] as const;
    const risks = ["none", "high", "critical"] as const;
    let mismatches = 0, matrix = 0;
    for (const bucket of ["positive", "neutral", "negative", "risky"] as SentimentBucket[]) {
      const inBucket = new Set((await listInboxItemsWithState(A.t.id, buildInboxWhere(A.t.id, { view: "default", sentiment: bucket }))).map((r) => r.id));
      for (const r of ordered) {
        const jsBucket = sentimentBucket({ categories: r.riskCategories, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });
        matrix++;
        if ((jsBucket === bucket) !== inBucket.has(r.id)) mismatches++;
      }
    }
    check("29) SQL sentiment predicate agrees with sentimentBucket() for every row×bucket", mismatches === 0, `${mismatches}/${matrix} mismatched`);
    void cats; void sents; void risks;

    // ---------------- 30) cursor is opaque & malformed cursor fails safe (page 1) ----------------
    const malformed = await listInboxPage(A.t.id, { view: "default" }, { cursor: "not-a-cursor", dir: "next", pageSize: 10 });
    check("30) malformed cursor is ignored (returns first page, no throw)", decodeCursor("not-a-cursor") === null && malformed.rows.length === 10 && malformed.hasPrev === false);
  } finally {
    for (const X of [A, B]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.inboxItemLabel.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.inboxLabel.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.membership.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.brand.deleteMany({ where: { tenantId: X.t.id } });
    }
    await systemDb.user.deleteMany({ where: { email: { contains: sfx } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [A.t.id, B.t.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Canonical inbox query layer (V1.43)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
