/**
 * FAMILY NOTIFICATIONS PHASE 3C — local scheduler command (one bounded cycle).
 *
 * pnpm family-notifications-scheduler:run
 *
 * Asserts a safe local DB target, runs ONE bounded scheduler cycle (lease → evaluate invitations → evaluate
 * consents → drain outbox → release), and prints AGGREGATE counts only — never an id, tenant, recipient, email,
 * or source detail. Exits non-zero on an operational failure. NOT a loop; NO production fallback.
 */
import { assertLocalTarget } from "./assert-local-db";
import { runFamilyNotificationScheduler } from "../src/internal/family-notification-scheduler";

async function main() {
  const t = assertLocalTarget();
  console.log(`✓ local DB target: ${t.host}:${t.port}/${t.database}`);

  const r = await runFamilyNotificationScheduler({});
  console.log(`acquired=${r.acquired}`);
  console.log(`stopped_reason=${r.stoppedReason}`);
  console.log(`invitations_scanned=${r.invitationsScanned}`);
  console.log(`invitations_enqueued=${r.invitationsEnqueued}`);
  console.log(`consents_scanned=${r.consentsScanned}`);
  console.log(`consents_enqueued=${r.consentsEnqueued}`);
  console.log(`outbox_claimed=${r.outboxClaimed}`);
  console.log(`outbox_completed=${r.outboxCompleted}`);
  console.log(`outbox_retried=${r.outboxRetried}`);
  console.log(`outbox_dead_letter=${r.outboxDeadLetter}`);
  console.log(`notifications_created=${r.notificationsCreated}`);
  console.log(`duplicates=${r.duplicates}`);
  console.log(`no_recipients=${r.noRecipients}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`✗ scheduler run failed: ${(err as Error).name}`);
    process.exit(1);
  });
