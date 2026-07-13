/**
 * V1.42 — inbox action-engine truth (provider-neutral, server-enforceable). Proves the bulk
 * allowlist excludes provider writes + notes, and that provider-write gating is capability +
 * health honest (Google reviews never get a write action; Tamanor never replies).
 *
 * Run: pnpm inbox-engine:test
 */
import { isInboxBulkAllowed, assertProviderWriteAllowed, INBOX_BULK_ALLOWED, PROVIDER_WRITE_ACTIONS } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

function run() {
  check("1) bulk allowlist is internal-only (no provider writes, no notes)", INBOX_BULK_ALLOWED.every((a) => !(PROVIDER_WRITE_ACTIONS as readonly string[]).includes(a)) && !(INBOX_BULK_ALLOWED as readonly string[]).includes("add_note"));
  check("2) internal actions are bulk-eligible; provider writes + notes are not", isInboxBulkAllowed("mark_read") && isInboxBulkAllowed("archive") && isInboxBulkAllowed("assign") && !isInboxBulkAllowed("hide") && !isInboxBulkAllowed("delete") && !isInboxBulkAllowed("add_note"));
  check("3) Facebook hide allowed only when connector healthy", assertProviderWriteAllowed("hide", "facebook", { connectorHealthy: true }) === true && assertProviderWriteAllowed("hide", "facebook", { connectorHealthy: false }) === false);
  check("4) Google Business review has NO provider write action", assertProviderWriteAllowed("hide", "google_business") === false && assertProviderWriteAllowed("reply", "google_business") === false && assertProviderWriteAllowed("delete", "google_business") === false);
  check("5) Tamanor never replies/deletes/bans on any provider (capability honest)", assertProviderWriteAllowed("reply", "facebook") === false && assertProviderWriteAllowed("delete", "facebook") === false && assertProviderWriteAllowed("ban", "facebook") === false);
  check("6) a non-write action is never treated as a provider write", assertProviderWriteAllowed("mark_read" as never, "facebook") === false && assertProviderWriteAllowed("archive" as never, "instagram") === false);
  check("7) Instagram has no live write action (read-only today)", assertProviderWriteAllowed("hide", "instagram", { connectorHealthy: true }) === false);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — inbox action engine (V1.42)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
