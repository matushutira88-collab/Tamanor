/**
 * V1.70 (Release B / B2) — PURE tests for notification domain logic (no DB): default severity, the
 * email-critical set, sync-failure email threshold (aggregation), deterministic dedupe keys, and metadata
 * sanitization (no tokens/payloads ever). Run: pnpm notifications:test
 */
import {
  NOTIFICATION_TYPES, DEFAULT_NOTIFICATION_SEVERITY, EMAIL_CRITICAL_TYPES, isEmailCriticalType,
  syncFailureWarrantsEmail, SYNC_FAILURE_EMAIL_THRESHOLD, notificationDedupeKey, dayBucket, sanitizeNotificationMetadata,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

function run() {
  check("all 8 types have a default severity", NOTIFICATION_TYPES.every((t) => !!DEFAULT_NOTIFICATION_SEVERITY[t]) && NOTIFICATION_TYPES.length === 8);
  check("critical severities: trial_expired + payment_failed", DEFAULT_NOTIFICATION_SEVERITY.trial_expired === "critical" && DEFAULT_NOTIFICATION_SEVERITY.payment_failed === "critical");

  // email-critical-only
  check("email-critical set = payment_failed, trial_expired, account_reconnect_required",
    [...EMAIL_CRITICAL_TYPES].sort().join(",") === "account_reconnect_required,payment_failed,trial_expired");
  check("risk_comment_detected is NOT email-critical (no email per comment)", !isEmailCriticalType("risk_comment_detected"));
  check("first_sync_completed is NOT email-critical", !isEmailCriticalType("first_sync_completed"));

  // sync-failure aggregation threshold
  check(`sync failure emails only at ≥ threshold (${SYNC_FAILURE_EMAIL_THRESHOLD})`,
    !syncFailureWarrantsEmail(1) && !syncFailureWarrantsEmail(2) && syncFailureWarrantsEmail(3) && syncFailureWarrantsEmail(9));

  // dedupe keys
  check("dedupe key is deterministic + parts-sensitive",
    notificationDedupeKey("sync_failed", "acct1", "2026-07-20") === "sync_failed:acct1:2026-07-20" &&
    notificationDedupeKey("sync_failed", "acct1", "2026-07-20") === notificationDedupeKey("sync_failed", "acct1", "2026-07-20") &&
    notificationDedupeKey("sync_failed", "acct1", "2026-07-21") !== notificationDedupeKey("sync_failed", "acct1", "2026-07-20"));
  check("dayBucket is a UTC YYYY-MM-DD", dayBucket(new Date("2026-07-20T23:59:00.000Z")) === "2026-07-20");

  // sanitization
  const s = sanitizeNotificationMetadata({ accountName: "Page X", accessToken: "eyJx", refresh_token: "r", apiKey: "k", authorization: "Bearer z", nested: { a: 1 }, arr: [1, 2], count: 3, ok: true, big: "y".repeat(600) });
  check("sanitize drops secret-named keys (token/apiKey/authorization/refresh_token)", !("accessToken" in s) && !("refresh_token" in s) && !("apiKey" in s) && !("authorization" in s));
  check("sanitize drops nested objects/arrays and oversized strings", !("nested" in s) && !("arr" in s) && !("big" in s));
  check("sanitize keeps safe scalars", s.accountName === "Page X" && s.count === 3 && s.ok === true);
  check("sanitized output serializes with no token/secret substrings", !/token|secret|bearer|api[_-]?key|eyJ/i.test(JSON.stringify(s)));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — notification domain (V1.70 B2): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
