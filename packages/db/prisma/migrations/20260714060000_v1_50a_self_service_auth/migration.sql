-- V1.50A — Self-Service Foundation (ADDITIVE ONLY; all new columns are NULLABLE).
--
-- Adds local credential storage (Argon2id PHC string) to users, and the 14-day
-- Free Trial window + optional company country to tenants. No existing row is
-- modified; no NOT NULL is introduced; nothing is dropped. Idempotent for dev re-runs.

-- 1) Local password credential (Argon2id PHC string; NULL for dev/E2E/future-OAuth users).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- 2) Free Trial window + optional country on the tenant (informational; billing is out of scope).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trialStartsAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trialEndsAt"   TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "country"       TEXT;
