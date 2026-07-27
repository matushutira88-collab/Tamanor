/**
 * PRODUCTION-safe platform-owner bootstrap. Assigns the CONFIGURED email as PLATFORM_OWNER via the existing
 * audited, idempotent {@link bootstrapPlatformOwnerFromEnv} — it NEVER creates a user and NEVER adds an
 * email-based authorization path (the email is used ONLY for this one-time/idempotent role assignment;
 * ongoing authorization stays entirely on User.platformRole).
 *
 * Invoked ONLY by the manual, `production`-environment-gated `platform-owner-bootstrap` GitHub Actions
 * workflow — never a public HTTP endpoint, never at app startup. Fail-closed at every step and prints ONLY a
 * bounded, non-sensitive confirmation (the DATABASE_URL is NEVER printed; only a non-reversible host
 * fingerprint is echoed).
 *
 * Env (never printed): DATABASE_URL, TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL, BOOTSTRAP_ENVIRONMENT,
 * BOOTSTRAP_CONFIRMATION, PRODUCTION_DATABASE_HOST_FINGERPRINT (optional).
 */
import { assertProductionTarget } from "./family-activation";
import { bootstrapPlatformOwnerFromEnv, systemDb, PlatformRole } from "../src/index";

const CONFIRM = "BOOTSTRAP_PLATFORM_OWNER";

async function main() {
  const env = process.env;

  // 1. Explicit confirmation + production-target guard (fail-closed; never prints the URL).
  if (env.BOOTSTRAP_CONFIRMATION !== CONFIRM) {
    console.error(`✗ Refusing: confirmation must exactly equal "${CONFIRM}".`);
    process.exit(1);
  }
  const target = assertProductionTarget({ url: env.DATABASE_URL, environment: env.BOOTSTRAP_ENVIRONMENT, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  if (!target.ok) {
    console.error("✗ Refusing (target not confirmed production):\n" + target.errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  const email = (env.TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
  if (!email) { console.error("✗ TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL is required."); process.exit(1); }
  console.log(`Target host fingerprint: ${target.fingerprint ?? "n/a"} (URL never printed).`);

  // 2. Schema-readiness pre-check — the platform-admin migration must be applied first, otherwise the
  //    deployed code (which reads platformAccessRevokedAt) is broken and bootstrap cannot succeed. Clear,
  //    actionable diagnostic instead of a raw column error.
  try {
    const rows = await systemDb.$queryRawUnsafe<Array<{ has_audit: boolean; has_col: boolean }>>(
      `SELECT to_regclass('public.platform_admin_audit_events') IS NOT NULL AS has_audit,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'platformAccessRevokedAt') AS has_col`,
    );
    if (rows[0]?.has_audit !== true || rows[0]?.has_col !== true) {
      console.error("✗ Production schema is NOT migrated for platform admin (missing platform_admin_audit_events / users.platformAccessRevokedAt).");
      console.error("  Apply migration 20260824090000_platform_admin_privacy_analytics via the production-database-migrate workflow FIRST, then re-run this.");
      await systemDb.$disconnect();
      process.exit(2);
    }
  } catch (e) {
    console.error(`✗ Could not verify production schema (${(e as Error).name}).`);
    await systemDb.$disconnect();
    process.exit(1);
  }

  // 3. Idempotent, audited bootstrap (reuses the existing function; requires an EXISTING user; never creates one).
  const res = await bootstrapPlatformOwnerFromEnv();
  if (!res.ok) {
    console.error(`✗ Bootstrap not applied: ${res.reason} (no user created; ongoing authorization stays on platformRole).`);
    await systemDb.$disconnect();
    process.exit(1);
  }

  // 4. Verify the final production state (bounded, non-sensitive — no password hash / session / PII beyond the email).
  const owner = await systemDb.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, platformRole: true, platformAccessRevokedAt: true } });
  const activeOwners = await systemDb.user.count({ where: { platformRole: PlatformRole.owner, platformAccessRevokedAt: null } });
  const audit = await systemDb.platformAdminAuditEvent.findFirst({ where: { action: "bootstrap.owner_assigned", targetUserId: owner?.id ?? "__none__" }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
  const ok = owner?.platformRole === PlatformRole.owner && owner?.platformAccessRevokedAt === null && activeOwners >= 1;
  console.log(JSON.stringify({
    ok, changed: res.changed, email,
    platformRole: owner?.platformRole ?? null,
    platformAccessRevokedAt: owner?.platformAccessRevokedAt ?? null,
    activeOwners, auditWritten: !!audit,
  }));
  await systemDb.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("bootstrap failed:", (e as Error)?.name ?? "unknown");
  await systemDb.$disconnect();
  process.exit(1);
});
