-- Child Safety Policy Engine V1 — forward-only migration (hand-authored).
--
-- Four new SYSTEM tables for a centralized, versioned, immutable-after-activation, tenant-scoped decision
-- policy. Policy is DATA (a strict JSON structure over an allow-listed vocabulary), never executable code.
-- Like the rest of the child_safety_* incident domain, ALL privileges are REVOKED from the RLS app role
-- tamanor_app (these are accessed only via the owner-role systemDb with explicit tenant scoping), and
-- composite (id, tenantId) foreign keys make cross-tenant linking impossible. A partial unique index
-- guarantees AT MOST ONE ACTIVE version per policy at the database level. No accepted migration is edited;
-- no GRANT is added; no data/seed is created.

CREATE TABLE "child_safety_policies" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "policyKey"             TEXT NOT NULL,
    "purpose"               TEXT NOT NULL,
    "displayName"           TEXT NOT NULL,
    "description"           TEXT,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt"             TIMESTAMP(3),
    CONSTRAINT "child_safety_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_policies_id_tenantId_key" ON "child_safety_policies" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_policies_tenantId_policyKey_key" ON "child_safety_policies" ("tenantId", "policyKey");
CREATE INDEX "child_safety_policies_tenantId_purpose_idx" ON "child_safety_policies" ("tenantId", "purpose");

CREATE TABLE "child_safety_policy_versions" (
    "id"                      TEXT NOT NULL,
    "tenantId"                TEXT NOT NULL,
    "policyId"                TEXT NOT NULL,
    "versionNumber"           INTEGER NOT NULL,
    "status"                  TEXT NOT NULL DEFAULT 'DRAFT',
    "schemaVersion"           INTEGER NOT NULL,
    "engineVersion"           TEXT NOT NULL,
    "definitionJson"          JSONB NOT NULL,
    "definitionHash"          TEXT NOT NULL,
    "createdByMembershipId"   TEXT NOT NULL,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByMembershipId" TEXT,
    "submittedAt"             TIMESTAMP(3),
    "activatedByMembershipId" TEXT,
    "activatedAt"             TIMESTAMP(3),
    "rejectedByMembershipId"  TEXT,
    "rejectedAt"              TIMESTAMP(3),
    "rejectionReasonCode"     TEXT,
    "supersedesVersionId"     TEXT,
    "updatedAt"               TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_policy_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_policy_versions_id_tenantId_key" ON "child_safety_policy_versions" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_policy_versions_policyId_versionNumber_key" ON "child_safety_policy_versions" ("policyId", "versionNumber");
CREATE INDEX "child_safety_policy_versions_tenantId_policyId_status_idx" ON "child_safety_policy_versions" ("tenantId", "policyId", "status");
CREATE INDEX "child_safety_policy_versions_tenantId_status_idx" ON "child_safety_policy_versions" ("tenantId", "status");
-- AT MOST ONE active version per policy — enforced by the database, not just the service.
CREATE UNIQUE INDEX "child_safety_policy_versions_one_active_per_policy"
    ON "child_safety_policy_versions" ("policyId")
    WHERE "status" = 'ACTIVE';

CREATE TABLE "child_safety_policy_activation_approvals" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "policyVersionId"       TEXT NOT NULL,
    "decision"              TEXT NOT NULL,
    "reasonCode"            TEXT,
    "decidedByMembershipId" TEXT NOT NULL,
    "decidedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_policy_activation_approvals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_policy_activation_approvals_id_tenantId_key" ON "child_safety_policy_activation_approvals" ("id", "tenantId");
CREATE INDEX "child_safety_policy_activation_approvals_tenantId_policyVersionId_createdAt_idx" ON "child_safety_policy_activation_approvals" ("tenantId", "policyVersionId", "createdAt");

CREATE TABLE "child_safety_policy_decisions" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "policyId"              TEXT NOT NULL,
    "policyVersionId"       TEXT NOT NULL,
    "policyPurpose"         TEXT NOT NULL,
    "evaluationContextType" TEXT NOT NULL,
    "evaluationContextId"   TEXT,
    "inputFingerprint"      TEXT NOT NULL,
    "decisionCode"          TEXT NOT NULL,
    "decisionJson"          JSONB NOT NULL,
    "explanationJson"       JSONB NOT NULL,
    "engineVersion"         TEXT NOT NULL,
    "correlationId"         TEXT,
    "evaluatedAt"           TIMESTAMP(3) NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_policy_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_policy_decisions_id_tenantId_key" ON "child_safety_policy_decisions" ("id", "tenantId");
CREATE INDEX "child_safety_policy_decisions_tenantId_policyId_evaluatedAt_idx" ON "child_safety_policy_decisions" ("tenantId", "policyId", "evaluatedAt");
CREATE INDEX "child_safety_policy_decisions_tenantId_policyPurpose_evaluatedAt_idx" ON "child_safety_policy_decisions" ("tenantId", "policyPurpose", "evaluatedAt");
CREATE INDEX "child_safety_policy_decisions_tenantId_evaluationContextType_evaluationContextId_idx" ON "child_safety_policy_decisions" ("tenantId", "evaluationContextType", "evaluationContextId");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_policy_versions"
    ADD CONSTRAINT "child_safety_policy_versions_policy_fkey"
    FOREIGN KEY ("policyId", "tenantId") REFERENCES "child_safety_policies" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_policy_activation_approvals"
    ADD CONSTRAINT "child_safety_policy_activation_approvals_version_fkey"
    FOREIGN KEY ("policyVersionId", "tenantId") REFERENCES "child_safety_policy_versions" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_policies" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_policy_versions" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_policy_activation_approvals" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_policy_decisions" FROM tamanor_app;
