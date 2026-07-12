-- V1.37.2 — Postgres Row-Level Security & tenant isolation. Additive; no data loss.
-- Idempotent (safe to re-run in dev). Requires the runtime app to connect as a
-- NON-superuser, NON-bypassrls role for RLS to take effect (see tamanor_app below).

-- 1) Tenant-context helper. Missing/empty context => NULL => fail-closed (no rows,
--    mutations rejected). STABLE, not SECURITY DEFINER (must not bypass RLS).
CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS text
  LANGUAGE sql STABLE
  AS $fn$ SELECT nullif(current_setting('app.tenant_id', true), '') $fn$;

-- 2) Non-superuser runtime role. Production runtime MUST use this role (not the
--    owner/superuser) so RLS is enforced. Migrations keep using the owner role.
DO $role$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tamanor_app') THEN
    CREATE ROLE tamanor_app LOGIN PASSWORD 'tamanor_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $role$;
GRANT USAGE ON SCHEMA public TO tamanor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tamanor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tamanor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tamanor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tamanor_app;

-- 3) STRICT tenant tables (direct tenantId). FOR ALL policy: USING covers
--    SELECT/UPDATE/DELETE, WITH CHECK covers INSERT/UPDATE. No context => no access.
DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'action_queue_items','audit_logs','auto_protect_decisions','brand_auto_protect_policies',
    'brand_live_safety_settings','brand_risk_feedback','brand_risk_memory_rules','brand_rules',
    'brands','connected_accounts','content_items','control_policies','incidents',
    'meta_onboarding_sessions','moderation_decisions','platform_action_executions','provider_calls',
    'report_snapshots','reputation_items','sync_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;

-- 4) memberships — tenant-direct, but bootstrap-permissive (session lookup runs
--    before a tenant context exists). No context => allowed (bootstrap); with a
--    context => isolated to that tenant. Documented tradeoff; tightened in V1.37.3
--    once a dedicated bootstrap role exists.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "memberships";
CREATE POLICY tenant_isolation ON "memberships"
  USING (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id());

-- 5) user_sessions — bootstrap by tokenHash before tenant is known. Permissive on
--    no-context read; isolated within a context. Security rests on the token secret.
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_sessions";
CREATE POLICY tenant_isolation ON "user_sessions"
  USING (current_app_tenant_id() IS NULL OR "activeTenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "activeTenantId" = current_app_tenant_id());

-- 6) tenants — a request may only see/modify its ACTIVE tenant; no-context (bootstrap/
--    system) is permitted. Never lists all tenants under a tenant context.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  USING (current_app_tenant_id() IS NULL OR id = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR id = current_app_tenant_id());

-- 7) users — multi-tenant (a user may belong to several tenants). Under a tenant
--    context, only users sharing that tenant are visible (via membership EXISTS);
--    no-context bootstrap is permitted. Never lists all platform users.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING (current_app_tenant_id() IS NULL OR EXISTS (
    SELECT 1 FROM "memberships" m WHERE m."userId" = "users".id AND m."tenantId" = current_app_tenant_id()
  ));

-- 8) GLOBAL tables: intentionally NO tenant RLS.
--    - leads         : global marketing capture (no tenantId); platform-admin/system only (V1.37.3 to scope).
--    - webhook_events : global by design (provider webhooks arrive before tenant resolution).
--    - _prisma_migrations : migration metadata (system).
