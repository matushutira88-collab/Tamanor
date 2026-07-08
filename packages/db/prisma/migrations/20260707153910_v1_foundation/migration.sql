-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('facebook_page', 'instagram_business', 'youtube', 'linkedin_company', 'tiktok', 'google_business');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'analyst', 'reviewer', 'viewer');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "BrandTone" AS ENUM ('professional', 'friendly', 'formal', 'casual', 'empathetic');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('pending', 'active', 'mock_connected', 'expired', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('comment', 'reply', 'review', 'mention', 'direct_message');

-- CreateEnum
CREATE TYPE "ReputationStatus" AS ENUM ('new', 'classified', 'needs_approval', 'actioned', 'escalated', 'ignored', 'resolved');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('blocked_words', 'competitor_mentions', 'crisis_keywords', 'custom_phrases');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('none', 'low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('negative', 'neutral', 'positive');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('none', 'reply', 'hide', 'delete', 'mark_resolved', 'escalate');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('ai', 'human', 'rule', 'system');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('proposed', 'approved', 'rejected', 'executed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultTone" "BrandTone" NOT NULL DEFAULT 'professional',
    "status" "BrandStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'pending',
    "externalId" TEXT NOT NULL,
    "externalName" TEXT,
    "scopes" TEXT[],
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalParentId" TEXT,
    "text" TEXT NOT NULL,
    "authorExternalId" TEXT,
    "authorDisplayName" TEXT,
    "authorLocale" TEXT,
    "rating" INTEGER,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "status" "ReputationStatus" NOT NULL DEFAULT 'new',
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'none',
    "riskConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskCategories" TEXT[],
    "sentiment" "Sentiment" NOT NULL DEFAULT 'neutral',
    "riskRationale" TEXT,
    "riskEngine" TEXT,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reputation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "reputationItemId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorUserId" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'proposed',
    "replyText" TEXT,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "phrases" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT,
    "event" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorUserId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tenantId_key" ON "memberships"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "brands_tenantId_idx" ON "brands"("tenantId");

-- CreateIndex
CREATE INDEX "connected_accounts_tenantId_idx" ON "connected_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "connected_accounts_brandId_idx" ON "connected_accounts"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_brandId_platform_externalId_key" ON "connected_accounts"("brandId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "content_items_tenantId_idx" ON "content_items"("tenantId");

-- CreateIndex
CREATE INDEX "content_items_brandId_idx" ON "content_items"("brandId");

-- CreateIndex
CREATE INDEX "content_items_platform_idx" ON "content_items"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_connectedAccountId_externalId_key" ON "content_items"("connectedAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_items_contentItemId_key" ON "reputation_items"("contentItemId");

-- CreateIndex
CREATE INDEX "reputation_items_tenantId_idx" ON "reputation_items"("tenantId");

-- CreateIndex
CREATE INDEX "reputation_items_brandId_status_idx" ON "reputation_items"("brandId", "status");

-- CreateIndex
CREATE INDEX "reputation_items_riskLevel_idx" ON "reputation_items"("riskLevel");

-- CreateIndex
CREATE INDEX "moderation_decisions_tenantId_idx" ON "moderation_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "moderation_decisions_brandId_idx" ON "moderation_decisions"("brandId");

-- CreateIndex
CREATE INDEX "moderation_decisions_reputationItemId_idx" ON "moderation_decisions"("reputationItemId");

-- CreateIndex
CREATE INDEX "moderation_decisions_status_idx" ON "moderation_decisions"("status");

-- CreateIndex
CREATE INDEX "brand_rules_tenantId_idx" ON "brand_rules"("tenantId");

-- CreateIndex
CREATE INDEX "brand_rules_brandId_enabled_idx" ON "brand_rules"("brandId", "enabled");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_event_idx" ON "audit_logs"("event");

-- CreateIndex
CREATE INDEX "report_snapshots_tenantId_idx" ON "report_snapshots"("tenantId");

-- CreateIndex
CREATE INDEX "report_snapshots_brandId_periodEnd_idx" ON "report_snapshots"("brandId", "periodEnd");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_items" ADD CONSTRAINT "reputation_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_items" ADD CONSTRAINT "reputation_items_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_items" ADD CONSTRAINT "reputation_items_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reputationItemId_fkey" FOREIGN KEY ("reputationItemId") REFERENCES "reputation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
