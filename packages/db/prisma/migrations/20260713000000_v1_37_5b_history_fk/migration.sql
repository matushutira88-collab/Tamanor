-- V1.37.5B — history-group referential integrity. Additive; no data loss; no reset.
-- PlatformActionExecution.{itemId,queueItemId} and ProviderCall.itemId become real
-- nullable FKs with ON DELETE SET NULL (history is RETAINED after the parent is
-- deleted). Cross-tenant is DB-enforced by a BEFORE trigger (a composite FK + SET NULL
-- would null the tenantId column that RLS depends on).

-- 1) CLEANUP (fail-closed): NULL any invalid / cross-tenant reference (audit: 0 today).
UPDATE "platform_action_executions" a SET "itemId" = NULL
  WHERE a."itemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");
UPDATE "platform_action_executions" a SET "queueItemId" = NULL
  WHERE a."queueItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "action_queue_items" q WHERE q."id" = a."queueItemId" AND q."tenantId" = a."tenantId");
UPDATE "provider_calls" a SET "itemId" = NULL
  WHERE a."itemId" IS NOT NULL AND a."tenantId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "reputation_items" r WHERE r."id" = a."itemId" AND r."tenantId" = a."tenantId");

-- 2) SIMPLE nullable FKs with ON DELETE SET NULL (keeps the history row).
DO $sn$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_action_executions_itemId_fkey') THEN
    ALTER TABLE "platform_action_executions" ADD CONSTRAINT "platform_action_executions_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "reputation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_action_executions_queueItemId_fkey') THEN
    ALTER TABLE "platform_action_executions" ADD CONSTRAINT "platform_action_executions_queueItemId_fkey"
      FOREIGN KEY ("queueItemId") REFERENCES "action_queue_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_calls_itemId_fkey') THEN
    ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "reputation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $sn$;

-- 3) CROSS-TENANT TRIGGERS. On INSERT/UPDATE, verify the stored child.tenantId equals
--    the parent's tenantId — protects the RUNTIME (RLS) AND the owner/system path (the
--    WHERE tenantId = NEW.tenantId does NOT rely on RLS visibility). Fires only when the
--    reference is non-null, so a SET-NULL on parent delete never trips it.
CREATE OR REPLACE FUNCTION assert_pae_tenant_match() RETURNS trigger AS $$
BEGIN
  IF NEW."itemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "reputation_items" r WHERE r."id" = NEW."itemId" AND r."tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'cross_tenant_or_missing_reputation_item' USING ERRCODE = '23503';
  END IF;
  IF NEW."queueItemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "action_queue_items" q WHERE q."id" = NEW."queueItemId" AND q."tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'cross_tenant_or_missing_queue_item' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pae_tenant_match ON "platform_action_executions";
CREATE TRIGGER trg_pae_tenant_match BEFORE INSERT OR UPDATE ON "platform_action_executions"
  FOR EACH ROW EXECUTE FUNCTION assert_pae_tenant_match();

CREATE OR REPLACE FUNCTION assert_provider_call_tenant_match() RETURNS trigger AS $$
BEGIN
  IF NEW."itemId" IS NOT NULL AND NEW."tenantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "reputation_items" r WHERE r."id" = NEW."itemId" AND r."tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'cross_tenant_or_missing_reputation_item' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_provider_call_tenant_match ON "provider_calls";
CREATE TRIGGER trg_provider_call_tenant_match BEFORE INSERT OR UPDATE ON "provider_calls"
  FOR EACH ROW EXECUTE FUNCTION assert_provider_call_tenant_match();

-- 4) Indexes for FK lookup / delete performance (created in V1.37.5; ensure present).
CREATE INDEX IF NOT EXISTS "platform_action_executions_queueItemId_idx" ON "platform_action_executions"("queueItemId");
CREATE INDEX IF NOT EXISTS "provider_calls_itemId_idx" ON "provider_calls"("itemId");
