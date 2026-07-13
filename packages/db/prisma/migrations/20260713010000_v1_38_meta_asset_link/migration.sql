-- V1.38 — unified Meta connector: persist the canonical Facebook Page ↔ Instagram
-- account relationship. Additive; no data loss; no reset. Idempotent.

-- 1) Self-reference column (IG account → its parent Page account).
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "parentAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "connected_accounts_parentAccountId_idx" ON "connected_accounts"("parentAccountId");

-- 2) FK ON DELETE SET NULL (child survives if the parent Page row is removed).
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connected_accounts_parentAccountId_fkey') THEN
    ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_parentAccountId_fkey"
      FOREIGN KEY ("parentAccountId") REFERENCES "connected_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- 3) Cross-tenant trigger: a child may only link a parent in the SAME tenant. Checks
--    the stored tenantId (not RLS visibility) → protects runtime AND owner/system.
--    Fires only when parentAccountId is non-null, so a SetNull on delete never trips it.
CREATE OR REPLACE FUNCTION assert_connected_account_parent_tenant_match() RETURNS trigger AS $$
BEGIN
  IF NEW."parentAccountId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "connected_accounts" p WHERE p."id" = NEW."parentAccountId" AND p."tenantId" = NEW."tenantId") THEN
    RAISE EXCEPTION 'cross_tenant_or_missing_parent_account' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_connected_account_parent_tenant_match ON "connected_accounts";
CREATE TRIGGER trg_connected_account_parent_tenant_match BEFORE INSERT OR UPDATE ON "connected_accounts"
  FOR EACH ROW EXECUTE FUNCTION assert_connected_account_parent_tenant_match();
