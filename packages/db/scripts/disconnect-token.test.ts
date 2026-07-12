/**
 * V1.37.4 — disconnect lifecycle, provider revoke & token-decrypt correctness.
 * Real Postgres + appDb via the REAL `disconnectAccount` service and revoke adapter.
 * Proves: local credentials are always removed; provider revoke is best-effort and
 * truthful; the provider transport ONLY ever receives a PLAINTEXT token (never an
 * encrypted envelope); an invalid ciphertext fails before any HTTP.
 *
 * Run: pnpm disconnect-token:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { systemDb, withTenant, encryptToken } from "@guardora/db";
import { disconnectAccount, revokeProviderCredentials } from "../../sync/src/index";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const ENVELOPE = /^(plain:|aesgcm:|kms:)/;

async function run() {
  const sfx = Date.now().toString(36);
  const t = await systemDb.tenant.create({ data: { name: "Dc", slug: `dc-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: "DcB" } });
  const RAW = "RAW_PAGE_TOKEN_12345";
  const mkFb = (tag: string) => systemDb.connectedAccount.create({
    data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `DC_${tag}_${sfx}`, pageId: `DC_${tag}_${sfx}`, longLivedToken: encryptToken(RAW), grantedPermissions: ["pages_manage_engagement"] },
  });

  try {
    // ===== 22/27/28) Revoke SUCCESS: transport receives PLAINTEXT (never an envelope). =====
    const a1 = await mkFb("ok");
    let captured: string | null = null;
    const r1 = await disconnectAccount(t.id, a1.id, {
      transport: { revokeMeta: async ({ accessToken }) => { captured = accessToken; return { ok: true }; } },
    });
    check("22) provider revoke success → revoked_provider", r1.revoke === "revoked" && r1.status === "revoked_provider");
    check("27) transport receives the PLAINTEXT token", captured === RAW);
    check("28) encrypted envelope is NEVER sent to the provider", captured != null && !ENVELOPE.test(captured!));
    const a1row = await withTenant(t.id, (db) => db.connectedAccount.findFirst({ where: { id: a1.id }, select: { accessToken: true, longLivedToken: true, refreshToken: true, status: true } }));
    check("21) local tokens nulled + status disconnected", a1row?.accessToken === null && a1row?.longLivedToken === null && a1row?.refreshToken === null && a1row?.status === "disconnected");

    // ===== 23) Revoke FAILURE: local disconnect still happens, truthful revoke_failed. =====
    const a2 = await mkFb("fail");
    const r2 = await disconnectAccount(t.id, a2.id, { transport: { revokeMeta: async () => { throw new Error("provider 500"); } } });
    const a2row = await withTenant(t.id, (db) => db.connectedAccount.findFirst({ where: { id: a2.id }, select: { longLivedToken: true, status: true } }));
    check("23) revoke failure → revoke_failed BUT local credentials removed", r2.revoke === "failed" && r2.status === "revoke_failed" && a2row?.longLivedToken === null && a2row?.status === "disconnected");

    // ===== 24) Reconnect requires new credentials (the stored token is gone). =====
    const a2after = await withTenant(t.id, (db) => db.connectedAccount.findFirst({ where: { id: a2.id }, select: { longLivedToken: true, accessToken: true, connectionStatus: true } }));
    check("24) reconnect required — no reusable token remains", a2after?.longLivedToken === null && a2after?.accessToken === null && a2after?.connectionStatus === "disconnected");

    // ===== 25) The disconnect RESULT carries no token material. =====
    check("25) disconnect result exposes no token field", JSON.stringify(r1).indexOf(RAW) === -1 && !("accessToken" in r1) && !("token" in r1));

    // ===== 26) No transport wired → truthful `unsupported` (never a fake revoke). =====
    const a3 = await mkFb("nowire");
    const r3 = await disconnectAccount(t.id, a3.id); // no transport
    check("26) no revoke transport → revoke_unsupported (truthful), local removal done", r3.revoke === "unsupported" && r3.status === "revoke_unsupported");

    // GBP disconnect is truthfully unsupported too.
    const gbp = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "google_business", status: "active", mode: "read_only", externalId: `DC_GBP_${sfx}`, longLivedToken: encryptToken(RAW) } });
    const rg = await disconnectAccount(t.id, gbp.id);
    check("26b) GBP read-only → revoke unsupported, local creds removed", rg.revoke === "unsupported" && (await withTenant(t.id, (db) => db.connectedAccount.findFirst({ where: { id: gbp.id }, select: { longLivedToken: true } })))?.longLivedToken === null);

    // ===== 29) Invalid ciphertext must fail BEFORE any HTTP (transport never called). =====
    const a4 = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `DC_BAD_${sfx}`, longLivedToken: "aesgcm:v1:not:valid:ciphertext" } });
    let called = false;
    const r4 = await disconnectAccount(t.id, a4.id, { transport: { revokeMeta: async () => { called = true; return { ok: true }; } } });
    check("29) invalid ciphertext → no HTTP, safe local removal", called === false && r4.revoke === "already_invalid"
      && (await withTenant(t.id, (db) => db.connectedAccount.findFirst({ where: { id: a4.id }, select: { longLivedToken: true, status: true } })))?.status === "disconnected");

    // ===== Revoke adapter unit truths =====
    check("M) revoke adapter: null token → already_invalid; unknown provider → unsupported",
      (await revokeProviderCredentials({ platform: "facebook_page", accessToken: null, externalAccountId: "x" })) === "already_invalid"
      && (await revokeProviderCredentials({ platform: "tiktok", accessToken: "t", externalAccountId: "x" })) === "unsupported");

    // ===== 30) rollbackExecution decrypts before the provider call (bug fix, source). =====
    const rollbackSrc = readSrc("apps/web/src/app/dashboard/safety-actions.ts");
    check("30) rollbackExecution decrypts token before rollbackHide (no raw envelope)",
      rollbackSrc.includes("decryptToken(acct?.longLivedToken ?? acct?.accessToken)")
      && rollbackSrc.includes("accessToken: pageToken")
      && !rollbackSrc.includes("accessToken: acct?.accessToken ?? null"));
  } finally {
    await systemDb.connectedAccount.deleteMany({ where: { tenantId: t.id } });
    await systemDb.brand.deleteMany({ where: { tenantId: t.id } });
    await systemDb.tenant.deleteMany({ where: { id: t.id } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — disconnect, revoke & token decrypt (V1.37.4)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
