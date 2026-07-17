/**
 * Align the Postgres `tamanor_app` runtime role with APP_DATABASE_URL.
 *
 * The RLS migration (v1_37_2_rls) creates `tamanor_app` with a hardcoded default
 * password, which almost never matches the (stronger) password embedded in
 * APP_DATABASE_URL that the app and the RLS test actually authenticate with.
 * That mismatch surfaces as: "Authentication failed ... credentials for
 * `tamanor_app` are not valid". This script fixes it, running as the OWNER
 * (DATABASE_URL), by setting the role's password to exactly the one in
 * APP_DATABASE_URL — and ensures the role's table privileges.
 *
 * Run:  pnpm db:set-app-password      (or: pnpm --filter @guardora/db set-app-role-password)
 * Then: pnpm rls-isolation:test
 *
 * Note: this handles AUTHENTICATION + privileges only. The RLS *policies* and
 * FORCE ROW LEVEL SECURITY come from migrations — run `pnpm db:migrate:deploy`
 * first if you have not applied them yet (the script warns if RLS is missing).
 */
import { systemDb } from "@guardora/db";

/** Extract the password from a postgres:// URL (handles percent-encoding). */
function parsePassword(url: string): string | null {
  const m = url.match(/^[a-z]+:\/\/[^:@/]+:([^@]*)@/i);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function main() {
  const appUrl = process.env.APP_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL (owner connection) is required.");
  if (!appUrl) throw new Error("APP_DATABASE_URL is required — it is the source of the tamanor_app password.");

  const pw = parsePassword(appUrl);
  if (!pw) throw new Error("Could not parse a password out of APP_DATABASE_URL.");
  const pwLit = pw.replace(/'/g, "''"); // safe single-quoted SQL literal

  const exists = await systemDb.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `SELECT true AS ok FROM pg_roles WHERE rolname = 'tamanor_app'`,
  );

  if (exists.length === 0) {
    console.log("• tamanor_app role missing — creating it (NOSUPERUSER, NOBYPASSRLS)…");
    await systemDb.$executeRawUnsafe(
      `CREATE ROLE tamanor_app LOGIN PASSWORD '${pwLit}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  } else {
    console.log("• tamanor_app role exists — aligning its password with APP_DATABASE_URL…");
    await systemDb.$executeRawUnsafe(`ALTER ROLE tamanor_app WITH LOGIN PASSWORD '${pwLit}'`);
  }

  // Idempotent privileges (safe to re-run). RLS policies themselves come from migrations.
  await systemDb.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO tamanor_app`);
  await systemDb.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tamanor_app`);
  await systemDb.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tamanor_app`);
  await systemDb.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tamanor_app`);
  await systemDb.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tamanor_app`);

  // V1.58.5 — keep provisioning ALIGNED with the security-hardening migration so re-running this never
  // re-opens a hole the migration closed: REVOKE the sensitive system/auth/global tables the broad
  // ON ALL TABLES grant would otherwise expose (raw webhook payloads, prospect PII, auth token hashes,
  // oauth identities, erasure/deletion receipts, billing idempotency, migration metadata). Every access
  // to these is via the OWNER (systemDb). NOTE: role ATTRIBUTES (NOSUPERUSER/NOBYPASSRLS/…) are NOT
  // altered here — managed Postgres (Supabase supautils) blocks a non-superuser owner from doing so,
  // and the role already carries them from v1_37_2; the rls-security audit enforces the invariant.
  const SENSITIVE = [
    "webhook_events", "leads", "stripe_webhook_events",
    "email_verification_tokens", "password_reset_tokens", "oauth_accounts",
    "lead_erasure_receipts", "tenant_deletion_receipts", "user_deletion_receipts", "_prisma_migrations",
  ];
  for (const t of SENSITIVE) {
    // Guard on existence so a fresh DB (before all migrations) never errors.
    await systemDb.$executeRawUnsafe(
      `DO $$ BEGIN IF to_regclass('public.${t.replace(/[^a-z_]/gi, "")}') IS NOT NULL THEN REVOKE ALL PRIVILEGES ON TABLE "${t.replace(/[^a-z_]/gi, "")}" FROM tamanor_app; END IF; END $$;`,
    );
  }

  console.log("✓ tamanor_app password aligned with APP_DATABASE_URL; privileges + revocations ensured (fail-closed).");

  // Warn if RLS is not actually enforced yet (migrations not deployed).
  try {
    const forced = await systemDb.$queryRawUnsafe<Array<{ f: boolean }>>(
      `SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'content_items'`,
    );
    if (!forced[0]?.f) {
      console.warn("! FORCE RLS is not active on content_items — run `pnpm db:migrate:deploy` before the RLS test.");
    } else {
      console.log("  RLS is enforced. Next: pnpm rls-isolation:test");
    }
  } catch {
    console.warn("! Could not verify RLS state (content_items missing?) — run `pnpm db:migrate:deploy` first.");
  }

  await systemDb.$disconnect();
}

main().catch(async (e) => {
  console.error("✗", e instanceof Error ? e.message : String(e));
  try { await systemDb.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});
