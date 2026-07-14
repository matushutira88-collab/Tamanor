-- V1.45A — global platform-administration role (ADDITIVE ONLY; no reset, no history edit).
-- Independent of the tenant `Role`. Default is least-privilege `none`, so EVERY existing and future
-- user has ZERO platform access unless explicitly assigned by the operational bootstrap tool. This
-- migration grants platform access to NO ONE.

DO $$ BEGIN
  CREATE TYPE "PlatformRole" AS ENUM ('none', 'staff', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- NOT NULL DEFAULT 'none' backfills every existing row to least-privilege.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platformRole" "PlatformRole" NOT NULL DEFAULT 'none';
