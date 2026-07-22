-- CS-C5 — Internal Delivery Foundation. One FAMILY-only, tenant-scoped table `safety_signal_deliveries`.
-- An INTERNAL record that an already-authorized minimal disclosure is PREPARED for an authorized
-- recipient — point 7 of the pipeline. NOTHING is sent externally; no CS-1..C4 record is mutated. RLS
-- ENABLE+FORCE with a STRICT tenant_isolation policy (NO IS NULL branch). App role: SELECT/INSERT/UPDATE
-- only — DELETE/TRUNCATE revoked so revoke/expire/supersede/archive preserve history. Values are TEXT
-- validated in @guardora/core; the disclosure snapshot is safe enums + bounded scalars (no JSON/free text).
--
-- Required links (signal, profile, authorization decision) are same-tenant composite FKs (ON DELETE NO
-- ACTION → never cascade-delete delivery history; tenant lifecycle cleans up via the tenant FK). The
-- recipient/acknowledgedBy/declinedBy membership ids have NO DB FK: `removeMember` (team-repo.ts) hard-
-- deletes memberships, so NO ACTION/RESTRICT would block legitimate member removal and CASCADE would
-- delete delivery history — same-tenant is enforced in the repository (RLS lookup). No existing
-- migration is modified.

-- CS-C5 prerequisite: a composite unique on the CS-C4 table so a delivery can reference (id, tenantId).
CREATE UNIQUE INDEX "safety_recipient_authorization_decisions_id_tenantId_key" ON "safety_recipient_authorization_decisions"("id", "tenantId");

-- CreateTable
CREATE TABLE "safety_signal_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "safetySignalId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    "recipientAuthorizationDecisionId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'prepared',
    "deliveryChannel" TEXT NOT NULL DEFAULT 'internal_inbox',
    "disclosureScope" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "occurrenceBucket" TEXT,
    "recommendedActionClass" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByMembershipId" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declinedByMembershipId" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReasonCode" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "safety_signal_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — idempotency guard + tenant/signal/profile/decision/recipient lookups + effective lookup.
CREATE UNIQUE INDEX "ssd_idempotency_key" ON "safety_signal_deliveries"("tenantId", "recipientAuthorizationDecisionId", "recipientMembershipId", "idempotencyKey");
CREATE INDEX "ssd_tenant_signal_status_idx" ON "safety_signal_deliveries"("tenantId", "safetySignalId", "deliveryStatus");
CREATE INDEX "ssd_tenant_profile_idx" ON "safety_signal_deliveries"("tenantId", "protectedProfileId");
CREATE INDEX "ssd_tenant_decision_idx" ON "safety_signal_deliveries"("tenantId", "recipientAuthorizationDecisionId");
CREATE INDEX "ssd_tenant_recipient_idx" ON "safety_signal_deliveries"("tenantId", "recipientMembershipId");
CREATE INDEX "ssd_effective_lookup_idx" ON "safety_signal_deliveries"("tenantId", "safetySignalId", "recipientMembershipId", "createdAt");

-- CHECK constraints — status/timestamp/scope/channel/idempotency integrity (fail-closed at the DB level).
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_ack_consistent"
  CHECK ("deliveryStatus" <> 'acknowledged' OR ("acknowledgedAt" IS NOT NULL AND "acknowledgedByMembershipId" IS NOT NULL));
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_decline_consistent"
  CHECK ("deliveryStatus" <> 'declined' OR ("declinedAt" IS NOT NULL AND "declinedByMembershipId" IS NOT NULL));
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_failed_consistent"
  CHECK ("deliveryStatus" <> 'failed' OR ("failedAt" IS NOT NULL AND "failureReasonCode" IS NOT NULL));
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_revoked_ts"
  CHECK ("deliveryStatus" <> 'revoked' OR "revokedAt" IS NOT NULL);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_expired_ts"
  CHECK ("deliveryStatus" <> 'expired' OR "expiredAt" IS NOT NULL);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_superseded_ts"
  CHECK ("deliveryStatus" <> 'superseded' OR "supersededAt" IS NOT NULL);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_available_ts"
  CHECK ("deliveryStatus" <> 'available' OR "availableAt" IS NOT NULL);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_archived_ts"
  CHECK (("deliveryStatus" = 'archived') = ("archivedAt" IS NOT NULL));
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_scope_nonempty"
  CHECK (length("disclosureScope") > 0);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_channel_internal"
  CHECK ("deliveryChannel" = 'internal_inbox');
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_idempotency_nonempty"
  CHECK (length("idempotencyKey") > 0);
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_ack_decline_exclusive"
  CHECK (NOT ("acknowledgedAt" IS NOT NULL AND "declinedAt" IS NOT NULL));
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "ssd_expired_after_prepared"
  CHECK ("expiredAt" IS NULL OR "expiredAt" > "preparedAt");

-- AddForeignKey — tenant (cascade for tenant lifecycle) + REQUIRED same-tenant composite FKs (NO ACTION).
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "safety_signal_deliveries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "safety_signal_deliveries_safetySignalId_tenantId_fkey"
  FOREIGN KEY ("safetySignalId", "tenantId") REFERENCES "safety_signals"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "safety_signal_deliveries_protectedProfileId_tenantId_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "safety_signal_deliveries" ADD CONSTRAINT "safety_signal_deliveries_recipientAuthorizationDecisionId__fkey"
  FOREIGN KEY ("recipientAuthorizationDecisionId", "tenantId") REFERENCES "safety_recipient_authorization_decisions"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- GRANTs — read/append/soft-update only; no hard delete (history preserved). Owner keeps full rights.
GRANT SELECT, INSERT, UPDATE ON "safety_signal_deliveries" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "safety_signal_deliveries" FROM tamanor_app;

-- Row-Level Security (strict tenant_isolation, ENABLE+FORCE, NO IS NULL branch).
ALTER TABLE "safety_signal_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_signal_deliveries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "safety_signal_deliveries";
CREATE POLICY tenant_isolation ON "safety_signal_deliveries"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
