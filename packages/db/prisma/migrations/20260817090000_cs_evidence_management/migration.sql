-- Child Safety Evidence Management V1 — a canonical, immutable evidence domain attached to the canonical
-- ChildSafetyIncident (CS-C15C). Two APPEND-ONLY SYSTEM tables (evidence + chain-of-custody). Reuses the
-- existing domain-agnostic secure storage + sha256 integrity primitives (no new storage engine). Does NOT
-- modify any accepted migration, table, enum, detector, or intervention flow. Forward-only, additive.
--
-- Both tables are SYSTEM-scoped (owner-role systemDb only, like the rest of the child_safety_* incident
-- domain), so ALL privileges are REVOKED from the RLS app role tamanor_app. Composite (id, tenantId)
-- foreign keys to child_safety_incidents / child_safety_evidence make cross-tenant linking impossible.
-- No raw child content is stored: files live in secure storage (opaque key), URLs/labels are bounded, and
-- bodyText is a reviewer/system-authored internal description — never a message transcript.

-- (1) canonical immutable evidence record
CREATE TABLE "child_safety_evidence" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "incidentId"      TEXT NOT NULL,
    "evidenceType"    TEXT NOT NULL,
    "sourceType"      TEXT NOT NULL,
    "label"           TEXT,
    "storageKey"      TEXT,
    "externalUrl"     TEXT,
    "bodyText"        TEXT,
    "mimeType"        TEXT,
    "sizeBytes"       INTEGER,
    "contentHash"     TEXT NOT NULL,
    "hashAlgorithm"   TEXT NOT NULL DEFAULT 'sha256',
    "integrityStatus" TEXT NOT NULL DEFAULT 'unverified',
    "chainPosition"   INTEGER NOT NULL,
    "uploaderUserId"  TEXT,
    "sealed"          BOOLEAN NOT NULL DEFAULT false,
    "sealedAt"        TIMESTAMP(3),
    "capturedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_evidence_id_tenantId_key" ON "child_safety_evidence" ("id", "tenantId");
-- Deterministic, gap-free ordering of an incident's evidence chain (one item per position).
CREATE UNIQUE INDEX "child_safety_evidence_incidentId_chainPosition_key" ON "child_safety_evidence" ("incidentId", "chainPosition");
CREATE INDEX "child_safety_evidence_tenantId_incidentId_chainPosition_idx" ON "child_safety_evidence" ("tenantId", "incidentId", "chainPosition");
CREATE INDEX "child_safety_evidence_tenantId_evidenceType_idx" ON "child_safety_evidence" ("tenantId", "evidenceType");

-- (2) append-only chain-of-custody
CREATE TABLE "child_safety_evidence_custody_events" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "evidenceId"  TEXT NOT NULL,
    "eventType"   TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole"   TEXT,
    "reason"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_evidence_custody_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_evidence_custody_events_id_tenantId_key" ON "child_safety_evidence_custody_events" ("id", "tenantId");
CREATE INDEX "child_safety_evidence_custody_events_tenantId_evidenceId_createdAt_idx" ON "child_safety_evidence_custody_events" ("tenantId", "evidenceId", "createdAt");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_evidence"
    ADD CONSTRAINT "child_safety_evidence_incident_fkey"
    FOREIGN KEY ("incidentId", "tenantId") REFERENCES "child_safety_incidents" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_evidence_custody_events"
    ADD CONSTRAINT "child_safety_evidence_custody_events_evidence_fkey"
    FOREIGN KEY ("evidenceId", "tenantId") REFERENCES "child_safety_evidence" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_evidence" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_evidence_custody_events" FROM tamanor_app;
