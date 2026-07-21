/**
 * V1.70 (Release B / B2) — pure notification domain logic (no DB). Severity defaults, the email-critical
 * set, deterministic dedupe keys (recurrence granularity is encoded by the caller — e.g. a day bucket, so
 * a repeating sync cycle can't spam), and metadata sanitization (a notification NEVER carries tokens,
 * secrets or provider payloads). The DB repository + RLS enforce tenant isolation on top of this.
 */

export type NotificationType =
  | "first_sync_completed" | "sync_failed" | "risk_comment_detected" | "monitoring_disabled_by_plan"
  | "trial_ending" | "trial_expired" | "payment_failed" | "account_reconnect_required";

export type NotificationSeverity = "info" | "warning" | "critical";

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "first_sync_completed", "sync_failed", "risk_comment_detected", "monitoring_disabled_by_plan",
  "trial_ending", "trial_expired", "payment_failed", "account_reconnect_required",
];

export const DEFAULT_NOTIFICATION_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  first_sync_completed: "info",
  sync_failed: "warning",
  risk_comment_detected: "warning",
  monitoring_disabled_by_plan: "warning",
  trial_ending: "warning",
  trial_expired: "critical",
  payment_failed: "critical",
  account_reconnect_required: "warning",
};

/**
 * Types that warrant an email — CRITICAL events only. A repeated sync failure is escalated to email by
 * the caller (once a failure-count threshold is crossed), not on the first failure and never per cycle.
 */
export const EMAIL_CRITICAL_TYPES: readonly NotificationType[] = [
  "payment_failed", "trial_expired", "account_reconnect_required",
];
export function isEmailCriticalType(t: NotificationType): boolean {
  return EMAIL_CRITICAL_TYPES.includes(t);
}

/** Number of consecutive sync failures before a sync_failed notification also emails the tenant. */
export const SYNC_FAILURE_EMAIL_THRESHOLD = 3;
export function syncFailureWarrantsEmail(consecutiveFailures: number): boolean {
  return consecutiveFailures >= SYNC_FAILURE_EMAIL_THRESHOLD;
}

/** Deterministic dedupe key. The caller chooses the parts; a day bucket makes a recurring event fire at
 *  most once per day (anti-spam). The DB enforces one row per (tenantId, dedupeKey). */
export function notificationDedupeKey(type: NotificationType, ...parts: Array<string | number | null | undefined>): string {
  return [type, ...parts.map((p) => (p == null ? "" : String(p)))].join(":");
}

/** UTC day bucket (YYYY-MM-DD) — a coarse dedupe window for recurring notifications. */
export function dayBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const SECRET_KEY = /token|secret|password|refresh|authorization|cookie|api[_-]?key|bearer|credential|signature/i;

/**
 * Sanitize notification metadata: drop secret-named keys, drop nested objects/arrays (which could hide a
 * provider payload), and drop oversized strings. Keeps only flat scalar fields. This is the last line of
 * defence so a notification can never leak a token or a raw provider payload.
 */
export function sanitizeNotificationMetadata(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === "string") { if (v.length <= 500) out[k] = v; continue; }
    if (typeof v === "number" || typeof v === "boolean" || v === null) { out[k] = v; continue; }
    // objects/arrays intentionally dropped — metadata must stay flat + safe.
  }
  return out;
}
