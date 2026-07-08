/**
 * Reconnect regression check.
 *
 * Guards the bug where a Meta reconnect (confirmMetaSelection) failed to
 * overwrite `scopes` / `grantedPermissions` on the EXISTING ConnectedAccount, so
 * an account stayed on `pages_show_list` even though the new OAuth flow also
 * granted `pages_read_engagement`.
 *
 * It checks the shared field builder (used by both create + update branches) and
 * exercises the real upsert against the DB:
 *   1. old account has only pages_show_list
 *   2. reconnect brings pages_read_engagement
 *   3. after update the account has ALL new permissions + tokens
 *   4. no duplicate account is created
 *
 * Run: DATABASE_URL=… tsx packages/db/scripts/reconnect-regression.ts
 */
import { prisma, Platform, metaConnectedAccountFields } from "../src/index";

let failures = 0;
function assert(ok: boolean, label: string) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

async function main() {
  console.log("Reconnect regression check\n");

  // 1) The shared builder always writes scopes/grantedPermissions/tokens.
  const fields = metaConnectedAccountFields({
    externalName: "Page",
    pageId: "P1",
    igBusinessId: null,
    scopes: ["public_profile", "email", "pages_show_list", "pages_read_engagement"],
    grantedPermissions: ["public_profile", "email", "pages_show_list", "pages_read_engagement"],
    encryptedToken: "aesgcm:v1:x",
    tokenType: "bearer",
    tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
  });
  assert(Array.isArray(fields.scopes) && fields.scopes.includes("pages_read_engagement"), "builder writes scopes");
  assert(Array.isArray(fields.grantedPermissions) && fields.grantedPermissions.includes("pages_read_engagement"), "builder writes grantedPermissions");
  assert(Boolean(fields.accessToken) && Boolean(fields.longLivedToken), "builder writes both token fields");
  assert(fields.tokenType === "bearer" && fields.tokenExpiresAt != null, "builder writes tokenType + expiry");
  assert(fields.health === "healthy" && fields.nextRetryAt === null && fields.syncAttempts === 0, "builder resets health/backoff");

  // Live DB exercise on a throwaway tenant/brand.
  const tenant = await prisma.tenant.create({ data: { name: "[regress] tenant", slug: `regress-${Date.now()}`, plan: "dev" } });
  const brand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "[regress] brand", defaultLocale: "en", timezone: "UTC" } });
  const externalId = "PAGE_REGRESS_1";

  try {
    // Old account: only pages_show_list.
    await prisma.connectedAccount.create({
      data: {
        tenantId: tenant.id,
        brandId: brand.id,
        platform: Platform.facebook_page,
        externalId,
        externalName: "Old Page",
        pageId: externalId,
        scopes: ["public_profile", "pages_show_list"],
        grantedPermissions: ["public_profile", "pages_show_list"],
        accessToken: "aesgcm:v1:OLD",
        longLivedToken: "aesgcm:v1:OLD",
        mode: "read_only",
        status: "active",
      },
    });

    const before = await prisma.connectedAccount.findFirst({ where: { brandId: brand.id, platform: Platform.facebook_page, externalId }, select: { scopes: true } });
    assert(!before?.scopes.includes("pages_read_engagement"), "old account lacks pages_read_engagement");

    // Reconnect: same key, new scopes/token via the shared builder.
    const reconnectFields = metaConnectedAccountFields({
      externalName: "New Page",
      pageId: externalId,
      igBusinessId: null,
      scopes: ["public_profile", "email", "pages_show_list", "pages_read_engagement"],
      grantedPermissions: ["public_profile", "email", "pages_show_list", "pages_read_engagement"],
      encryptedToken: "aesgcm:v1:NEW",
      tokenType: "bearer",
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    });
    await prisma.connectedAccount.upsert({
      where: { brandId_platform_externalId: { brandId: brand.id, platform: Platform.facebook_page, externalId } },
      create: { tenantId: tenant.id, brandId: brand.id, platform: Platform.facebook_page, externalId, ...reconnectFields },
      update: reconnectFields,
    });

    const after = await prisma.connectedAccount.findMany({ where: { brandId: brand.id, platform: Platform.facebook_page, externalId } });
    assert(after.length === 1, "no duplicate account created");
    const acct = after[0]!;
    assert(acct.scopes.includes("pages_read_engagement"), "reconnect overwrote scopes with pages_read_engagement");
    assert(acct.grantedPermissions.includes("pages_read_engagement"), "reconnect overwrote grantedPermissions");
    assert(acct.accessToken === "aesgcm:v1:NEW" && acct.longLivedToken === "aesgcm:v1:NEW", "reconnect overwrote tokens");
    assert(acct.health === "healthy" && acct.nextRetryAt === null, "reconnect reset health/backoff");
    assert(acct.mode === "read_only", "mode stayed read_only");
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }); // cascades to brand + account
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
