/**
 * GENERIC production migration safety helpers — for the standalone `production-prisma-migrate` workflow that
 * applies accepted Prisma migrations via `prisma migrate deploy` ONLY. This is DISTINCT from the family-
 * specific `production-database-migrate` workflow (which is pinned to one reconcile migration with family-
 * count preservation). Pure functions here are unit-tested; the CLIs add the DB I/O.
 *
 * Never prints the DATABASE_URL. No migrate dev / reset / db push / ad-hoc SQL is ever performed.
 */
import { systemDb } from "../src/index";
import { MIGRATION_CONFIRMATION_PHRASE, ACCEPTED_ENVIRONMENT } from "./family-activation";

export { MIGRATION_CONFIRMATION_PHRASE, ACCEPTED_ENVIRONMENT };

const MIGRATION_NAME_RE = /^[0-9]{14}_[a-z0-9_]+$/;

export type BacklogInputs = { environment?: string; expectedLast?: string; confirmation?: string };
/** Validate the three arming inputs. `expected_last_migration` must be a well-formed migration name. */
export function validateBacklogInputs(input: BacklogInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.environment !== ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${ACCEPTED_ENVIRONMENT}"`);
  if (input.confirmation !== MIGRATION_CONFIRMATION_PHRASE) errors.push("confirmation must exactly equal the required phrase");
  if (!input.expectedLast || !MIGRATION_NAME_RE.test(input.expectedLast)) errors.push("expected_last_migration must be a valid migration name (14-digit prefix)");
  return { ok: errors.length === 0, errors };
}

/**
 * Fail-closed evaluation of a pending-migration backlog before `prisma migrate deploy`. Refuses on: any
 * failed/in-progress migration, an expected_last that is not the newest repo migration, a pending migration
 * not present in the repo, or a pending set that does not end exactly at expected_last. An already-up-to-date
 * DB (no pending) is accepted ONLY when expected_last is already applied (idempotent no-op).
 */
export function evaluateMigrationBacklog(input: { repoMigrations: string[]; pending: string[]; failed: string[]; applied: string[]; expectedLast: string }): { ok: boolean; errors: string[]; pending: string[] } {
  const errors: string[] = [];
  const repo = [...input.repoMigrations].filter((m) => MIGRATION_NAME_RE.test(m)).sort();
  const pending = [...input.pending].sort();
  const newest = repo[repo.length - 1];

  if (input.failed.length) errors.push(`failed / in-progress migration(s) present — recover manually (no reset): ${input.failed.join(", ")}`);
  if (!repo.includes(input.expectedLast)) errors.push(`expected_last_migration "${input.expectedLast}" is not a known repo migration`);
  else if (newest !== input.expectedLast) errors.push(`expected_last_migration "${input.expectedLast}" is not the NEWEST repo migration ("${newest}")`);

  for (const p of pending) if (!repo.includes(p)) errors.push(`pending migration "${p}" is not present in the repo — refusing`);

  if (pending.length === 0) {
    if (!input.applied.includes(input.expectedLast)) errors.push("no pending migrations, but expected_last_migration is NOT applied — inconsistent state");
    // else: already up to date (idempotent no-op) — OK.
  } else if (pending[pending.length - 1] !== input.expectedLast) {
    errors.push(`the last pending migration ("${pending[pending.length - 1]}") is not expected_last_migration ("${input.expectedLast}")`);
  }
  return { ok: errors.length === 0, errors, pending };
}

/**
 * Migrations in a BLOCKING failed state — a row that STARTED but never finished and was not rolled back
 * (`finished_at IS NULL AND rolled_back_at IS NULL`). `prisma migrate deploy` refuses to proceed past exactly
 * these. A migration explicitly marked rolled back (`rolled_back_at` set) is deliberately EXCLUDED: deploy
 * re-applies rolled-back migrations, so a recovered-and-reapplied migration must not look failed forever.
 */
export async function failedMigrationNames(): Promise<string[]> {
  const rows = await systemDb.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}
