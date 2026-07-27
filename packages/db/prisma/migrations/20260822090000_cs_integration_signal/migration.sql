-- Child Safety Integration Signal Protocol V1 — forward-only migration (hand-authored).
--
-- Six new SYSTEM tables for authorized partner-platform signal integration. Partners send only MINIMAL,
-- content-free structured safety signals; Tamanor authenticates by per-installation Ed25519 signature.
-- Tamanor stores ONLY public keys (never a private key), NO raw request body, and NO message content.
-- Like the rest of the child_safety_* domain, ALL privileges are REVOKED from the RLS app role tamanor_app
-- (accessed only via the owner-role systemDb with explicit tenant scoping), and composite (id, tenantId)
-- FKs make cross-tenant linking impossible. Unique (installation, idempotencyKey) and (installation,
-- nonceHash) are the replay/idempotency correctness boundary. No accepted migration is edited; no GRANT is
-- added; no data/seed is created.

CREATE TABLE "child_safety_integration_partners" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "partnerKey"            TEXT NOT NULL,
    "displayName"           TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'active',
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt"           TIMESTAMP(3),
    "retiredAt"             TIMESTAMP(3),
    CONSTRAINT "child_safety_integration_partners_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_integration_partners_id_tenantId_key" ON "child_safety_integration_partners" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_integration_partners_tenantId_partnerKey_key" ON "child_safety_integration_partners" ("tenantId", "partnerKey");
CREATE INDEX "child_safety_integration_partners_tenantId_status_idx" ON "child_safety_integration_partners" ("tenantId", "status");

CREATE TABLE "child_safety_integration_applications" (
    "id"                  TEXT NOT NULL,
    "tenantId"            TEXT NOT NULL,
    "partnerId"           TEXT NOT NULL,
    "applicationKey"      TEXT NOT NULL,
    "displayName"         TEXT NOT NULL,
    "environment"         TEXT NOT NULL DEFAULT 'sandbox',
    "status"              TEXT NOT NULL DEFAULT 'active',
    "protocolMinVersion"  TEXT NOT NULL DEFAULT '1.0',
    "protocolMaxVersion"  TEXT NOT NULL DEFAULT '1.0',
    "allowedCapabilities" TEXT NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_integration_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_integration_applications_id_tenantId_key" ON "child_safety_integration_applications" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_integration_applications_partnerId_applicationKey_key" ON "child_safety_integration_applications" ("partnerId", "applicationKey");
CREATE INDEX "child_safety_integration_applications_tenantId_status_idx" ON "child_safety_integration_applications" ("tenantId", "status");

CREATE TABLE "child_safety_integration_installations" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "partnerId"       TEXT NOT NULL,
    "applicationId"   TEXT NOT NULL,
    "installationKey" TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'active',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"      TIMESTAMP(3),
    "revokedAt"       TIMESTAMP(3),
    CONSTRAINT "child_safety_integration_installations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_integration_installations_id_tenantId_key" ON "child_safety_integration_installations" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_integration_installations_applicationId_installationKey_key" ON "child_safety_integration_installations" ("applicationId", "installationKey");
CREATE INDEX "child_safety_integration_installations_tenantId_status_idx" ON "child_safety_integration_installations" ("tenantId", "status");

CREATE TABLE "child_safety_integration_keys" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "keyVersion"     INTEGER NOT NULL,
    "algorithm"      TEXT NOT NULL DEFAULT 'ed25519',
    "publicKey"      TEXT NOT NULL,
    "fingerprint"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'active',
    "validFrom"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil"     TIMESTAMP(3),
    "revokedAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_integration_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_integration_keys_id_tenantId_key" ON "child_safety_integration_keys" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_integration_keys_installationId_keyVersion_key" ON "child_safety_integration_keys" ("installationId", "keyVersion");
CREATE INDEX "child_safety_integration_keys_tenantId_installationId_status_idx" ON "child_safety_integration_keys" ("tenantId", "installationId", "status");

CREATE TABLE "child_safety_integration_subjects" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "installationId"        TEXT NOT NULL,
    "pseudonymousSubjectId" TEXT NOT NULL,
    "protectedProfileId"    TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_safety_integration_subjects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_integration_subjects_id_tenantId_key" ON "child_safety_integration_subjects" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_integration_subjects_installationId_pseudonymousSubjectId_key" ON "child_safety_integration_subjects" ("installationId", "pseudonymousSubjectId");
CREATE INDEX "child_safety_integration_subjects_tenantId_installationId_idx" ON "child_safety_integration_subjects" ("tenantId", "installationId");

CREATE TABLE "child_safety_signal_receipts" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "partnerId"          TEXT NOT NULL,
    "applicationId"      TEXT NOT NULL,
    "installationId"     TEXT NOT NULL,
    "externalEventId"    TEXT NOT NULL,
    "idempotencyKey"     TEXT NOT NULL,
    "nonceHash"          TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "protocolVersion"    TEXT NOT NULL,
    "keyVersion"         INTEGER,
    "resultCode"         TEXT NOT NULL,
    "failureCategory"    TEXT,
    "canonicalSignalId"  TEXT,
    "policyDecisionId"   TEXT,
    "receivedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"        TIMESTAMP(3),
    "expiresAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_signal_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_signal_receipts_id_tenantId_key" ON "child_safety_signal_receipts" ("id", "tenantId");
CREATE UNIQUE INDEX "child_safety_signal_receipts_installationId_idempotencyKey_key" ON "child_safety_signal_receipts" ("installationId", "idempotencyKey");
CREATE UNIQUE INDEX "child_safety_signal_receipts_installationId_nonceHash_key" ON "child_safety_signal_receipts" ("installationId", "nonceHash");
CREATE INDEX "child_safety_signal_receipts_tenantId_installationId_receivedAt_idx" ON "child_safety_signal_receipts" ("tenantId", "installationId", "receivedAt");
CREATE INDEX "child_safety_signal_receipts_tenantId_resultCode_receivedAt_idx" ON "child_safety_signal_receipts" ("tenantId", "resultCode", "receivedAt");

-- Composite tenant-safe foreign keys (cross-tenant linking is impossible).
ALTER TABLE "child_safety_integration_applications"
    ADD CONSTRAINT "child_safety_integration_applications_partner_fkey"
    FOREIGN KEY ("partnerId", "tenantId") REFERENCES "child_safety_integration_partners" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_integration_installations"
    ADD CONSTRAINT "child_safety_integration_installations_partner_fkey"
    FOREIGN KEY ("partnerId", "tenantId") REFERENCES "child_safety_integration_partners" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_integration_installations"
    ADD CONSTRAINT "child_safety_integration_installations_application_fkey"
    FOREIGN KEY ("applicationId", "tenantId") REFERENCES "child_safety_integration_applications" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_integration_keys"
    ADD CONSTRAINT "child_safety_integration_keys_installation_fkey"
    FOREIGN KEY ("installationId", "tenantId") REFERENCES "child_safety_integration_installations" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_integration_subjects"
    ADD CONSTRAINT "child_safety_integration_subjects_installation_fkey"
    FOREIGN KEY ("installationId", "tenantId") REFERENCES "child_safety_integration_installations" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_integration_subjects"
    ADD CONSTRAINT "child_safety_integration_subjects_profile_fkey"
    FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_safety_signal_receipts"
    ADD CONSTRAINT "child_safety_signal_receipts_installation_fkey"
    FOREIGN KEY ("installationId", "tenantId") REFERENCES "child_safety_integration_installations" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_integration_partners" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_integration_applications" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_integration_installations" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_integration_keys" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_integration_subjects" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_signal_receipts" FROM tamanor_app;
