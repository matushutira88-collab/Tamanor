/**
 * INCIDENT-01 — strict local-target preflight.
 *
 * Chained before local dev / test / seed / destructive DB commands. Unlike
 * `assert-local-db.cli.ts` (host-only, with a TAMANOR_ALLOW_REMOTE_DB escape hatch), this
 * check pins host AND port AND database, and has NO override: these commands have no
 * legitimate reason to touch anything but the local development database.
 *
 * Prints the sanitized target (never the user or password) and exits 1 before any Prisma
 * client is constructed, so a wrong target cannot reach a connection.
 */
import { assertLocalTarget } from "./assert-local-db";

try {
  const t = assertLocalTarget();
  console.log(`✓ local DB target: ${t.host}:${t.port}/${t.database}`);
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
}
