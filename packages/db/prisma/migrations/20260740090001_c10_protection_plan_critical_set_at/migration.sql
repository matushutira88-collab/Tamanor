-- C10 — add the critical-risk-response SLA start timestamp to the C9 protection plan.
-- Additive, nullable; no existing plan is changed. Set when the MANUAL risk level
-- becomes CRITICAL and cleared when it leaves CRITICAL (never automatic).
ALTER TABLE "cyberbullying_protection_plans" ADD COLUMN "criticalRiskSetAt" TIMESTAMP(3);
