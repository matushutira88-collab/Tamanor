/**
 * CLI runner for the local-DB safety guard. Chained before every mutating DB
 * command in package.json (migrate / migrate:deploy / seed / push). Exits
 * non-zero with a clear message when the resolved DATABASE_URL/APP_DATABASE_URL
 * point at a remote host without an explicit TAMANOR_ALLOW_REMOTE_DB=1 override.
 */
import { assertLocalDb } from "./assert-local-db";

try {
  assertLocalDb();
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
}
