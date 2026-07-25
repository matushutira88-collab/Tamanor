-- Child Safety Reviewer Workspace V1 — operational review layer over the accepted canonical incident
-- domain (CS-C15C). Adds two APPEND-ONLY SYSTEM tables (reviewer notes + reviewer-activity events) and
-- two additive read indexes on the existing child_safety_incidents table. Does NOT modify any accepted
-- migration, table structure, enum, detector, or intervention flow. Forward-only, additive.
--
-- Both new tables are SYSTEM-scoped (accessed only by the owner-role systemDb, exactly like the rest of
-- the child_safety_* incident domain), so — like child_safety_incidents — ALL privileges are REVOKED
-- from the RLS-enforcing app role tamanor_app. Composite (id, tenantId) foreign keys to
-- child_safety_incidents make cross-tenant linking impossible at the DB level. Neither table stores raw
-- content beyond the reviewer's own confidential note body (internal-only, never logged/audited).

-- (1) append-only internal reviewer note (body is CONFIDENTIAL internal-only text)
CREATE TABLE "child_safety_reviewer_notes" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "incidentId"   TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body"         TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_reviewer_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_reviewer_notes_id_tenantId_key" ON "child_safety_reviewer_notes" ("id", "tenantId");
CREATE INDEX "child_safety_reviewer_notes_tenantId_incidentId_createdAt_idx" ON "child_safety_reviewer_notes" ("tenantId", "incidentId", "createdAt");

-- (2) append-only reviewer-activity event (deterministic reviewer timeline source)
CREATE TABLE "child_safety_review_events" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "incidentId"  TEXT NOT NULL,
    "eventType"   TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "fromValue"   TEXT,
    "toValue"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_review_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_review_events_id_tenantId_key" ON "child_safety_review_events" ("id", "tenantId");
CREATE INDEX "child_safety_review_events_tenantId_incidentId_createdAt_idx" ON "child_safety_review_events" ("tenantId", "incidentId", "createdAt");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_reviewer_notes"
    ADD CONSTRAINT "child_safety_reviewer_notes_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_review_events"
    ADD CONSTRAINT "child_safety_review_events_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Additive read indexes on the existing incident table for the reviewer list/dashboard (no structure change).
CREATE INDEX IF NOT EXISTS "child_safety_incidents_tenantId_status_escalationState_updatedAt_idx"
    ON "child_safety_incidents" ("tenantId", "status", "escalationState", "updatedAt");
CREATE INDEX IF NOT EXISTS "child_safety_incidents_tenantId_assignedReviewerId_status_idx"
    ON "child_safety_incidents" ("tenantId", "assignedReviewerId", "status");

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_reviewer_notes" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_review_events" FROM tamanor_app;
