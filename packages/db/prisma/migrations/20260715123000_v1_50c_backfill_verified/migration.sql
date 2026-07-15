-- V1.50C — grandfather EXISTING users as verified. Email verification is brand-new, so every
-- account that already existed at deploy time predates it and must not be locked out of the
-- dashboard. New accounts created AFTER this migration start unverified (column default NULL).
-- Idempotent: only touches rows still NULL at migration time.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
