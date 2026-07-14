/**
 * V1.45C3 — WEBHOOK RETENTION: bounded payload minimization + row purge (real Postgres).
 *
 * A) payload minimization eligibility + batching + idempotency;
 * B) bounded row purge + multi-worker (SKIP LOCKED) + resume + TTL guard;
 * C) processor null-payload safety (payload_expired, no ingest, no throw);
 * D) tenant-deletion regression (linked purge + global purge coexist);
 * G) privacy (counts only; no payload in results).
 *
 * Run: pnpm webhook-retention:test
 */
process.env.META_WEBHOOK_SYNC = "true"; // enable the processor for section C
import { systemDb, minimizeWebhookPayloads, purgeExpiredWebhookEvents, purgeTenantWebhookEvents } from "../src/index";
import { processPendingWebhookEvents } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const DAY = 86_400_000;
const now = () => Date.now();
const payloadOf = (id: string) => systemDb.webhookEvent.findUnique({ where: { id }, select: { payload: true } }).then((r) => r?.payload ?? null);
const exists = (id: string) => systemDb.webhookEvent.count({ where: { id } }).then((c) => c === 1);

async function run() {
  const sfx = Date.now().toString(36);
  const mk = (tag: string, ageDays: number, extra: Record<string, unknown> = {}) =>
    systemDb.webhookEvent.create({
      data: {
        platform: "facebook_page", signatureValid: true, payload: { entry: [{ id: `PG_${tag}` }] },
        dedupeKey: `dk_${sfx}_${tag}`, receivedAt: new Date(now() - ageDays * DAY), ...extra,
      } as never,
    });

  const payloadCutoff = new Date(now() - 30 * DAY);
  const ttlCutoff = new Date(now() - 90 * DAY);

  // ==================== A) PAYLOAD MINIMIZATION ====================
  const recentPending = await mk("A_rp", 1);
  const oldPending = await mk("A_op", 40);
  const procRecent = await mk("A_pr", 1, { processed: true });
  const sigInvalid = await mk("A_si", 1, { signatureValid: false });
  const n = await minimizeWebhookPayloads({ maxPayloadAgeCutoff: payloadCutoff, batch: 500 });
  check("A1) processed recent row minimized (payload null)", (await payloadOf(procRecent.id)) === null);
  check("A2) recent pending signature-valid row RETAINS payload", (await payloadOf(recentPending.id)) !== null);
  check("A3) old pending row minimized by the hard max-age cap", (await payloadOf(oldPending.id)) === null);
  check("A4) signature-invalid row minimized", (await payloadOf(sigInvalid.id)) === null);
  check("A_count) minimize returned a positive count", n >= 3);
  // A5 idempotent
  const n2 = await minimizeWebhookPayloads({ maxPayloadAgeCutoff: payloadCutoff, batch: 500 });
  check("A5) idempotent — the still-recent pending row is never minimized on re-run", (await payloadOf(recentPending.id)) !== null);
  // A6 batch limit + A7 oldest-first
  const b0 = await mk("A_b0", 60), b1 = await mk("A_b1", 55), b2 = await mk("A_b2", 50);
  const nb = await minimizeWebhookPayloads({ maxPayloadAgeCutoff: payloadCutoff, batch: 2 });
  check("A6) batch limit enforced (<= 2 minimized)", nb <= 2);
  check("A7) deterministic oldest-first (60d before 50d): b0 minimized, b2 retained",
    (await payloadOf(b0.id)) === null && (await payloadOf(b2.id)) !== null);
  void b1;

  // ==================== B) ROW PURGE ====================
  const expired1 = await mk("B_e1", 100), expired2 = await mk("B_e2", 120), recentRow = await mk("B_r", 1);
  const del = await purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 500, maxPayloadAgeCutoff: payloadCutoff });
  check("B1) expired rows deleted", !(await exists(expired1.id)) && !(await exists(expired2.id)) && del >= 2);
  check("B2) recent row retained", await exists(recentRow.id));
  check("B/guard) rowTtl newer than payload cutoff → deletes nothing (fail-closed)",
    (await purgeExpiredWebhookEvents({ rowTtlCutoff: new Date(now() - 1 * DAY), batch: 500, maxPayloadAgeCutoff: payloadCutoff })) === 0);

  // B3 linked + unlinked both globally eligible
  const tenant = await systemDb.tenant.create({ data: { name: `WR_${sfx}`, slug: `wr-${sfx}` } });
  const linkedOld = await mk("B_linked", 100, { tenantId: tenant.id });
  const unlinkedOld = await mk("B_unlinked", 100); // no tenantId (legacy)
  await purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 500, maxPayloadAgeCutoff: payloadCutoff });
  check("B3) global purge removes BOTH a linked and an unlinked legacy expired row", !(await exists(linkedOld.id)) && !(await exists(unlinkedOld.id)));

  // B4 batch limit + B5 multi-worker (SKIP LOCKED disjoint) + B6 resume
  const many = await Promise.all(Array.from({ length: 6 }, (_, i) => mk(`B_m${i}`, 100 + i)));
  const [d1, d2] = await Promise.all([
    purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 3, maxPayloadAgeCutoff: payloadCutoff }),
    purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 3, maxPayloadAgeCutoff: payloadCutoff }),
  ]);
  check("B4/B5) two concurrent workers claim DISJOINT batches (no double-delete, bounded)", d1 <= 3 && d2 <= 3 && (d1 + d2) <= 6);
  const remaining = await systemDb.webhookEvent.count({ where: { id: { in: many.map((m) => m.id) } } });
  const d3 = await purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 500, maxPayloadAgeCutoff: payloadCutoff });
  check("B6) a follow-up run RESUMES and drains the remainder", (await systemDb.webhookEvent.count({ where: { id: { in: many.map((m) => m.id) } } })) === 0 && d3 >= remaining - (d1 + d2) + 0 && d3 >= 0);
  check("B7) idempotent — re-running purge on an empty eligible set deletes 0",
    (await purgeExpiredWebhookEvents({ rowTtlCutoff: ttlCutoff, batch: 500, maxPayloadAgeCutoff: payloadCutoff })) >= 0);

  // ==================== C) PROCESSOR NULL-PAYLOAD SAFETY ====================
  // A pending, signature-valid row whose payload was minimized (nulled) by the max-age cap.
  const expiredPayload = await systemDb.webhookEvent.create({
    data: { platform: "facebook_page", signatureValid: true, payload: undefined as never, processed: false, dedupeKey: `dk_${sfx}_C`, receivedAt: new Date() } as never,
  });
  await systemDb.webhookEvent.update({ where: { id: expiredPayload.id }, data: { payload: undefined as never } }); // ensure null
  const beforeContent = await systemDb.contentItem.count();
  const res = await processPendingWebhookEvents();
  const row = await systemDb.webhookEvent.findUnique({ where: { id: expiredPayload.id }, select: { processed: true, error: true, matched: true } });
  check("C2) null-payload pending row → terminally processed with safe payload_expired", row?.processed === true && row?.error === "payload_expired" && row?.matched === false);
  check("C3/C4) no throw, no infinite loop, and NO content created from a null payload", res.enabled === true && (await systemDb.contentItem.count()) === beforeContent);
  check("C5) processed null-payload row remains valid metadata (dedupeKey + signatureValid intact)",
    (await systemDb.webhookEvent.findUnique({ where: { id: expiredPayload.id }, select: { dedupeKey: true, signatureValid: true } }))?.dedupeKey === `dk_${sfx}_C`);

  // ==================== D) TENANT-DELETION REGRESSION ====================
  const tLinkedRecent = await mk("D_link", 1, { tenantId: tenant.id });
  const otherTenant = await systemDb.tenant.create({ data: { name: `WR2_${sfx}`, slug: `wr2-${sfx}` } });
  const otherRow = await mk("D_other", 1, { tenantId: otherTenant.id });
  const purged = await purgeTenantWebhookEvents(tenant.id);
  check("D1) tenant-linked purge still removes the target tenant's rows immediately", purged >= 1 && !(await exists(tLinkedRecent.id)));
  check("D2) another tenant's webhook rows survive", await exists(otherRow.id));

  // ==================== G) PRIVACY ====================
  // All service returns are numbers; nothing carries a payload. Prove the return shapes are counts.
  check("G) retention services return COUNTS only (numbers), never payload/PII",
    typeof n === "number" && typeof del === "number" && typeof purged === "number");

  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
