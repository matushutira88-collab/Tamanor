/**
 * Safety helpers for the standalone `production-prisma-migrate-recover` workflow. It recovers a FAILED Prisma
 * migration by marking the failed attempt ROLLED BACK (`prisma migrate resolve --rolled-back`) so a subsequent
 * `prisma migrate deploy` (the production-prisma-migrate workflow) re-applies it cleanly. It NEVER marks a
 * migration applied (that would skip the SQL without verifying DB state) and NEVER resets. Pure functions here
 * are unit-tested; the CLIs add the DB I/O. Never prints DATABASE_URL.
 *
 * Only the `rolled-back` resolution is permitted — safe ONLY for idempotent / transactional migrations whose
 * SQL can be re-run to reach the correct end state.
 */
import { MIGRATION_CONFIRMATION_PHRASE, ACCEPTED_ENVIRONMENT } from "./family-activation";

export { MIGRATION_CONFIRMATION_PHRASE, ACCEPTED_ENVIRONMENT };

/** The ONLY resolution this workflow performs. Marking `--applied` is intentionally unsupported. */
export const RECOVERY_RESOLUTION = "rolled-back";

const MIGRATION_NAME_RE = /^[0-9]{14}_[a-z0-9_]+$/;

export type RecoveryInputs = { environment?: string; targetMigration?: string; resolution?: string; confirmation?: string };
/** Validate the four arming inputs. `failed_migration` must be a well-formed name; only `rolled-back` is allowed. */
export function validateRecoveryInputs(input: RecoveryInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.environment !== ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${ACCEPTED_ENVIRONMENT}"`);
  if (input.confirmation !== MIGRATION_CONFIRMATION_PHRASE) errors.push("confirmation must exactly equal the required phrase");
  if (!input.targetMigration || !MIGRATION_NAME_RE.test(input.targetMigration)) errors.push("failed_migration must be a valid migration name (14-digit prefix)");
  if (input.resolution !== RECOVERY_RESOLUTION) errors.push(`resolution must be "${RECOVERY_RESOLUTION}" (marking a migration applied is not permitted)`);
  return { ok: errors.length === 0, errors };
}

/**
 * Fail-closed pre-check: only recover a migration that is ACTUALLY in a blocking failed state, is NOT already
 * applied, and exists in the repo. Refuses on a wrong/typo'd name, an already-applied migration, or an unknown one.
 */
export function evaluateRecovery(input: { repoMigrations: string[]; failed: string[]; applied: string[]; targetMigration: string }): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.repoMigrations.includes(input.targetMigration)) errors.push(`failed_migration "${input.targetMigration}" is not a known repo migration`);
  if (input.applied.includes(input.targetMigration)) errors.push(`"${input.targetMigration}" is already applied — nothing to recover`);
  if (!input.failed.includes(input.targetMigration)) errors.push(`"${input.targetMigration}" is not in a failed/in-progress state — refusing (nothing to roll back)`);
  return { ok: errors.length === 0, errors };
}

/**
 * Post-recovery check: the target must no longer be blocking-failed, must NOT be applied (rolling back does not
 * apply it), must now be PENDING (ready for the next migrate deploy to re-apply), and no OTHER failed migration
 * may remain.
 */
export function evaluateRecoveryResult(input: { failed: string[]; applied: string[]; pending: string[]; targetMigration: string }): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.failed.includes(input.targetMigration)) errors.push(`"${input.targetMigration}" is STILL in a failed state after resolve`);
  if (input.applied.includes(input.targetMigration)) errors.push(`"${input.targetMigration}" is unexpectedly applied — recovery should leave it PENDING for re-deploy, not applied`);
  if (!input.pending.includes(input.targetMigration)) errors.push(`"${input.targetMigration}" is not pending after resolve — cannot re-deploy`);
  const others = input.failed.filter((f) => f !== input.targetMigration);
  if (others.length) errors.push(`other failed/in-progress migration(s) remain: ${others.join(", ")}`);
  return { ok: errors.length === 0, errors };
}
