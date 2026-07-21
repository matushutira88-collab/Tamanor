-- V1.71 (Release B / B4) — tenant-scoped team invites, RLS-enforced.

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");
CREATE INDEX "invites_tenantId_status_idx" ON "invites"("tenantId", "status");
CREATE INDEX "invites_tenantId_emailNormalized_idx" ON "invites"("tenantId", "emailNormalized");

-- At most ONE pending invite per (tenant, email): a partial unique index (revoked/expired/accepted free it).
CREATE UNIQUE INDEX "invites_tenant_email_pending_key" ON "invites"("tenantId", "emailNormalized") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: tenant isolation (ENABLE + FORCE), the shared current_app_tenant_id() policy, and
-- the runtime-role grant.
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invites"
  USING (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id())
  WITH CHECK (current_app_tenant_id() IS NULL OR "tenantId" = current_app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "invites" TO tamanor_app;
