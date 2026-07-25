-- CS-C15C — canonical child-safety incident + signal-link + internal escalation domain. Real domain
-- records (NOT the ChildSafetyIntervention ledger). All three are SYSTEM tables (owner-role systemDb
-- only) — like the other child_safety_* system tables, ALL privileges are REVOKED from the app role
-- tamanor_app. Composite FKs to (id, tenantId) enforce tenant-consistent linking at the DB level, so
-- cross-tenant linking is impossible. Stores NO raw content / transcript / evidence / recipient contact.
-- Additive, forward-only. Also adds the internal notification type used by escalations.

-- Internal notification type for a child-safety escalation (used by the canonical notification path).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'child_safety_escalation';

-- (1) canonical incident
CREATE TABLE "child_safety_incidents" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'open',
    "riskFamily"         TEXT NOT NULL,
    "severity"           TEXT NOT NULL,
    "urgency"            TEXT NOT NULL,
    "openedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSignalAt"       TIMESTAMP(3) NOT NULL,
    "signalCount"        INTEGER NOT NULL DEFAULT 0,
    "escalationState"    TEXT NOT NULL DEFAULT 'none',
    "assignedReviewerId" TEXT,
    "resolutionCode"     TEXT,
    "lastReviewedAt"     TIMESTAMP(3),
    "closedAt"           TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_incidents_id_tenantId_key" ON "child_safety_incidents" ("id", "tenantId");
CREATE INDEX "child_safety_incidents_correlation_idx" ON "child_safety_incidents" ("tenantId", "protectedProfileId", "riskFamily", "status", "lastSignalAt");

-- (2) real signal↔incident link — one signal → at most one incident
CREATE TABLE "child_safety_incident_signals" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "incidentId"     TEXT NOT NULL,
    "safetySignalId" TEXT NOT NULL,
    "linkedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_incident_signals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_incident_signals_safetySignalId_key" ON "child_safety_incident_signals" ("safetySignalId");
CREATE UNIQUE INDEX "child_safety_incident_signals_incidentId_safetySignalId_key" ON "child_safety_incident_signals" ("incidentId", "safetySignalId");
CREATE INDEX "child_safety_incident_signals_tenantId_incidentId_idx" ON "child_safety_incident_signals" ("tenantId", "incidentId");

-- (3) canonical internal escalation — exactly-once per (incident, escalationType)
CREATE TABLE "child_safety_escalations" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "incidentId"     TEXT NOT NULL,
    "escalationType" TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'triggered',
    "urgency"        TEXT NOT NULL,
    "reasonCode"     TEXT NOT NULL,
    "triggeredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_escalations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_escalations_incidentId_escalationType_key" ON "child_safety_escalations" ("incidentId", "escalationType");
CREATE INDEX "child_safety_escalations_tenantId_incidentId_idx" ON "child_safety_escalations" ("tenantId", "incidentId");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_incidents"
    ADD CONSTRAINT "child_safety_incidents_profile_fkey"
    FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_incident_signals"
    ADD CONSTRAINT "child_safety_incident_signals_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_incident_signals"
    ADD CONSTRAINT "child_safety_incident_signals_signal_fkey"
    FOREIGN KEY ("safetySignalId", "tenantId") REFERENCES "safety_signals" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_escalations"
    ADD CONSTRAINT "child_safety_escalations_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_incidents" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_incident_signals" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_escalations" FROM tamanor_app;
