-- CS-C0 — Workspace separation foundation. Adds an IMMUTABLE `workspaceKind` to every
-- tenant. Backward-compatible: the DEFAULT is 'business', so every EXISTING tenant is a
-- BUSINESS workspace with NO behavior change (dashboard, Meta connections, incidents,
-- cyberbullying, compliance, billing, roles, entitlements, navigation all unchanged).
-- The column is NOT NULL via its default. No new tables, no data rewrite, no billing
-- change. RLS on `tenants` is unaffected. Works on an existing AND a fresh local DB.
ALTER TABLE "tenants" ADD COLUMN "workspaceKind" TEXT NOT NULL DEFAULT 'business';
