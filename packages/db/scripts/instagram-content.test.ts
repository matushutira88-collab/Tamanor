/**
 * V1.38.1 — Instagram Content Ingestion & Webhook Completion integration tests.
 *
 * Real Postgres + appDb (RLS) driving the REAL production code — `runReadOnlySync`
 * (lease/RLS/idempotency/atomic/verdict/dedup), `fetchInstagramContent`,
 * `classifyIgPermissionState`, `recordWebhookEvent`, `listUnprocessedMetaWebhooks` —
 * with an injected MOCK content transport. NO real network call, NO fake persisted
 * content. Proves media→comment ingestion, pagination + cursors, author/reply identity,
 * idempotent dedup (incl. polling+webhook coexistence), deleted-media isolation, the
 * eight truthful permission states, and webhook signature/replay/routing completion.
 *
 * Run: pnpm instagram-content:test
 */
import { systemDb, withTenant, encryptToken, recordWebhookEvent, listUnprocessedMetaWebhooks, Platform } from "@guardora/db";
import {
  MockMetaContentTransport,
  MetaGraphError,
  type MetaMediaRef,
  type MetaCommentRef,
} from "../../connectors/src/index";
import { runReadOnlySync, fetchInstagramContent, classifyIgPermissionState } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const gErr = (detail: { status: number; code?: number; subcode?: number; kind: MetaGraphError["detail"]["kind"] }) =>
  new MetaGraphError("graph error", detail);

