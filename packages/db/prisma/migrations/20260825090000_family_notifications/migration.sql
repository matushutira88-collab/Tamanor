-- FAMILY NOTIFICATIONS V1 — additive, forward-only, replay-safe. Extends the existing generic Notification
-- foundation with the 13 bounded Family notification enum values, a soft-dismiss column, and an index for the
-- Family notification-center query. Existing Business rows remain valid (no backfill). RLS is unaffected: the
-- policy is row-level and the app-role table grant already covers the new column. No resets, no destructive
-- enum recreation, no DELETE grant. `IF NOT EXISTS` everywhere makes the migration idempotent on replay.

-- 1) Family notification enum values (must match core FAMILY_NOTIFICATION_TYPES exactly). Postgres allows
--    ADD VALUE inside the migration transaction (PG 12+); the values are only USED by later migrations/runtime.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_signal_available';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_urgent_signal';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_incident_created';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_incident_escalated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_delivery_available';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_delivery_acknowledged';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_delivery_declined';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_guardian_invitation_accepted';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_guardian_invitation_expiring';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_authority_changed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_consent_expiring';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_recipient_authorization_changed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'family_protection_plan_updated';

-- 2) Soft-dismiss column — hide from the recipient's list, NEVER a delete. Independent of readAt. Additive +
--    nullable so existing Business rows stay valid with no backfill; Business never sets it.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);

-- 3) Index for the Family center query (per recipient, non-dismissed, unread/all, newest-first, stable id
--    tie-break). The existing Business indexes are preserved.
CREATE INDEX IF NOT EXISTS "notifications_tenantId_userId_dismissedAt_readAt_createdAt_id_idx"
  ON "notifications" ("tenantId", "userId", "dismissedAt", "readAt", "createdAt", "id");
