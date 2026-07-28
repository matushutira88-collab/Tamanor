/**
 * Align PREFLIGHT (read-only, no DB). Validates the arming inputs, asserts a real production owner target, and
 * confirms BOTH DATABASE_URL and APP_DATABASE_URL are present, target DIFFERENT roles (app = tamanor_app),
 * resolve to the SAME production host (and match the expected fingerprint when provided), and that
 * APP_DATABASE_URL carries a parseable password — BEFORE any ALTER ROLE runs. Prints only NON-sensitive facts
 * (role names, host fingerprint). Never a URL / password. A non-zero exit aborts the workflow.
 *
 * Env (never printed): DATABASE_URL, APP_DATABASE_URL, MIGRATE_ENVIRONMENT, ALIGN_TARGET_ROLE, ALIGN_CONFIRMATION,
 * PRODUCTION_DATABASE_HOST_FINGERPRINT (optional).
 */
import { assertProductionTarget } from "./family-activation";
import { validateAlignInputs, evaluateAlignTargets } from "./production-app-role-align";

function main() {
  const env = process.env;
  const inputs = validateAlignInputs({ environment: env.MIGRATE_ENVIRONMENT, targetRole: env.ALIGN_TARGET_ROLE, confirmation: env.ALIGN_CONFIRMATION });
  const ownerTarget = assertProductionTarget({ url: env.DATABASE_URL, environment: env.MIGRATE_ENVIRONMENT, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const targets = evaluateAlignTargets({ ownerUrl: env.DATABASE_URL, appUrl: env.APP_DATABASE_URL, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const errors = [...inputs.errors, ...ownerTarget.errors, ...targets.errors];

  console.log(JSON.stringify({
    targetRole: env.ALIGN_TARGET_ROLE,
    ownerRole: targets.ownerRole,
    appRole: targets.appRole,
    rolesDiffer: targets.ownerRole !== null && targets.appRole !== null && targets.ownerRole !== targets.appRole,
    fingerprint: targets.fingerprint,
  }, null, 2));

  if (errors.length) {
    console.error("✗ HARD STOP — refusing to align:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ Preflight passed — owner + tamanor_app targets valid, same production host, password present.");
  process.exit(0);
}

main();
