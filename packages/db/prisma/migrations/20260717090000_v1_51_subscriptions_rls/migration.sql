-- V1.51 — defense-in-depth RLS on the billing `subscriptions` table.
--
-- The billing tables were created in v1_50d WITHOUT row-level security. Today every read/write of
-- `subscriptions` goes through the OWNER client (`systemDb`) with an explicit `tenantId`/customer
-- filter, so there is no active cross-tenant leak. But that isolation rests entirely on application
-- code remembering the filter — exactly the class of mistake RLS exists to backstop everywhere else.
-- This migration ENABLE+FORCE row-level security so that, should any query ever run through the
-- restricted `tamanor_app` runtime role (appDb, which sets `app.tenant_id`), it is confined to the
-- caller's own tenant at the DATABASE level.
--
-- The policy is the PERMISSIVE bootstrap style already used by `tenants`/`memberships`/`users`:
-- `current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id()`. The `IS NULL` branch
-- keeps the existing no-context owner-client billing reads working unchanged (a webhook resolves the
-- tenant from the trusted Stripe customer BEFORE it has a tenant context), while any context-bearing
-- query is tenant-scoped. `stripe_webhook_events` has no tenant column and remains an intentional
-- global table (owner-only, alongside `webhook_events`) — no RLS.

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id());
