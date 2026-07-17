-- V1.58.9 phase 2 — a minimized device label for the "Active sessions" UI. ADDITIVE + backward
-- compatible: nullable TEXT, existing rows get NULL (shown as "Unknown device"). No token, no raw IP,
-- no fingerprint is stored — only a coarse user-agent summary set at session creation.
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "userAgentSummary" TEXT;
