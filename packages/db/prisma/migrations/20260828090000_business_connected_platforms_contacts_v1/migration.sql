-- BUSINESS — CONNECTED PLATFORMS & CONTACTS FOUNDATION V1. Additive, forward-only, NON-destructive: only
-- CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT + RLS. No DROP, no ALTER of existing tables, no
-- data rewrite. Three tenant-scoped tables, each RLS enable+FORCE+tenant_isolation policy, with least-privilege
-- app-role grants (connections/contacts: SELECT/INSERT/UPDATE — never DELETE; ingestion ledger: append-only
-- SELECT/INSERT). Strictly separate from Family / Child-Safety data.

-- CreateEnum
CREATE TYPE "BusinessProvider" AS ENUM ('meta', 'google', 'tiktok', 'linkedin');

-- CreateEnum
CREATE TYPE "BusinessConnectionStatus" AS ENUM ('not_configured', 'pending', 'active', 'reauth_required', 'disconnected', 'error', 'awaiting_provider_approval');

-- CreateEnum
CREATE TYPE "BusinessConnectionCapability" AS ENUM ('lead_ingestion', 'comment_moderation', 'brand_monitoring');

-- CreateEnum
CREATE TYPE "BusinessContactSource" AS ENUM ('facebook', 'instagram', 'google_ads', 'youtube', 'tiktok', 'linkedin', 'web_form');

-- CreateEnum
CREATE TYPE "BusinessContactStatus" AS ENUM ('new', 'contacted', 'handled', 'customer', 'rejected');

-- CreateEnum
CREATE TYPE "BusinessIngestionResult" AS ENUM ('accepted', 'duplicate', 'rejected', 'invalid_signature', 'invalid_payload', 'unmapped_connection');

-- CreateTable
CREATE TABLE "business_platform_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "BusinessProvider" NOT NULL,
    "externalAccountId" TEXT,
    "displayName" TEXT,
    "status" "BusinessConnectionStatus" NOT NULL DEFAULT 'not_configured',
    "capabilities" "BusinessConnectionCapability"[] DEFAULT ARRAY[]::"BusinessConnectionCapability"[],
    "lastVerifiedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_platform_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "BusinessProvider" NOT NULL,
    "sourcePlatform" "BusinessContactSource" NOT NULL,
    "externalLeadId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "messageSummary" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "formId" TEXT,
    "formName" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "BusinessContactStatus" NOT NULL DEFAULT 'new',
    "assignedUserId" TEXT,
    "consentValue" BOOLEAN,
    "consentReference" TEXT,
    "consentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_contact_ingestion_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "BusinessProvider" NOT NULL,
    "providerEventId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "result" "BusinessIngestionResult" NOT NULL,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_contact_ingestion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_platform_connections_tenantId_status_idx" ON "business_platform_connections"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_platform_connections_tenantId_provider_key" ON "business_platform_connections"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "business_contacts_tenantId_status_receivedAt_idx" ON "business_contacts"("tenantId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "business_contacts_tenantId_sourcePlatform_receivedAt_idx" ON "business_contacts"("tenantId", "sourcePlatform", "receivedAt");

-- CreateIndex
CREATE INDEX "business_contacts_tenantId_assignedUserId_idx" ON "business_contacts"("tenantId", "assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "business_contacts_tenantId_dedupeKey_key" ON "business_contacts"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "business_contact_ingestion_events_tenantId_receivedAt_idx" ON "business_contact_ingestion_events"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "business_contact_ingestion_events_tenantId_provider_provide_idx" ON "business_contact_ingestion_events"("tenantId", "provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "business_platform_connections" ADD CONSTRAINT "business_platform_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "business_platform_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_contact_ingestion_events" ADD CONSTRAINT "business_contact_ingestion_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================ ROW-LEVEL SECURITY (tenant isolation) ============================
-- business_platform_connections: SELECT/INSERT/UPDATE (create/reconfigure/disconnect = status update). No DELETE.
ALTER TABLE "business_platform_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_platform_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_platform_connections"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON "business_platform_connections" TO tamanor_app;

-- business_contacts: SELECT/INSERT/UPDATE (ingest + status/assignment changes). No DELETE (never hard-deleted
-- by tenant UI; GDPR erasure runs as owner via systemDb, which bypasses RLS).
ALTER TABLE "business_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_contacts"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON "business_contacts" TO tamanor_app;

-- business_contact_ingestion_events: APPEND-ONLY ledger — SELECT + INSERT only (no UPDATE, no DELETE).
ALTER TABLE "business_contact_ingestion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_contact_ingestion_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_contact_ingestion_events"
  USING ("tenantId" = current_app_tenant_id())
  WITH CHECK ("tenantId" = current_app_tenant_id());
GRANT SELECT, INSERT ON "business_contact_ingestion_events" TO tamanor_app;
