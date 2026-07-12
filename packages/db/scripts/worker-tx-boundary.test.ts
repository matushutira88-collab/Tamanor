/**
 * V1.37.3B — worker TRANSACTION BOUNDARY proof. Runs the REAL runReadOnlySync with
 * a test-only phase hook (dependency injection, no sensitive data) and asserts the
 * read → fetch → write ordering: the tenant READ transaction ends BEFORE the provider
 * call starts, and the tenant WRITE transaction starts only AFTER the provider call
 * ends. This proves no provider HTTP runs inside an open tenant DB transaction.
 *
 * Run: pnpm worker-tx-boundary:test
 */
import { systemDb } from "@guardora/db";
import { runReadOnlySync } from "../../sync/src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "TX", slug: `tx-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "TXB" } });
  // Placeholder (mock) account → mock fetch, no real network, but the same phase
  // structure (read tx → fetch → write tx) as a live sync.
  const acc = await systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", externalId: `TX_${sfx}`, pageId: `TX_${sfx}`, health: "healthy" },
  });

  try {
    const phases: string[] = [];
    const outcome = await runReadOnlySync({ accountId: acc.id, tenantId: t.id }, "manual", {
      onPhase: (p) => phases.push(p),
    });

    check("sync completed (mock)", outcome.ok === true && outcome.fetched > 0);

    const readEnd = phases.indexOf("tenant-read-end");
    const provStart = phases.indexOf("provider-call-start");
    const provEnd = phases.indexOf("provider-call-end");
    const writeStart = phases.indexOf("tenant-write-start");
    const writeEnd = phases.indexOf("tenant-write-end");

    check("all phases emitted", [readEnd, provStart, provEnd, writeStart, writeEnd].every((i) => i >= 0), phases.join(" → "));
    check("S) tenant-read ENDS before provider-call STARTS", readEnd >= 0 && provStart > readEnd);
    check("S) provider-call ENDS before tenant-write STARTS", provEnd >= 0 && writeStart > provEnd);
    check("S) exact order: read → provider → write", provStart > readEnd && provEnd > provStart && writeStart > provEnd && writeEnd > writeStart, phases.join(" → "));

    // The write actually persisted under the tenant context (RLS).
    const runs = await systemDb.syncRun.count({ where: { connectedAccountId: acc.id, status: "completed" } });
    check("write phase persisted a completed SyncRun", runs >= 1);
  } finally {
    await systemDb.auditLog.deleteMany({ where: { tenantId: t.id } });
    await systemDb.actionQueueItem.deleteMany({ where: { brandId: br.id } });
    await systemDb.autoProtectDecision.deleteMany({ where: { brandId: br.id } });
    await systemDb.providerCall.deleteMany({ where: { brandId: br.id } });
    await systemDb.reputationItem.deleteMany({ where: { brandId: br.id } });
    await systemDb.contentItem.deleteMany({ where: { brandId: br.id } });
    await systemDb.syncRun.deleteMany({ where: { brandId: br.id } });
    await systemDb.connectedAccount.deleteMany({ where: { brandId: br.id } });
    await systemDb.brand.deleteMany({ where: { id: br.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — worker transaction boundary (V1.37.3B)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
