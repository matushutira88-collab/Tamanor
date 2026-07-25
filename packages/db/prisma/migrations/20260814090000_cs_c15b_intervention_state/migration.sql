-- CS-C15B — durable protective-intervention state for exactly-once side effects + partial-failure
-- recovery. One row per accepted SafetySignal (unique). SYSTEM table (owner-role systemDb only), so —
-- like child_safety_installations — ALL privileges are REVOKED from the RLS-enforcing app role
-- tamanor_app. Stores NO raw content, NO recipient contact, NO secret: ids, coarse enum labels, and
-- bounded failure metadata only. Additive, forward-only; touches no existing table.

CREATE TABLE "child_safety_interventions" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "safetySignalId"     TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "decisionVersion"    TEXT NOT NULL DEFAULT 'cs-c15b-v1',
    "outcome"            TEXT NOT NULL,
    "correlationKey"     TEXT NOT NULL,
    "reviewStatus"       TEXT NOT NULL DEFAULT 'pending',
    "reviewRef"          TEXT,
    "incidentStatus"     TEXT NOT NULL DEFAULT 'pending',
    "incidentRef"        TEXT,
    "escalationStatus"   TEXT NOT NULL DEFAULT 'pending',
    "escalationRef"      TEXT,
    "deliveryStatus"     TEXT NOT NULL DEFAULT 'pending',
    "deliveryRef"        TEXT,
    "severity"           TEXT NOT NULL,
    "urgency"            TEXT NOT NULL,
    "attemptCount"       INTEGER NOT NULL DEFAULT 0,
    "lastFailureClass"   TEXT,
    "nextRetryAt"        TIMESTAMP(3),
    "completedAt"        TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_interventions_pkey" PRIMARY KEY ("id")
);
-- Exactly one durable intervention per accepted signal.
CREATE UNIQUE INDEX "child_safety_interventions_safetySignalId_key" ON "child_safety_interventions" ("safetySignalId");
CREATE UNIQUE INDEX "child_safety_interventions_tenantId_safetySignalId_key" ON "child_safety_interventions" ("tenantId", "safetySignalId");
CREATE INDEX "child_safety_interventions_tenantId_correlationKey_completedAt_idx" ON "child_safety_interventions" ("tenantId", "correlationKey", "completedAt");
CREATE INDEX "child_safety_interventions_tenantId_incidentRef_idx" ON "child_safety_interventions" ("tenantId", "incidentRef");

-- SYSTEM table — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_interventions" FROM tamanor_app;
