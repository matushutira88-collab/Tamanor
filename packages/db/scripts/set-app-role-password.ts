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

  // CHILD-SAFETY hardening parity (CS-C*). The child-safety migrations REVOKE privileges from tamanor_app; the
  // broad `GRANT … DELETE ON ALL TABLES` above would otherwise UNDO that hardening whenever this script re-runs
  // after `migrate deploy` (e.g. a local rebuild), leaving DELETE on soft-delete-protected safety tables and full
  // access on owner-only reviewer/incident tables. Re-assert both, so re-running this NEVER re-opens a hole the
  // migrations closed. Kept EXACTLY in sync with the migration REVOKE statements (existence-guarded).
  const CS_REVOKE_ALL = [
    "child_safety_incidents", "child_safety_incident_signals", "child_safety_escalations",
    "child_safety_interventions", "child_safety_reviewer_notes", "child_safety_review_events",
    "child_safety_protection_plans", "child_safety_protection_actions", "child_safety_protection_action_events",
    "child_safety_installations", "child_safety_signal_ingestions", "child_safety_signal_receipts",
    "child_safety_evidence", "child_safety_evidence_custody_events",
    "child_safety_policies", "child_safety_policy_versions", "child_safety_policy_decisions", "child_safety_policy_activation_approvals",
    "child_safety_integration_partners", "child_safety_integration_applications", "child_safety_integration_installations",
    "child_safety_integration_keys", "child_safety_integration_subjects",
    "child_safety_partner_pilots", "child_safety_partner_pilot_checks", "child_safety_partner_pilot_events",
    "child_safety_partner_contacts", "child_safety_partner_operational_alerts", "child_safety_partner_test_runs",
  ];
  const CS_REVOKE_DELETE = [
    "protected_profiles", "guardian_relationships", "safety_signals",
    "guardian_authority_records", "consent_records", "safe_recipient_assessments",
    "safety_recipient_authorization_decisions", "safety_signal_deliveries",
    "family_guardian_invitations", "workspace_onboarding_states",
  ];
  const safe = (t: string) => t.replace(/[^a-z_]/gi, "");
  for (const t of CS_REVOKE_ALL) {
    await systemDb.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('public.${safe(t)}') IS NOT NULL THEN REVOKE ALL PRIVILEGES ON TABLE "${safe(t)}" FROM tamanor_app; END IF; END $$;`);
  }
  for (const t of CS_REVOKE_DELETE) {
    await systemDb.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('public.${safe(t)}') IS NOT NULL THEN REVOKE DELETE, TRUNCATE ON TABLE "${safe(t)}" FROM tamanor_app; END IF; END $$;`);
  }

  console.log("✓ tamanor_app password aligned with APP_DATABASE_URL; privileges + revocations (incl. child-safety hardening) ensured (fail-closed).");

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
