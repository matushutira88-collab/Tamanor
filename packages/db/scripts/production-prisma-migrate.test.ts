/**
 * Unit tests for the GENERIC production-migration safety helpers (pure; no DB). Proves the fail-closed backlog
 * evaluation: refuses failed migrations, expected_last mismatch, non-repo pending, and non-contiguous backlogs,
 * and accepts a contiguous backlog ending exactly at expected_last (or an idempotent already-applied no-op).
 * Run: pnpm production-prisma-migrate:test
 */
import { validateBacklogInputs, evaluateMigrationBacklog, MIGRATION_CONFIRMATION_PHRASE } from "./production-prisma-migrate";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const REPO = ["20260810000000_a", "20260811000000_b", "20260812000000_c", "20260824090000_platform_admin_privacy_analytics"];
const LAST = "20260824090000_platform_admin_privacy_analytics";

function main() {
  console.log("\n1. input validation");
  check("★ valid inputs ok", validateBacklogInputs({ environment: "production", expectedLast: LAST, confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);
  check("★ wrong environment rejected", !validateBacklogInputs({ environment: "staging", expectedLast: LAST, confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);
  check("★ wrong confirmation rejected", !validateBacklogInputs({ environment: "production", expectedLast: LAST, confirmation: "nope" }).ok);
  check("★ malformed expected_last rejected", !validateBacklogInputs({ environment: "production", expectedLast: "not-a-migration", confirmation: MIGRATION_CONFIRMATION_PHRASE }).ok);

  console.log("\n2. backlog evaluation");
  const base = { repoMigrations: REPO, applied: ["20260810000000_a", "20260811000000_b"], failed: [] as string[] };
  check("★ contiguous backlog ending at expected_last → OK", evaluateMigrationBacklog({ ...base, pending: ["20260812000000_c", LAST], expectedLast: LAST }).ok);
  check("★ FAILED/in-progress migration → REFUSE", !evaluateMigrationBacklog({ ...base, pending: [LAST], failed: ["20260812000000_c"], expectedLast: LAST }).ok);
  check("★ expected_last not the NEWEST repo migration → REFUSE", !evaluateMigrationBacklog({ ...base, pending: ["20260812000000_c"], expectedLast: "20260812000000_c" }).ok);
  check("★ expected_last not in repo → REFUSE", !evaluateMigrationBacklog({ ...base, pending: [LAST], expectedLast: "20261231000000_ghost" }).ok);
  check("★ pending migration not in repo → REFUSE", !evaluateMigrationBacklog({ ...base, pending: ["20260899000000_alien", LAST], expectedLast: LAST }).ok);
  check("★ last pending != expected_last → REFUSE", !evaluateMigrationBacklog({ ...base, pending: ["20260812000000_c"], expectedLast: LAST }).ok);

  console.log("\n3. idempotency");
  check("★ no pending + expected_last already applied → OK (idempotent no-op)", evaluateMigrationBacklog({ repoMigrations: REPO, applied: [...REPO], failed: [], pending: [], expectedLast: LAST }).ok);
  check("★ no pending + expected_last NOT applied → REFUSE (inconsistent)", !evaluateMigrationBacklog({ repoMigrations: REPO, applied: ["20260810000000_a"], failed: [], pending: [], expectedLast: LAST }).ok);

  console.log("\n4. confirmation phrase is the required one");
  check("★ confirmation phrase == APPLY_ACCEPTED_PRODUCTION_MIGRATIONS", MIGRATION_CONFIRMATION_PHRASE === "APPLY_ACCEPTED_PRODUCTION_MIGRATIONS");
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — production-prisma-migrate helpers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
