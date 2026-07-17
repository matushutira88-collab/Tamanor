-- V1.58.5 — RLS & database security hardening (Phase 2, Production Trust). Runs as the OWNER
-- (postgres, bypassrls). PRODUCTION-SAFE + NO deployment-order window:
--   • Bootstrap/session, webhook and leads all use the OWNER client (systemDb, bypassrls=true), so
--     the RLS policies never apply to them — changing the policies cannot break login/webhook/leads.
--   • appDb (tamanor_app, NOBYPASSRLS) reaches tenant tables ONLY via withTenantDb, which always sets
--     app.tenant_id first — so the removed "IS NULL OR" bootstrap-permissive branch is DEAD CODE for
--     the app. Removing it only closes a defense-in-depth hole; no app code change required.
-- ADDITIVE/RESTRICTIVE only: no table/column DROP, no data change. ROLLBACK = restore the prior
-- permissive policies (IS NULL OR …) and re-GRANT webhook_events/leads to tamanor_app.

-- A) Role attributes. The role already carries NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE from
--    v1_37_2's CREATE ROLE (verified: appDb reports rolbypassrls=false), and PostgreSQL 15+ denies
--    CREATE on the public schema to PUBLIC by default — so no re-assert is needed here. Deliberately
--    NO `ALTER ROLE …` statement: managed Postgres (Supabase supautils) blocks a non-superuser owner
--    from altering role attributes, and a migration must never carry a password. The rls-security audit
--    ENFORCES the invariants (NOBYPASSRLS / not superuser / NOCREATEROLE / NOCREATEDB / no schema
--    CREATE); the mandatory set-app-role-password provisioning step owns LOGIN + the strong secret.

-- B) FAIL-CLOSED tenant policies — remove the "current_app_tenant_id() IS NULL OR" branch on the four
--    bootstrap tables. No context ⇒ zero rows on read AND rejected writes for the app role. Explicit
--    USING (SELECT/UPDATE/DELETE) + WITH CHECK (INSERT/UPDATE). FORCE RLS stays on (from v1_37_2).
DROP POLICY IF EXISTS tenant_isolation ON "memberships";
CREATE POLICY tenant_isolation ON "memberships"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON "user_sessions";
CREATE POLICY tenant_isolation ON "user_sessions"
  USING ("activeTenantId" = current_app_tenant_id())
  WITH CHECK ("activeTenantId" = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = current_app_tenant_id())
  WITH CHECK (id = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (EXISTS (SELECT 1 FROM "memberships" m WHERE m."userId" = "users".id AND m."tenantId" = current_app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "memberships" m WHERE m."userId" = "users".id AND m."tenantId" = current_app_tenant_id()));

-- B2) Billing tenant tables (v1_51 subscriptions, v1_57_3a stripe_checkout_attempts) also carried the
--     permissive IS NULL branch. Billing writes go through systemDb (bypassrls), and appDb never
--     queries these tables, so the branch is dead code here too — harden to the same fail-closed form.
DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";
CREATE POLICY tenant_isolation ON "subscriptions"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON "stripe_checkout_attempts";
CREATE POLICY tenant_isolation ON "stripe_checkout_attempts"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());

-- C) Sensitive GLOBAL tables (owner/systemDb ONLY): webhook_events (raw provider payloads + tenantId),
--    leads (prospect PII), stripe_webhook_events (billing idempotency). Every access path is via
--    systemDb — the app role must never touch them. Revoke all privileges from tamanor_app so it gets
--    permission denied. (These tables use cuid text ids — no owned sequences to revoke.)
REVOKE ALL PRIVILEGES ON TABLE "webhook_events" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "leads" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "stripe_webhook_events" FROM tamanor_app;

-- C2) System/auth tables with NO tenantId (no tenant application path) that the v1_37_2 ON ALL TABLES
--     grant exposed to the app role — including auth token-hash tables. Every access is via systemDb
--     (verified). Revoke so the app role can never read verification/reset tokens, oauth identities,
--     erasure/deletion receipts, or migration metadata.
REVOKE ALL PRIVILEGES ON TABLE "email_verification_tokens" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "password_reset_tokens" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "oauth_accounts" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "lead_erasure_receipts" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "tenant_deletion_receipts" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "user_deletion_receipts" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM tamanor_app;
