-- V1.27C Persistent Connection Manager — token/connection health fields.
ALTER TABLE "connected_accounts"
  ADD COLUMN IF NOT EXISTS "connectionStatus" TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS "tokenHealth" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "lastTokenCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastTokenCheckResult" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSuccessfulGraphCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastReconnectAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastPermissionCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "requiresReconnectReason" TEXT;
