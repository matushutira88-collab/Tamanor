-- CS-C6 — Privacy Gateway persistence: SDK installation credentials + replay/idempotency records.
--
-- Both tables are SYSTEM-scoped (accessed only by the owner-role systemDb during pre-tenant gateway
-- authentication), so — exactly like stripe_webhook_events — ALL privileges are REVOKED from the
-- RLS-enforcing app role tamanor_app (the default GRANT is undone), and no RLS policy is needed. They
-- store NO raw content: only hashes, opaque nonces/keys, and opaque ids.
-- Additive, forward-only. Does not touch any existing table.

-- (1) SDK installation credential (secret stored HASHED only)
CREATE TABLE "child_safety_installations" (
    "id"            TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantId"      TEXT,
    "subjectRef"    TEXT,
    "scopes"        TEXT NOT NULL,
    "tokenHash"     TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "issuedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMP(3),
    "revokedAt"     TIMESTAMP(3),
    "lastUsedAt"    TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_installations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "child_safety_installations_tokenHash_key" ON "child_safety_installations" ("tokenHash");
CREATE INDEX "child_safety_installations_applicationId_idx" ON "child_safety_installations" ("applicationId");
CREATE INDEX "child_safety_installations_tenantId_idx" ON "child_safety_installations" ("tenantId");

-- (2) replay + idempotency record
CREATE TABLE "child_safety_signal_ingestions" (
    "id"             TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "nonce"          TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "payloadHash"    TEXT NOT NULL,
    "signalId"       TEXT,
    "receiptId"      TEXT NOT NULL,
    "outcome"        TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_safety_signal_ingestions_pkey" PRIMARY KEY ("id")
);
-- Anti-replay: a nonce may be used at most once per installation (one installation never poisons another).
CREATE UNIQUE INDEX "child_safety_signal_ingestions_installationId_nonce_key" ON "child_safety_signal_ingestions" ("installationId", "nonce");
-- Idempotency: at most one record per (installation, idempotencyKey) when a key is supplied.
CREATE UNIQUE INDEX "child_safety_signal_ingestions_inst_idem_key" ON "child_safety_signal_ingestions" ("installationId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX "child_safety_signal_ingestions_installationId_createdAt_idx" ON "child_safety_signal_ingestions" ("installationId", "createdAt");
CREATE INDEX "child_safety_signal_ingestions_expiresAt_idx" ON "child_safety_signal_ingestions" ("expiresAt");

ALTER TABLE "child_safety_signal_ingestions"
    ADD CONSTRAINT "child_safety_signal_ingestions_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES "child_safety_installations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (3) SYSTEM tables — the RLS-enforcing app role must have NO access (undo the default GRANT).
REVOKE ALL PRIVILEGES ON TABLE "child_safety_installations" FROM tamanor_app;
REVOKE ALL PRIVILEGES ON TABLE "child_safety_signal_ingestions" FROM tamanor_app;
