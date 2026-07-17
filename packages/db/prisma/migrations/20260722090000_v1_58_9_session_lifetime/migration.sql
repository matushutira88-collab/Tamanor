-- V1.58.9 — session lifetime backbone: server-enforced idle + absolute timeouts + remember-me.
-- ADDITIVE + BACKWARD COMPATIBLE — NO session loss, safe during the rollout window:
--   • absoluteExpiresAt is NULLABLE. Existing sessions get NULL ⇒ no extra hard ceiling is imposed;
--     they keep their original `expiresAt` (7-day) lifetime. Only NEW sessions minted by the deployed
--     code carry an absolute ceiling. So no logged-in user is dropped by the migration itself.
--   • rememberMe defaults false. The old code never reads either column, so it keeps working unchanged.
-- No DROP, no data reset, no NOT-NULL without a default. RLS/grants on user_sessions are UNCHANGED
-- (session reads/writes use the owner/systemDb client, not the RLS app role).

ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "absoluteExpiresAt" TIMESTAMP(3);
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "rememberMe" BOOLEAN NOT NULL DEFAULT false;
