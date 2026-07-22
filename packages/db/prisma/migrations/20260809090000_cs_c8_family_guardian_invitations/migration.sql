-- CS-C8 — Family Guardian Invitation & Membership Activation. ONE new FAMILY-only, tenant-scoped,
-- content-free table: `family_guardian_invitations`. It is a SEPARATE domain entity — deliberately NOT
-- the Business `invites` table, NOT `notifications`, and NOT any CS-C1..C7 entity.
--
-- The invitation NEVER grants authority/consent/safe-recipient status by itself: accepting it may only
-- (in one transaction) create/reuse a Family Membership and create/reactivate a GuardianRelationship in
-- an explicit, bounded role. No email/SMS/push/webhook is ever sent — the opaque one-time link is handed
-- over manually by the inviter. The raw token is NEVER stored (only its sha256 hash), never logged, never
-- audited. No PII of a minor is stored: `invitedEmailNormalized` is the ADULT invitee's email; the only
-- profile linkage is a tenant-scoped FK.
--
-- Access model (mirrors the V1.71 team-invite): the INVITER (an active Family member) operates through
-- RLS (SELECT/INSERT/UPDATE, tenant_isolation). ACCEPT/DECLINE run as a SYSTEM path authorized by the
-- secret token hash + a session-email match — the invitee has no membership yet, so RLS cannot see the
-- row. DELETE is REVOKED for the app role: the lifecycle is append-only (soft terminal states only).

CREATE TABLE "family_guardian_invitations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "protectedProfileId" TEXT NOT NULL,
    -- ADULT invitee email (normalized). NEVER a child's identity. Never logged/audited in the clear.
    "invitedEmailNormalized" TEXT NOT NULL,
    "invitedByMembershipId" TEXT NOT NULL,
    -- Intended roles are BOUNDED. intendedFamilyRole excludes primary_guardian (no owner escalation).
    "intendedFamilyRole" TEXT NOT NULL,
    "intendedGuardianRole" TEXT NOT NULL,
    "intendedRelationshipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    -- Only the sha256 hash of the opaque token is ever stored. The plaintext is revealed once, at create.
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "family_guardian_invitations_pkey" PRIMARY KEY ("id")
);

-- Bounded domain values (validated against @guardora/core enums; no duplicated DB enum types).
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_status_bounded"
  CHECK ("status" IN ('pending','accepted','declined','revoked','expired'));
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_family_role_bounded"
  CHECK ("intendedFamilyRole" IN ('guardian','trusted_adult','safety_professional','family_viewer'));
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_guardian_role_bounded"
  CHECK ("intendedGuardianRole" IN ('primary','secondary','emergency','view_only'));
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_relationship_type_bounded"
  CHECK ("intendedRelationshipType" IN ('parent','legal_guardian','trusted_adult','safety_professional'));
-- Terminal-timestamp consistency: each terminal timestamp implies the matching status (and vice versa).
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_terminal_ts_consistent"
  CHECK (
    (("status" = 'accepted') = ("acceptedAt" IS NOT NULL)) AND
    (("status" = 'declined') = ("declinedAt" IS NOT NULL)) AND
    (("status" = 'revoked')  = ("revokedAt"  IS NOT NULL))
  );

-- Indexes.
CREATE UNIQUE INDEX "family_guardian_invitations_tokenHash_key" ON "family_guardian_invitations"("tokenHash");
CREATE UNIQUE INDEX "family_guardian_invitations_id_tenantId_key" ON "family_guardian_invitations"("id", "tenantId");
CREATE INDEX "fgi_tenantId_status_idx" ON "family_guardian_invitations"("tenantId", "status");
CREATE INDEX "fgi_tenantId_protectedProfileId_idx" ON "family_guardian_invitations"("tenantId", "protectedProfileId");
CREATE INDEX "fgi_tenantId_email_status_idx" ON "family_guardian_invitations"("tenantId", "invitedEmailNormalized", "status");
CREATE INDEX "fgi_expiresAt_idx" ON "family_guardian_invitations"("expiresAt");
-- At most ONE PENDING invitation per (tenant, profile, invited email). A terminal state frees it.
CREATE UNIQUE INDEX "fgi_one_pending_per_profile_email"
  ON "family_guardian_invitations"("tenantId", "protectedProfileId", "invitedEmailNormalized")
  WHERE "status" = 'pending';

-- Foreign keys — tenant + same-tenant composite FKs (cross-tenant linking impossible at the DB level).
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "family_guardian_invitations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_protectedProfileId_tenantId_fkey"
  FOREIGN KEY ("protectedProfileId", "tenantId") REFERENCES "protected_profiles"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_invitedByMembershipId_tenantId_fkey"
  FOREIGN KEY ("invitedByMembershipId", "tenantId") REFERENCES "memberships"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_guardian_invitations" ADD CONSTRAINT "fgi_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GRANTs — app role may read/append/soft-update (accept/decline/revoke/expire) but NEVER hard-delete.
GRANT SELECT, INSERT, UPDATE ON "family_guardian_invitations" TO tamanor_app;
REVOKE DELETE, TRUNCATE ON "family_guardian_invitations" FROM tamanor_app;

-- Row-Level Security — strict tenant_isolation (ENABLE + FORCE), the existing repository pattern.
DO $cs_c8$
BEGIN
  EXECUTE 'ALTER TABLE "family_guardian_invitations" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "family_guardian_invitations" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "family_guardian_invitations"';
  EXECUTE 'CREATE POLICY tenant_isolation ON "family_guardian_invitations"
    USING ("tenantId" = current_app_tenant_id())
    WITH CHECK ("tenantId" = current_app_tenant_id())';
END $cs_c8$;
