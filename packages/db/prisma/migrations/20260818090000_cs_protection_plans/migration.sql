-- Child Safety Protection Plans V1 — an internal protective-action plan domain over the canonical
-- ChildSafetyIncident (CS-C15C). Three APPEND-friendly SYSTEM tables. Does NOT modify any accepted
-- migration, table, enum, detector, intervention, correlation, escalation, reviewer, or evidence logic.
-- Forward-only, additive.
--
-- All three tables are SYSTEM-scoped (owner-role systemDb only, like the rest of the child_safety_*
-- domain), so ALL privileges are REVOKED from the RLS app role tamanor_app. Composite (id, tenantId)
-- foreign keys make cross-tenant linking impossible. No raw child content is stored; completion notes and
-- block reasons are internal protected free text confined to the action row (never events/audit).

-- (1) the plan (at most ONE non-terminal plan per incident — partial unique index below)
CREATE TABLE "child_safety_protection_plans" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "incidentId"   TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'draft',
    "priority"     TEXT NOT NULL DEFAULT 'normal',
    "createdBy"    TEXT NOT NULL,
    "activatedAt"  TIMESTAMP(3),
    "completedAt"  TIMESTAMP(3),
    "closedReason" TEXT,
    "revision"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_protection_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_protection_plans_id_tenantId_key" ON "child_safety_protection_plans" ("id", "tenantId");
CREATE INDEX "child_safety_protection_plans_tenantId_incidentId_status_idx" ON "child_safety_protection_plans" ("tenantId", "incidentId", "status");
-- Hard guarantee: at most ONE non-terminal (draft/active/reopened) plan per incident.
CREATE UNIQUE INDEX "child_safety_protection_plans_one_active_per_incident"
    ON "child_safety_protection_plans" ("incidentId")
    WHERE "status" IN ('draft', 'active', 'reopened');

-- (2) the actions (sequence unique per plan)
CREATE TABLE "child_safety_protection_actions" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "planId"             TEXT NOT NULL,
    "actionType"         TEXT NOT NULL,
    "title"              TEXT NOT NULL,
    "description"        TEXT,
    "priority"           TEXT NOT NULL DEFAULT 'normal',
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "assignedReviewerId" TEXT,
    "dueAt"              TIMESTAMP(3),
    "completedAt"        TIMESTAMP(3),
    "completedBy"        TEXT,
    "completionNote"     TEXT,
    "blockReason"        TEXT,
    "sequence"           INTEGER NOT NULL,
    "createdBy"          TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_protection_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_protection_actions_id_tenantId_key" ON "child_safety_protection_actions" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_protection_actions_planId_sequence_key" ON "child_safety_protection_actions" ("planId", "sequence");
CREATE INDEX "child_safety_protection_actions_tenantId_planId_status_idx" ON "child_safety_protection_actions" ("tenantId", "planId", "status");
CREATE INDEX "child_safety_protection_actions_tenantId_assignedReviewerId_status_idx" ON "child_safety_protection_actions" ("tenantId", "assignedReviewerId", "status");
CREATE INDEX "child_safety_protection_actions_tenantId_dueAt_idx" ON "child_safety_protection_actions" ("tenantId", "dueAt");

-- (3) append-only plan/action events
CREATE TABLE "child_safety_protection_action_events" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "planId"      TEXT NOT NULL,
    "actionId"    TEXT,
    "eventType"   TEXT NOT NULL,
    "actorUserId" TEXT,
    "fromValue"   TEXT,
    "toValue"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_protection_action_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_protection_action_events_id_tenantId_key" ON "child_safety_protection_action_events" ("id", "tenantId");
CREATE INDEX "child_safety_protection_action_events_tenantId_planId_createdAt_idx" ON "child_safety_protection_action_events" ("tenantId", "planId", "createdAt");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_protection_plans"
    ADD CONSTRAINT "child_safety_protection_plans_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_protection_actions"
    ADD CONSTRAINT "child_safety_protection_actions_plan_fkey"
    FOREIGN KEY ("planId", "tenantId") REFERENCES "child_safety_protection_plans" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_protection_action_events"
    ADD CONSTRAINT "child_safety_protection_action_events_plan_fkey"
    FOREIGN KEY ("planId", "tenantId") REFERENCES "child_safety_protection_plans" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_protection_plans" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_protection_actions" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_protection_action_events" FROM tamanor_app;
