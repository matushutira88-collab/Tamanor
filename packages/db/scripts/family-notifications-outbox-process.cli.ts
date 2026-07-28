/**
 * FAMILY NOTIFICATIONS PHASE 3A — outbox maintenance command (local/server, single bounded batch).
 *
 * pnpm family-notifications-outbox:process
 *
 * Asserts a safe local DB target, processes ONE bounded batch, and prints AGGREGATE counts only — never an
 * event id, tenant id, recipient id, or source id. Exits non-zero on a processor-level failure. This is NOT a
 * scheduler: it runs once and returns (Phase 3A ships no cron / production schedule).
 */
import { assertLocalTarget } from "./assert-local-db";
import { processFamilyNotificationOutboxBatch } from "../src/internal/family-notification-outbox-processor";

async function main() {
  // Defence-in-depth: pin host/port/database before any processing (the npm script also chains the preflight).
  const t = assertLocalTarget();
  console.log(`✓ local DB target: ${t.host}:${t.port}/${t.database}`);

  const r = await processFamilyNotificationOutboxBatch({});
  // Aggregate counts ONLY.
  console.log(`claimed=${r.claimed}`);
  console.log(`completed=${r.completed}`);
  console.log(`retried=${r.retried}`);
  console.log(`dead_letter=${r.dead_letter}`);
  console.log(`notifications_created=${r.notifications_created}`);
  console.log(`duplicates=${r.duplicates}`);
  console.log(`no_recipients=${r.no_recipients}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Bounded, id-free failure signal only.
    console.error(`✗ outbox processor failed: ${(err as Error).name}`);
    process.exit(1);
  });
