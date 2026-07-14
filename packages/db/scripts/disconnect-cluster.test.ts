/**
 * V1.45B — TRUTHFUL DISCONNECT & LOCAL TOKEN-CLUSTER INVALIDATION (real Postgres).
 *
 * Exercises the REAL `disconnectAccount` service, `runReadOnlySync` pipeline, sync lease,
 * and the production system-discovery queries on a real DB (RLS runtime). Proves:
 *  - disconnecting either member of a Page/Instagram token-sharing cluster clears the WHOLE
 *    local cluster (tokens nulled, status disconnected) — resolved from `parentAccountId`,
 *    never from token comparison;
 *  - unrelated clusters + other tenants are untouched; broken parent links stay bounded;
 *  - the operation is atomic + idempotent and invalidates in-flight leases;
 *  - a stale in-flight sync completing AFTER disconnect writes zero account rows (never
 *    restores healthy/connected state, never resurrects a token, never schedules retry);
 *  - a reconnect mints a new lease so the old sync's terminal write stays a no-op;
 *  - worker discovery + webhook lookup exclude every disconnected cluster row;
 *  - provider revocation is truthfully `unsupported` for Meta (never a fake `revoked`);
 *  - no token appears in the result; the disconnect action enforces tenant authorization and
 *    the UI copy never claims a provider-side revocation occurred.
 *
 * Run: pnpm disconnect-cluster:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  systemDb, withTenant, encryptToken, acquireSyncLease,
  findMetaSyncCandidates, findActiveMetaAccounts, findMetaAccountsByExternalIds,
} from "../src/index";
import { disconnectAccount, runReadOnlySync, processPendingWebhookEvents } from "../../sync/src/index";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const RAW = "RAW_PAGE_TOKEN_CLUSTER";
const tokenFields = { accessToken: true, longLivedToken: true, refreshToken: true, tokenExpiresAt: true, status: true, connectionStatus: true, tokenHealth: true, health: true } as const;
type AcctRow = { accessToken: string | null; longLivedToken: string | null; refreshToken: string | null; status: string; connectionStatus: string; tokenHealth: string; health: string; lastSuccessfulSyncAt?: Date | null } | null;
const row = (tId: string, id: string, extra: Record<string, boolean> = {}) =>
  withTenant(tId, (db) => db.connectedAccount.findFirst({ where: { id }, select: { ...tokenFields, ...extra } })) as Promise<AcctRow>;
const clear = (r: AcctRow) => !!r && r.accessToken === null && r.longLivedToken === null && r.refreshToken === null && r.status === "disconnected";

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "DcC", slug: `dcc-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "DcCB" } });
  const t2 = await systemDb.tenant.create({ data: { name: "DcC2", slug: `dcc2-${sfx}` } });
  const br2 = await systemDb.brand.create({ data: { tenantId: t2.id, name: "DcC2B" } });

  // Cluster builder: a Facebook Page + (optionally) a linked Instagram child sharing the token.
  const mkPage = (tenantId: string, brandId: string, tag: string) => systemDb.connectedAccount.create({
    data: { tenantId, brandId, platform: "facebook_page", status: "active", mode: "read_only", health: "healthy", externalId: `PG_${tag}_${sfx}`, pageId: `PG_${tag}_${sfx}`, longLivedToken: encryptToken(RAW), grantedPermissions: ["pages_manage_engagement"] },
  });
  const mkIg = (tenantId: string, brandId: string, tag: string, parentAccountId: string) => systemDb.connectedAccount.create({
    data: { tenantId, brandId, platform: "instagram_business", status: "active", mode: "read_only", health: "healthy", externalId: `IG_${tag}_${sfx}`, igBusinessId: `IG_${tag}_${sfx}`, parentAccountId, longLivedToken: encryptToken(RAW) },
  });

  try {
    // =================== A) CLUSTER RESOLUTION & INVALIDATION ===================
    // A1 — Disconnect the Facebook Page → Page + linked IG child both cleared.
    const pageA = await mkPage(t.id, br.id, "A");
    const igA = await mkIg(t.id, br.id, "A", pageA.id);
    const r1 = await disconnectAccount(t.id, pageA.id);
    const pageAr = await row(t.id, pageA.id);
    const igAr = await row(t.id, igA.id);
    check("A1a) disconnect Page clears the Page row (tokens null, status disconnected)", clear(pageAr));
    check("A1b) disconnect Page ALSO clears the linked Instagram sibling (no shared token left)", clear(igAr) && igAr!.longLivedToken === null);
    check("A1c) result reports the 2-row cluster", r1.cluster.count === 2 && r1.cluster.accountIds.includes(pageA.id) && r1.cluster.accountIds.includes(igA.id));
    check("A1d) health is coherent — never disconnected+healthy", pageAr!.health !== "healthy" && igAr!.health !== "healthy");

    // A2 — Disconnect the Instagram CHILD → whole cluster (parent Page + sibling) disconnected.
    const pageB = await mkPage(t.id, br.id, "B");
    const igB1 = await mkIg(t.id, br.id, "B1", pageB.id);
    const igB2 = await mkIg(t.id, br.id, "B2", pageB.id); // a second IG child of the same page
    const r2 = await disconnectAccount(t.id, igB1.id);
    const [pgBr, ig1r, ig2r] = await Promise.all([row(t.id, pageB.id), row(t.id, igB1.id), row(t.id, igB2.id)]);
    check("A2a) disconnecting an IG child disconnects its parent Page (no parent retains the token)", clear(pgBr));
    check("A2b) disconnecting an IG child disconnects ALL sibling IG children", clear(ig1r) && clear(ig2r));
    check("A2c) result cluster covers page + both IG children", r2.cluster.count === 3);

    // A3 — Unrelated cluster in the SAME tenant is untouched.
    const pageC = await mkPage(t.id, br.id, "C");
    const igC = await mkIg(t.id, br.id, "C", pageC.id);
    await disconnectAccount(t.id, pageA.id); // (re-disconnect A; must not touch C)
    const [pgCr, igCr] = await Promise.all([row(t.id, pageC.id), row(t.id, igC.id)]);
    check("A3) an unrelated Page/IG cluster stays fully connected", pgCr!.status === "active" && igCr!.status === "active" && pgCr!.longLivedToken !== null);

    // A4 — Cross-tenant isolation: a Page in ANOTHER tenant with the same shape is untouched.
    const pageX = await mkPage(t2.id, br2.id, "X");
    const igX = await mkIg(t2.id, br2.id, "X", pageX.id);
    await disconnectAccount(t.id, pageC.id); // disconnect C in tenant t
    const [pgXr, igXr] = await Promise.all([row(t2.id, pageX.id), row(t2.id, igX.id)]);
    check("A4a) another tenant's cluster is never disconnected", pgXr!.status === "active" && igXr!.status === "active");
    // A foreign account id → not_found (never enumerated / cross-tenant reachable).
    const rForeign = await disconnectAccount(t.id, pageX.id);
    check("A4b) disconnecting a FOREIGN-tenant account id → not_found (no cross-tenant effect)", rForeign.account === null && (await row(t2.id, pageX.id))!.status === "active");

    // A5 — Broken relationships: IG child with a MISSING parent link → bounded to the child only.
    const orphanIg = await systemDb.connectedAccount.create({
      data: { tenantId: t.id, brandId: br.id, platform: "instagram_business", status: "active", mode: "read_only", health: "healthy", externalId: `IG_ORPH_${sfx}`, igBusinessId: `IG_ORPH_${sfx}`, parentAccountId: null, longLivedToken: encryptToken(RAW) },
    });
    const rOrphan = await disconnectAccount(t.id, orphanIg.id);
    check("A5) broken/missing parent → cluster bounded to the requested child (no cross-account expansion)", rOrphan.cluster.count === 1 && clear(await row(t.id, orphanIg.id)));

    // A6 — Idempotency: two concurrent disconnects converge; a re-disconnect is a no-op transition.
    const pageD = await mkPage(t.id, br.id, "D");
    const igD = await mkIg(t.id, br.id, "D", pageD.id);
    const [rd1, rd2] = await Promise.all([disconnectAccount(t.id, pageD.id), disconnectAccount(t.id, igD.id)]);
    check("A6) concurrent disconnects are idempotent (both succeed, cluster fully cleared)", rd1.localCredentialsRemoved && rd2.localCredentialsRemoved && clear(await row(t.id, pageD.id)) && clear(await row(t.id, igD.id)));

    // =================== C) PROVIDER SEMANTICS ===================
    check("C1) Meta per-account revoke is truthfully `unsupported` (never a fake `revoked`)", r1.revoke === "unsupported" && r1.providerRevocation === "unsupported" && r1.status === "revoke_unsupported");
    check("C2) manual provider cleanup is recommended for a Meta local-only disconnect", r1.manualCleanupRecommended === true);
    // A failed/unsupported provider result NEVER blocks local cluster credential removal.
    const pageF = await mkPage(t.id, br.id, "F");
    const igF = await mkIg(t.id, br.id, "F", pageF.id);
    const rf = await disconnectAccount(t.id, pageF.id, { transport: { revokeMeta: async () => { throw new Error("provider 500"); } } });
    check("C3) provider revoke FAILURE still removes the whole local cluster", rf.revoke === "failed" && clear(await row(t.id, pageF.id)) && clear(await row(t.id, igF.id)));
    check("C4) the disconnect result carries NO token material", JSON.stringify(r1).indexOf(RAW) === -1 && !("accessToken" in r1) && !("token" in r1) && !("longLivedToken" in r1));

    // =================== E) WORKER DISCOVERY + F) WEBHOOK EXCLUSION ===================
    const [metaCandidates, activeMeta] = await Promise.all([findMetaSyncCandidates(["active"]), findActiveMetaAccounts()]);
    const candidateIds = new Set(metaCandidates.map((a) => a.id));
    const activeIds = new Set(activeMeta.map((a) => a.id));
    const disconnectedIds = [pageA.id, igA.id, pageB.id, igB1.id, igB2.id, pageD.id, igD.id, pageF.id, igF.id];
    check("E1) worker sync discovery excludes EVERY disconnected cluster row", disconnectedIds.every((id) => !candidateIds.has(id)));
    check("E2) connector-health discovery excludes every disconnected cluster row", disconnectedIds.every((id) => !activeIds.has(id)));
    check("E3) a still-connected account remains discoverable (cross-tenant system discovery)", candidateIds.has(pageX.id) && activeIds.has(pageX.id));
    // Webhook lookup by the Page's external id → excluded once disconnected (no re-ingest / reactivation).
    const whBefore = await findMetaAccountsByExternalIds([`PG_C_${sfx}`]); // C was disconnected in A4
    check("F1) webhook account lookup excludes a disconnected Page (no ingest, cannot reactivate)", !whBefore.some((a) => a.id === pageC.id));
    const whActive = await findMetaAccountsByExternalIds([`PG_X_${sfx}`]);
    check("F2) webhook lookup STILL resolves a connected Page in another tenant", whActive.some((a) => a.id === pageX.id));

    // F3/F4 — DIRECT webhook INGEST path (not just the lookup helper): enable META_WEBHOOK_SYNC,
    // enqueue signature-valid events targeting the disconnected Page AND its disconnected IG, run
    // the REAL processPendingWebhookEvents, and prove nothing ingests and the account is not
    // reactivated. (pageA + igA were disconnected in section A.)
    process.env.META_WEBHOOK_SYNC = "true";
    const evPage = await systemDb.webhookEvent.create({ data: { platform: "facebook_page", signatureValid: true, processed: false, dedupeKey: `wh-pg-${sfx}`, payload: { entry: [{ id: `PG_A_${sfx}` }] } } });
    const evIg = await systemDb.webhookEvent.create({ data: { platform: "instagram_business", signatureValid: true, processed: false, dedupeKey: `wh-ig-${sfx}`, payload: { entry: [{ id: `IG_A_${sfx}` }] } } });
    const contentBefore = await systemDb.contentItem.count({ where: { connectedAccountId: { in: [pageA.id, igA.id] } } });
    await processPendingWebhookEvents();
    const [evPageAfter, evIgAfter, contentAfter, pageAAfter, igAAfter] = await Promise.all([
      systemDb.webhookEvent.findUnique({ where: { id: evPage.id }, select: { processed: true, matched: true } }),
      systemDb.webhookEvent.findUnique({ where: { id: evIg.id }, select: { processed: true, matched: true } }),
      systemDb.contentItem.count({ where: { connectedAccountId: { in: [pageA.id, igA.id] } } }),
      row(t.id, pageA.id), row(t.id, igA.id),
    ]);
    check("F3) webhook for a disconnected Page/IG is IGNORED, ingests nothing, cannot reactivate", evPageAfter?.processed === true && evPageAfter?.matched === false && evIgAfter?.matched === false && contentAfter === contentBefore && pageAAfter!.status === "disconnected" && igAAfter!.status === "disconnected");
    // F4 — even a DIRECT sync call on a disconnected account early-returns and ingests nothing.
    const directWh = await runReadOnlySync({ accountId: pageA.id, tenantId: t.id }, "automatic");
    check("F4) a direct sync on a disconnected account early-returns without ingest", directWh.ok === false && /disconnected/i.test(directWh.message) && (await systemDb.contentItem.count({ where: { connectedAccountId: pageA.id } })) === contentBefore);
    delete process.env.META_WEBHOOK_SYNC;

    // =================== D) SYNC-RACE HARDENING ===================
    // D-lease) disconnectAccount atomically invalidates an in-flight lease.
    const pageL = await mkPage(t.id, br.id, "L");
    const lease = await acquireSyncLease(t.id, pageL.id, "stale-holder");
    check("D0) a sync lease can be acquired for a connected account", lease != null);
    await disconnectAccount(t.id, pageL.id);
    const leaseGone = await withTenant(t.id, (db) => db.syncLease.findFirst({ where: { connectedAccountId: pageL.id } }));
    check("D1) disconnect deletes the in-flight sync lease (a stale finalize can't match it)", leaseGone === null);

    // D-race) A REAL runReadOnlySync whose lease is invalidated mid-run (as a disconnect does):
    // the lease-gated terminal write is a zero-row no-op — health is NOT restored to healthy
    // and no success marker is written. The account starts at health "unknown" so a restored
    // "healthy" would be observable if the guard failed. The hook only drops the LEASE (the
    // exact effect a disconnect has on it), avoiding any row-lock interaction with the sync tx.
    const pageR = await systemDb.connectedAccount.create({
      data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", health: "unknown", externalId: `PG_RACE_${sfx}`, pageId: `PG_RACE_${sfx}` },
    });
    let leaseDropped = false;
    const outcome = await runReadOnlySync({ accountId: pageR.id, tenantId: t.id }, "manual", {
      beforeReputationCreate: async () => {
        if (leaseDropped) return;
        leaseDropped = true;
        await systemDb.syncLease.deleteMany({ where: { connectedAccountId: pageR.id } });
      },
    });
    const raceRow = await row(t.id, pageR.id, { lastSuccessfulSyncAt: true });
    check("D2) the stale sync ran to completion (SyncRun recorded, lease released)", outcome.verdict === "success" || outcome.verdict === "partial_success");
    check("D3) a stale success does NOT restore healthy state (lease-gated write skipped)", raceRow!.health !== "healthy");
    check("D4) a stale success does NOT write a success marker", (raceRow!.lastSuccessfulSyncAt ?? null) === null);

    // D-positive) Control: a NORMAL sync (lease held throughout) DOES apply its terminal write —
    // proves the lease-gate is not over-blocking legitimate completions.
    const pageOk = await systemDb.connectedAccount.create({
      data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", health: "unknown", externalId: `PG_OK_${sfx}`, pageId: `PG_OK_${sfx}` },
    });
    await runReadOnlySync({ accountId: pageOk.id, tenantId: t.id }, "manual");
    const okRow = await row(t.id, pageOk.id, { lastSuccessfulSyncAt: true });
    check("D6) a normal sync (lease held) DOES write healthy + a success marker (gate not over-blocking)", okRow!.health === "healthy" && (okRow!.lastSuccessfulSyncAt ?? null) !== null);

    // D7) TOCTOU: force a full disconnect+reconnect (lease dropped AND status flipped back to
    // active) mid-sync, before the terminal write. Even though status is "active" again, the
    // FOR UPDATE lease lock finds no lease → the write is skipped, so a stale sync can NEVER
    // overwrite a reconnected lifecycle. Health "healthy" would be observable if the guard
    // relied on the status predicate alone.
    const pageT = await systemDb.connectedAccount.create({
      data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "mock_connected", mode: "placeholder", health: "unknown", externalId: `PG_TOCTOU_${sfx}`, pageId: `PG_TOCTOU_${sfx}` },
    });
    let toctouDone = false;
    await runReadOnlySync({ accountId: pageT.id, tenantId: t.id }, "manual", {
      beforeReputationCreate: async () => {
        if (toctouDone) return;
        toctouDone = true;
        await systemDb.syncLease.deleteMany({ where: { connectedAccountId: pageT.id } }); // disconnect drops the lease
        await systemDb.connectedAccount.update({ where: { id: pageT.id }, data: { status: "active" } }); // reconnect flips status back
      },
    });
    const toctouRow = await row(t.id, pageT.id, { lastSuccessfulSyncAt: true });
    check("D7) stale sync cannot overwrite a reconnected lifecycle (lease lock, not status alone)", toctouRow!.health !== "healthy" && (toctouRow!.lastSuccessfulSyncAt ?? null) === null);

    // ============ P5) DISCONNECT vs RECONNECT (deterministic, seam-forced) ============
    // The exact race: disconnect resolves the cluster/token → pauses → a reconnect writes NEW
    // credentials + active state → disconnect resumes. The per-row CAS on the resolved credential
    // must NOT clobber the reconnect (a reconnect writes fresh random-IV ciphertext).
    const pageP1 = await mkPage(t.id, br.id, "P1");
    const rP1 = await disconnectAccount(t.id, pageP1.id, {
      hooks: {
        beforeLocalClear: async () => {
          await systemDb.connectedAccount.update({
            where: { id: pageP1.id },
            data: { longLivedToken: encryptToken("RECONNECTED_NEW"), accessToken: encryptToken("RECONNECTED_NEW"), status: "active", connectionStatus: "connected", health: "healthy" },
          });
        },
      },
    });
    const p1Row = await row(t.id, pageP1.id);
    check("P5a) a reconnect that lands mid-disconnect is NOT clobbered (new creds survive, status active)", p1Row!.status === "active" && p1Row!.longLivedToken !== null && rP1.localCredentialsRemoved === false);

    // Precision control: a BENIGN concurrent sync write (health only, tokens untouched) must NOT
    // block the disconnect — the CAS keys on the credential, not on updatedAt/health.
    const pageP2 = await mkPage(t.id, br.id, "P2");
    const rP2 = await disconnectAccount(t.id, pageP2.id, {
      hooks: {
        beforeLocalClear: async () => {
          await systemDb.connectedAccount.update({ where: { id: pageP2.id }, data: { health: "healthy", lastSyncedAt: new Date() } }); // no token change
        },
      },
    });
    check("P5b) a benign concurrent sync write does NOT block a legitimate disconnect (CAS is credential-precise)", clear(await row(t.id, pageP2.id)) && rP2.localCredentialsRemoved === true);

    // D-reconnect) After disconnect+reconnect, the OLD sync's lease id no longer exists → its
    // guarded write stays a no-op, so it cannot overwrite the freshly reconnected lifecycle.
    const pageRC = await mkPage(t.id, br.id, "RC");
    const staleLease = await acquireSyncLease(t.id, pageRC.id, "old-holder");
    await disconnectAccount(t.id, pageRC.id);           // drops the stale lease
    await systemDb.connectedAccount.update({ where: { id: pageRC.id }, data: { status: "active", connectionStatus: "connected", health: "healthy", longLivedToken: encryptToken(RAW) } }); // reconnect
    const staleStillOwns = await withTenant(t.id, (db) => db.syncLease.findFirst({ where: { id: staleLease!.id, connectedAccountId: pageRC.id, holderId: "old-holder" } }));
    check("D5) after reconnect the OLD sync no longer owns a lease → its terminal write is a no-op", staleStillOwns === null && (await row(t.id, pageRC.id))!.status === "active" && (await row(t.id, pageRC.id))!.longLivedToken !== null);

    // =================== B) AUTHORIZATION + G) COPY TRUTHFULNESS (source-verified) ===================
    const actionsSrc = readSrc("apps/web/src/app/dashboard/accounts/actions.ts");
    check("B1) disconnect action requires an authenticated session + ConnectorManage", actionsSrc.includes("requireSession()") && /assertCan\(session\.role,\s*Permission\.ConnectorManage\)/.test(actionsSrc));
    check("B2) disconnect action takes only an accountId — the cluster/result are derived server-side (not client-supplied)", /export async function disconnect\(accountId: string\)/.test(actionsSrc) && !/cluster.*formData|formData.*cluster/i.test(actionsSrc));
    check("B3) disconnect authority is tenant-scoped — NOT the V1.45A platform role", !/platformRole|resolvePlatformRole|requirePlatformCapability/.test(actionsSrc));

    const pageSrc = readSrc("apps/web/src/app/dashboard/accounts/page.tsx");
    check("G1) UI links the OFFICIAL Facebook manual-removal page, opened safely (noopener)", pageSrc.includes("https://www.facebook.com/help/405094243235242") && pageSrc.includes('rel="noopener noreferrer"') && pageSrc.includes('target="_blank"') && !pageSrc.includes("facebook.com/help/405094243235242?access") );
    const enSrc = readSrc("apps/web/src/i18n/dictionaries/en.ts");
    const falseClaims = /Meta access revoked|provider token revoked|permissions removed|no longer has any authorization/i;
    check("G2) disconnect copy never claims a provider-side revocation occurred", !falseClaims.test(enSrc.slice(enSrc.indexOf("disconnectedTitle"), enSrc.indexOf("disconnectedTitle") + 800)));
    check("G3) copy truthfully states local removal + that Meta authorization may persist", /removed its stored credentials/i.test(enSrc) && /may stay active at Meta until it expires/i.test(enSrc));

    // =================== H) AUDIT / TOKEN SECRECY ===================
    const auditSrc = readSrc("apps/web/src/app/dashboard/accounts/actions.ts");
    check("H1) audit metadata records safe fields (cluster count, classification) and NO token", auditSrc.includes("clusterCount: cluster.count") && auditSrc.includes("providerRevoke: revoke") && auditSrc.includes("manualCleanupRecommended") && !/accessToken|longLivedToken|decryptToken/.test(auditSrc));
    const [fRow, igfRow] = await Promise.all([row(t.id, pageF.id), row(t.id, igF.id)]);
    check("H2) no disconnected cluster row retains any token envelope", fRow!.longLivedToken === null && fRow!.accessToken === null && igfRow!.longLivedToken === null && igfRow!.accessToken === null);
  } finally {
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: { in: [t.id, t2.id] } } });
    await systemDb.brand.deleteMany({ where: { tenantId: { in: [t.id, t2.id] } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [t.id, t2.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — disconnect token-cluster invalidation & sync-race (V1.45B)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
