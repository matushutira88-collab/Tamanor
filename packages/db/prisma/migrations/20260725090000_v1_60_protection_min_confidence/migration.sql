-- V1.60 — per-account minimum classifier confidence to auto-execute a hide. ADDITIVE and safe:
-- default 0.8 == the server floor (AUTO_HIDE_MIN_CONFIDENCE). No existing account changes behaviour;
-- the gate applies max(this, per-category minConfidence, 0.8), so a stored value can never weaken it.
ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "autoHideMinConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
