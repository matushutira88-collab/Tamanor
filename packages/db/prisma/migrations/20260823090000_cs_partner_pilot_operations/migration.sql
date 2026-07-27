-- Child Safety Partner Pilot & Integration Operations V1 — forward-only migration (hand-authored).
--
-- Six new SYSTEM tables for the controlled, auditable partner-onboarding + pilot lifecycle on top of the
-- Integration Signal Protocol. These hold ONLY bounded operational metadata and server-approved scope BANDS
-- — NO raw request body, NO message content, NO credentials, NO private keys, NO full signatures, NO child
-- identity, NO guardian data, and NO arbitrary payload JSON. Like the rest of the child_safety_* domain, ALL
-- privileges are REVOKED from the RLS app role tamanor_app (accessed only via the owner-role systemDb with
-- explicit tenant scoping), and composite (id, tenantId) FKs make cross-tenant linking impossible. The pilot
-- event table is append-only. No accepted migration is edited; no GRANT is added; no data/seed is created.

CREATE TABLE "child_safety_partner_pilots" (
    "id"                                TEXT NOT NULL,
    "tenantId"                          TEXT NOT NULL,
    "partnerId"                         TEXT NOT NULL,
    "applicationId"                     TEXT NOT NULL,
    "environment"                       TEXT NOT NULL DEFAULT 'sandbox',
    "status"                            TEXT NOT NULL DEFAULT 'DRAFT',
    "version"                           INTEGER NOT NULL DEFAULT 1,
    "requestedCapabilities"             TEXT NOT NULL DEFAULT '',
    "approvedCapabilities"              TEXT NOT NULL DEFAULT '',
    "expectedMonthlySignalVolumeBand"   TEXT,
    "expectedPeakRequestsPerMinuteBand" TEXT,
    "monthlyVolumeBand"                 TEXT,
    "peakRateBand"                      TEXT,
    "intendedRegions"                   TEXT NOT NULL DEFAULT '',
    "intendedAgeBands"                  TEXT NOT NULL DEFAULT '',
    "intendedRiskCategories"            TEXT NOT NULL DEFAULT '',
    "approvedRegions"                   TEXT NOT NULL DEFAULT '',
    "approvedAgeBands"                  TEXT NOT NULL DEFAULT '',
    "approvedRiskCategories"            TEXT NOT NULL DEFAULT '',
    "allowedInstallationIds"            TEXT NOT NULL DEFAULT '',
    "privacyAssessmentStatus"           TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "securityAssessmentStatus"          TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "legalAuthorizationStatus"          TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "operationalReadinessStatus"        TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "readinessState"                    TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
    "readinessBlocking"                 TEXT NOT NULL DEFAULT '',
    "readinessEvaluatedAt"              TIMESTAMP(3),
    "pilotStartDate"                    TIMESTAMP(3),
    "pilotReviewDate"                   TIMESTAMP(3),
    "pilotEndDate"                      TIMESTAMP(3),
    "requestedAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedByUserId"                 TEXT NOT NULL,
    "reviewedAt"                        TIMESTAMP(3),
    "reviewedByUserId"                  TEXT,
    "approvedAt"                        TIMESTAMP(3),
    "approvedByUserId"                  TEXT,
    "activatedAt"                       TIMESTAMP(3),
    "activatedByUserId"                 TEXT,
    "suspendedAt"                       TIMESTAMP(3),
    "suspendedByUserId"                 TEXT,
    "terminatedAt"                      TIMESTAMP(3),
    "terminatedByUserId"                TEXT,
    "suspensionReasonCode"              TEXT,
    "terminationReasonCode"             TEXT,
    "reviewNotesSummary"                TEXT,
    "createdAt"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_partner_pilots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_pilots_id_tenantId_key" ON "child_safety_partner_pilots" ("id", "tenantId");
CREATE INDEX "child_safety_partner_pilots_tenantId_status_idx" ON "child_safety_partner_pilots" ("tenantId", "status");
CREATE INDEX "child_safety_partner_pilots_tenantId_applicationId_status_idx" ON "child_safety_partner_pilots" ("tenantId", "applicationId", "status");
CREATE INDEX "child_safety_partner_pilots_tenantId_partnerId_status_idx" ON "child_safety_partner_pilots" ("tenantId", "partnerId", "status");

CREATE TABLE "child_safety_partner_pilot_checks" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "pilotId"               TEXT NOT NULL,
    "checkType"             TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "checkedAt"             TIMESTAMP(3),
    "checkedByUserId"       TEXT,
    "evidenceReferenceType" TEXT,
    "evidenceReferenceId"   TEXT,
    "waiverReasonCode"      TEXT,
    "boundedComment"        TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_partner_pilot_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_pilot_checks_id_tenantId_key" ON "child_safety_partner_pilot_checks" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_partner_pilot_checks_pilotId_checkType_key" ON "child_safety_partner_pilot_checks" ("pilotId", "checkType");
CREATE INDEX "child_safety_partner_pilot_checks_tenantId_pilotId_idx" ON "child_safety_partner_pilot_checks" ("tenantId", "pilotId");

CREATE TABLE "child_safety_partner_pilot_events" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "pilotId"     TEXT NOT NULL,
    "eventType"   TEXT NOT NULL,
    "actorUserId" TEXT,
    "fromStatus"  TEXT,
    "toStatus"    TEXT,
    "reasonCode"  TEXT,
    "summary"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_partner_pilot_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_pilot_events_id_tenantId_key" ON "child_safety_partner_pilot_events" ("id", "tenantId");
CREATE INDEX "child_safety_partner_pilot_events_tenantId_pilotId_createdAt_idx" ON "child_safety_partner_pilot_events" ("tenantId", "pilotId", "createdAt");

CREATE TABLE "child_safety_partner_contacts" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "partnerId"        TEXT NOT NULL,
    "role"             TEXT NOT NULL,
    "displayName"      TEXT NOT NULL,
    "businessEmail"    TEXT NOT NULL,
    "organizationUnit" TEXT,
    "active"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_partner_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_contacts_id_tenantId_key" ON "child_safety_partner_contacts" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_partner_contacts_partnerId_role_businessEmail_key" ON "child_safety_partner_contacts" ("partnerId", "role", "businessEmail");
CREATE INDEX "child_safety_partner_contacts_tenantId_partnerId_role_idx" ON "child_safety_partner_contacts" ("tenantId", "partnerId", "role");

CREATE TABLE "child_safety_partner_test_runs" (
    "id"                      TEXT NOT NULL,
    "tenantId"                TEXT NOT NULL,
    "pilotId"                 TEXT NOT NULL,
    "installationId"          TEXT NOT NULL,
    "testType"                TEXT NOT NULL,
    "result"                  TEXT NOT NULL,
    "resultCode"              TEXT NOT NULL,
    "keyVersion"              INTEGER,
    "protocolVersion"         TEXT,
    "syntheticEventReference" TEXT,
    "diagnosticCategory"      TEXT,
    "startedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"             TIMESTAMP(3),
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_partner_test_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_test_runs_id_tenantId_key" ON "child_safety_partner_test_runs" ("id", "tenantId");
CREATE INDEX "child_safety_partner_test_runs_tenantId_pilotId_testType_idx" ON "child_safety_partner_test_runs" ("tenantId", "pilotId", "testType");

CREATE TABLE "child_safety_partner_operational_alerts" (
    "id"                   TEXT NOT NULL,
    "tenantId"             TEXT NOT NULL,
    "pilotId"              TEXT NOT NULL,
    "installationRef"      TEXT,
    "alertType"            TEXT NOT NULL,
    "severity"             TEXT NOT NULL,
    "status"               TEXT NOT NULL DEFAULT 'open',
    "count"                INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"           TIMESTAMP(3),
    "resolvedByUserId"     TEXT,
    "resolutionReasonCode" TEXT,
    "boundedSummary"       TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_partner_operational_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_partner_operational_alerts_id_tenantId_key" ON "child_safety_partner_operational_alerts" ("id", "tenantId");
CREATE INDEX "child_safety_partner_operational_alerts_tenantId_pilotId_status_idx" ON "child_safety_partner_operational_alerts" ("tenantId", "pilotId", "status");
CREATE INDEX "child_safety_partner_operational_alerts_tenantId_severity_status_idx" ON "child_safety_partner_operational_alerts" ("tenantId", "severity", "status");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_partner_pilots"
    ADD CONSTRAINT "child_safety_partner_pilots_partner_fkey"
    FOREIGN KEY ("partnerId", "tenantId") REFERENCES "child_safety_integration_partners" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_pilots"
    ADD CONSTRAINT "child_safety_partner_pilots_application_fkey"
    FOREIGN KEY ("applicationId", "tenantId") REFERENCES "child_safety_integration_applications" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_pilot_checks"
    ADD CONSTRAINT "child_safety_partner_pilot_checks_pilot_fkey"
    FOREIGN KEY ("pilotId", "tenantId") REFERENCES "child_safety_partner_pilots" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_pilot_events"
    ADD CONSTRAINT "child_safety_partner_pilot_events_pilot_fkey"
    FOREIGN KEY ("pilotId", "tenantId") REFERENCES "child_safety_partner_pilots" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_contacts"
    ADD CONSTRAINT "child_safety_partner_contacts_partner_fkey"
    FOREIGN KEY ("partnerId", "tenantId") REFERENCES "child_safety_integration_partners" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_test_runs"
    ADD CONSTRAINT "child_safety_partner_test_runs_pilot_fkey"
    FOREIGN KEY ("pilotId", "tenantId") REFERENCES "child_safety_partner_pilots" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_partner_operational_alerts"
    ADD CONSTRAINT "child_safety_partner_operational_alerts_pilot_fkey"
    FOREIGN KEY ("pilotId", "tenantId") REFERENCES "child_safety_partner_pilots" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_pilots" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_pilot_checks" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_pilot_events" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_contacts" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_test_runs" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_partner_operational_alerts" FROM tamanor_app;