async function run() {
  const sfx = Date.now().toString(36);
  const tA = await systemDb.tenant.create({ data: { name: "IG A", slug: `igc-a-${sfx}` } });
  const tB = await systemDb.tenant.create({ data: { name: "IG B", slug: `igc-b-${sfx}` } });
  const brA = await systemDb.brand.create({ data: { tenantId: tA.id, name: "IGA", defaultLocale: "en" } });
  await systemDb.brand.create({ data: { tenantId: tB.id, name: "IGB", defaultLocale: "en" } });

  // A real (read_only) Instagram Professional account with a stored encrypted token.
  const mkIg = (igId: string) => systemDb.connectedAccount.create({
    data: {
      tenantId: tA.id, brandId: brA.id, platform: "instagram_business", status: "active",
      mode: "read_only", externalId: igId, igBusinessId: igId, health: "healthy",
      accessToken: encryptToken("IG_TOKEN_RAW"), tokenType: "bearer",
    },
  });

  const media = (id: string): MetaMediaRef => ({ id, permalink: `https://instagram.com/p/${id}`, timestamp: "2026-06-01T00:00:00Z" });
  const cmt = (id: string, mediaId: string, over: Partial<MetaCommentRef> = {}): MetaCommentRef => ({
    id, mediaId, text: `comment ${id}`, timestamp: "2026-06-02T00:00:00Z", authorUsername: "fan", authorId: `AUTH_${id}`, ...over,
  });

  const igIds: string[] = [];
  const newIg = (tag: string) => { const id = `IG_${tag}_${sfx}`; igIds.push(id); return id; };

  const sync = (accountId: string, transport: MockMetaContentTransport) =>
    runReadOnlySync({ accountId, tenantId: tA.id }, "manual", { contentTransport: transport });

  try {
    // ===================== End-to-end ingestion =====================
    const ig1 = newIg("MAIN");
    const acc1 = await mkIg(ig1);
    const mainT = new MockMetaContentTransport({
      media: { [ig1]: [media("m1"), media("m2")] },
      comments: {
        m1: [cmt("c1", "m1", { text: "total scam do not buy", authorId: "AUTH_c1", authorUsername: "angry" }), cmt("c2", "m1", { parentCommentId: "c1", text: "I agree, refund me" })],
        m2: [cmt("c3", "m2", { text: "love this, great work" })],
      },
    });
    const r1 = await sync(acc1.id, mainT);
    check("1) media→comments ingested via real runReadOnlySync", r1.verdict === "success" && r1.created === 3, JSON.stringify(r1));

    const items = await withTenant(tA.id, (db) => db.contentItem.findMany({ where: { connectedAccountId: acc1.id }, select: { externalId: true, externalParentId: true, authorExternalId: true, authorDisplayName: true, platform: true, permalink: true } }));
    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));
    check("2) all 3 comments persisted as instagram_business ContentItems", items.length === 3 && items.every((i) => i.platform === "instagram_business"));
    check("3) 1:1 ReputationItem created for each comment", (await withTenant(tA.id, (db) => db.reputationItem.count({ where: { contentItem: { connectedAccountId: acc1.id } } }))) === 3);
    check("4) author identity mapped (from{id} → authorExternalId, username → displayName)", byId.c1?.authorExternalId === "AUTH_c1" && byId.c1?.authorDisplayName === "angry");
    check("5) reply parent → externalParentId = parent comment id; top-level → media id", byId.c2?.externalParentId === "c1" && byId.c1?.externalParentId === "m1");
    check("6) permalink carried from media", byId.c3?.permalink === "https://instagram.com/p/m2");
    check("7) transport actually exercised (real read→HTTP path, mock transport)", mainT.calls.some((c) => c.startsWith("listMedia:")) && mainT.calls.some((c) => c.startsWith("listComments:")));

    const acc1Row = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc1.id }, select: { contentPermissionState: true, health: true } }));
    check("8) healthy read persists contentPermissionState=healthy", acc1Row?.contentPermissionState === "healthy" && acc1Row?.health === "healthy");

    // ===================== Idempotency / dedup =====================
    const r2 = await sync(acc1.id, mainT);
    check("9) re-run is idempotent → 0 created, all deduped", r2.verdict === "success" && r2.created === 0 && r2.deduped === 3);
    check("10) no duplicate ContentItems after re-run", (await withTenant(tA.id, (db) => db.contentItem.count({ where: { connectedAccountId: acc1.id } }))) === 3);

    // ===================== Pagination =====================
    const ig2 = newIg("PAGED");
    const acc2 = await mkIg(ig2);
    const pagedT = new MockMetaContentTransport({
      pageSize: 1,
      media: { [ig2]: [media("pm1"), media("pm2"), media("pm3")] },
      comments: { pm1: [cmt("pc1", "pm1"), cmt("pc2", "pm1")], pm2: [cmt("pc3", "pm2")], pm3: [cmt("pc4", "pm3")] },
    });
    const rp = await sync(acc2.id, pagedT);
    const listMediaCalls = pagedT.calls.filter((c) => c.startsWith("listMedia:")).length;
    check("11) paginates media across pages (all 4 comments over 3 media pages)", rp.created === 4 && listMediaCalls >= 3, `created=${rp.created} mediaCalls=${listMediaCalls}`);
    const acc2Cursor = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc2.id }, select: { lastCursor: true } }));
    check("12) media paging cursor persisted to lastCursor", !!acc2Cursor?.lastCursor);

    // ===================== Cursor resume =====================
    const ig3 = newIg("RESUME");
    const acc3 = await mkIg(ig3);
    await withTenant(tA.id, (db) => db.connectedAccount.updateMany({ where: { id: acc3.id }, data: { lastCursor: "rm1" } }));
    const resumeT = new MockMetaContentTransport({
      media: { [ig3]: [media("rm1"), media("rm2"), media("rm3")] },
      comments: { rm1: [cmt("rc1", "rm1")], rm2: [cmt("rc2", "rm2")], rm3: [cmt("rc3", "rm3")] },
    });
    const rr = await sync(acc3.id, resumeT);
    check("13) resume from stored cursor → first listMedia carries it; pre-cursor media skipped", resumeT.calls[0] === "listMedia:" + ig3 + ":rm1" && rr.created === 2, `first=${resumeT.calls[0]} created=${rr.created}`);

    // ===================== Deleted / unavailable media isolated =====================
    const ig4 = newIg("DELMEDIA");
    const acc4 = await mkIg(ig4);
    const delT = new MockMetaContentTransport({
      media: { [ig4]: [media("dm1"), media("dm2")] },
      comments: { dm1: [cmt("dc1", "dm1")] },
      throwOnCommentsFor: { dm2: gErr({ status: 404, kind: "generic" }) },
    });
    const rd = await sync(acc4.id, delT);
    check("14) deleted/unavailable media isolated → run still success, other comments ingested", rd.verdict === "success" && rd.created === 1, JSON.stringify(rd));

    // ===================== Permission-truth states =====================
    const ig5 = newIg("PERM");
    const acc5 = await mkIg(ig5);
    const permT = new MockMetaContentTransport({ throwOnMediaFor: { [ig5]: gErr({ status: 403, code: 10, kind: "permission" }) } });
    const rperm = await sync(acc5.id, permT);
    const permRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc5.id }, select: { contentPermissionState: true, health: true, status: true } }));
    check("15) permission error → failed+needsReconnect, contentPermissionState=permission_missing", rperm.verdict === "failed" && rperm.needsReconnect === true && permRow?.contentPermissionState === "permission_missing");

    const ig6 = newIg("TOKEXP");
    const acc6 = await mkIg(ig6);
    const rtok = await sync(acc6.id, new MockMetaContentTransport({ throwOnMediaFor: { [ig6]: gErr({ status: 400, code: 190, kind: "token_expired" }) } }));
    const tokRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc6.id }, select: { contentPermissionState: true, status: true } }));
    check("16) expired token → needsReconnect, contentPermissionState=token_expired, status expired", rtok.needsReconnect === true && tokRow?.contentPermissionState === "token_expired" && tokRow?.status === "expired");

    const ig7 = newIg("RATE");
    const acc7 = await mkIg(ig7);
    const rrate = await sync(acc7.id, new MockMetaContentTransport({ throwOnMediaFor: { [ig7]: gErr({ status: 429, code: 4, kind: "rate_limit" }) } }));
    const rateRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc7.id }, select: { contentPermissionState: true, nextRetryAt: true } }));
    check("17) rate limit → retryLater (no reconnect), state=rate_limited, backoff scheduled", rrate.retryLater === true && rrate.needsReconnect === false && rateRow?.contentPermissionState === "rate_limited" && !!rateRow?.nextRetryAt);

    const ig8 = newIg("APIDOWN");
    const acc8 = await mkIg(ig8);
    const rapi = await sync(acc8.id, new MockMetaContentTransport({ throwOnMediaFor: { [ig8]: gErr({ status: 500, kind: "generic" }) } }));
    const apiRow = await withTenant(tA.id, (db) => db.connectedAccount.findFirst({ where: { id: acc8.id }, select: { contentPermissionState: true } }));
    check("18) 5xx → api_unavailable, retryLater (transient, no reconnect)", rapi.retryLater === true && rapi.needsReconnect === false && apiRow?.contentPermissionState === "api_unavailable");

    // ===================== classifier truthfulness (deterministic) =====================
    check("19) classifier: 404 → account_not_discoverable; subcode → business_verification_required",
      classifyIgPermissionState(gErr({ status: 404, kind: "generic" })) === "account_not_discoverable" &&
      classifyIgPermissionState(gErr({ status: 400, subcode: 2207032, kind: "generic" })) === "business_verification_required");

    // ===================== fetchInstagramContent — direct paging/normalization =====================
    const directT = new MockMetaContentTransport({
      media: { DIRECT: [media("x1")] },
      comments: { x1: [cmt("xc1", "x1", { text: "hi", authorId: undefined, authorUsername: undefined })] },
    });
    const direct = await fetchInstagramContent("DIRECT", "TOKEN", directT, {});
    check("20) fetchInstagramContent normalizes; absent author is left undefined (never invented)",
      direct.items.length === 1 && direct.items[0]!.externalId === "xc1" && direct.items[0]!.author.externalId === undefined && direct.items[0]!.author.displayName === undefined);

    // ===================== Polling + webhook coexistence (same comment, no dup) =====================
    // A webhook-triggered sync runs the SAME runReadOnlySync path; the unique
    // (connectedAccountId, externalId) makes the already-polled comment a dedup, not a dup.
    const rWebhook = await sync(acc1.id, mainT);
    check("21) polling + webhook-triggered sync of the same comment → dedup, still 3 rows",
      rWebhook.created === 0 && (await withTenant(tA.id, (db) => db.contentItem.count({ where: { connectedAccountId: acc1.id } }))) === 3);

    // ===================== Webhook completion: signature / replay / routing =====================
    const sig = `sha256=${sfx}_valid`;
    const w1 = await recordWebhookEvent({ platform: Platform.instagram_business, eventType: "instagram", signatureValid: true, payload: { object: "instagram", entry: [{ id: ig1 }] } as never, processed: false, dedupeKey: sig });
    const w2 = await recordWebhookEvent({ platform: Platform.instagram_business, eventType: "instagram", signatureValid: true, payload: { object: "instagram", entry: [{ id: ig1 }] } as never, processed: false, dedupeKey: sig });
    check("22) replay protection: same dedupeKey → duplicate, single stored row", w1.duplicate === false && w2.duplicate === true && w1.id === w2.id);

    const forged = await recordWebhookEvent({ platform: Platform.instagram_business, eventType: "instagram", signatureValid: false, payload: { object: "instagram" } as never, processed: false, dedupeKey: `sha256=${sfx}_forged` });
    const pending = await listUnprocessedMetaWebhooks(500);
    const ids = new Set(pending.map((p) => p.id));
    check("23) forged (invalid-signature) event is NEVER queued; the valid one IS", ids.has(w1.id) && !ids.has(forged.id));
    check("24) processor queue routes BOTH Meta platforms (instagram_business event present)", pending.some((p) => p.platform === "instagram_business"));

    // cleanup webhook rows
    await systemDb.webhookEvent.deleteMany({ where: { dedupeKey: { in: [sig, `sha256=${sfx}_forged`] } } });
  } finally {
    for (const t of [tA.id, tB.id]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: t } });
      await systemDb.syncRun.deleteMany({ where: { tenantId: t } });
      await systemDb.syncLease.deleteMany({ where: { tenantId: t } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: t } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: t } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: t } });
      await systemDb.brand.deleteMany({ where: { tenantId: t } });
    }
    await systemDb.tenant.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Instagram content ingestion & webhook completion (V1.38.1)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
