-- CS-C6 — Workspace onboarding state (FAMILY + BUSINESS). One row per tenant, tenant-scoped, RLS
-- ENABLE+FORCE with a STRICT tenant_isolation policy (NO IS NULL branch). Content-free: only the
-- immutable workspaceKind, the current onboarding step, and lifecycle timestamps. App role
-- SELECT/INSERT/UPDATE only — DELETE/TRUNCATE revoked (no hard delete). No existing migration modified.

CREATE TABLE "workspace_onboarding_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workspaceKind" TEXT NOT NULL,
    "currentStep" TEXT NOT NULL DEFAULT 'welcome',
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_onboarding_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_onboarding_states_tenantId_key" ON "workspace_onboarding_states"("tenantId");
CREATE INDEX "workspace_onboarding_states_tenantId_currentStep_idx" ON "workspace_onboarding_states"("tenantId", "currentStep");

-- completed status consistency: currentStep='complete' iff completedAt is set.
ALTER TABLE "workspace_onboarding_states" ADD CONSTRAINT "wos_complete_ts_consistent"
  CHECK (("currentStep" = 'complete') = ("completedAt" IS NOT NULL));

ALTER TABLE "workspace_onboarding_states" ADD CONSTRAINT "workspace_onboarding_states_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "workspace_onboarding_states" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "workspace_onboarding_states" FROM tamanor_app;

ALTER TABLE "workspace_onboarding_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_onboarding_states" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workspace_onboarding_states";
CREATE POLICY tenant_isolation ON "workspace_onboarding_states"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
