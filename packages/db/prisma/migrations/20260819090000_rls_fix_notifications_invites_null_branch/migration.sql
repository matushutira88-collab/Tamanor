-- RC Stabilization — remove the bootstrap-permissive `current_app_tenant_id() IS NULL` branch from the
-- `tenant_isolation` RLS policies on `notifications` and `invites`.
--
-- Root cause: the accepted migrations 20260730_v1_70_notifications and 20260731_v1_71_team_invites created
-- their `tenant_isolation` policy as
--     (current_app_tenant_id() IS NULL) OR ("tenantId" = current_app_tenant_id())
-- copying the pre-hardening pattern. The `IS NULL` branch means that if the RLS app role (tamanor_app)
-- ever connects WITHOUT a tenant context set, the policy grants access to EVERY row cross-tenant. Every
-- other tenant table was hardened to the fail-closed form `("tenantId" = current_app_tenant_id())` in
-- 20260720_v1_58_5_rls_security_hardening; these two tables were added afterwards and regressed.
--
-- This is a corrective, FORWARD-ONLY migration. It does NOT edit any accepted migration. `current_app_
-- tenant_id()` = nullif(current_setting('app.tenant_id', true), ''), and withTenant() ALWAYS sets that GUC
-- before any query, so legitimate same-tenant runtime access is unaffected. Owner/systemDb bypasses RLS
-- (privileged worker/system paths keep working). With the IS NULL branch removed, an unset context yields
-- `"tenantId" = NULL` → no rows (fail-closed). No GRANT change; tamanor_app stays least-privilege.

-- notifications — recreate the single ALL policy without the permissive null branch.
DROP POLICY IF EXISTS "tenant_isolation" ON "notifications";
CREATE POLICY "tenant_isolation" ON "notifications"
    USING ("tenantId" = current_app_tenant_id())
    WITH CHECK ("tenantId" = current_app_tenant_id());

-- invites — recreate the single ALL policy without the permissive null branch.
DROP POLICY IF EXISTS "tenant_isolation" ON "invites";
CREATE POLICY "tenant_isolation" ON "invites"
    USING ("tenantId" = current_app_tenant_id())
    WITH CHECK ("tenantId" = current_app_tenant_id());
