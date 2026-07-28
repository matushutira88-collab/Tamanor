/**
 * FAMILY NOTIFICATION CENTER V1 — PURE catalogue (no DB, no Stripe, no child-safety data). This is the single
 * bounded source of truth for Family notification TYPES: severity, safe title/message keys, allowed entity type,
 * a SAFE CTA route (never carrying an entity id / query param), deterministic dedupe-key format, the recipient
 * AUTHORIZATION rule the resolver must satisfy at creation time, and whether dismissal is allowed.
 *
 * Privacy: a Family notification NEVER carries raw content, names, ages, emails, tokens, notes, narratives, or
 * free text. Only bounded operational metadata (identifiers for re-authorization + a safe route) is stored.
 * Every consumer (creation, resolver, UI) reads from THIS catalogue — there is no generic free-text type.
 */
import type { NotificationSeverity } from "./notifications";

// ── Types ──────────────────────────────────────────────────────────────────────
export type FamilyNotificationType =
  | "family_signal_available" | "family_urgent_signal"
  | "family_incident_created" | "family_incident_escalated"
  | "family_delivery_available" | "family_delivery_acknowledged" | "family_delivery_declined"
  | "family_guardian_invitation_accepted" | "family_guardian_invitation_expiring"
  | "family_authority_changed" | "family_consent_expiring"
  | "family_recipient_authorization_changed" | "family_protection_plan_updated";

export const FAMILY_NOTIFICATION_TYPES: readonly FamilyNotificationType[] = [
  "family_signal_available", "family_urgent_signal",
  "family_incident_created", "family_incident_escalated",
  "family_delivery_available", "family_delivery_acknowledged", "family_delivery_declined",
  "family_guardian_invitation_accepted", "family_guardian_invitation_expiring",
  "family_authority_changed", "family_consent_expiring",
  "family_recipient_authorization_changed", "family_protection_plan_updated",
];

/** Family-facing severity (distinct from the DB info|warning|critical enum). */
export type FamilyNotificationSeverity = "info" | "attention" | "urgent";

/** The bounded set of entity types a Family notification may reference (for re-authorization + routing). */
export type FamilyNotificationEntityType =
  | "signal" | "incident" | "delivery" | "invitation" | "authority" | "consent"
  | "recipient_authorization" | "protection_plan";

/**
 * The recipient AUTHORIZATION rule the canonical resolver must satisfy at CREATE time. This is the pure
 * REQUIREMENT; the DB resolver evaluates the full child-safety chain. "all tenant members" is deliberately NOT
 * a rule — membership alone is never sufficient for protected safety information.
 */
export type FamilyRecipientRule =
  | "cs_authorized_recipient"        // full child-safety authorization chain (signals/incidents)
  | "delivery_recipient"            // ONLY the authorized delivery recipient
  | "family_manager"                // permitted Family administrators/managers
  | "inviter_plus_admins"           // the inviter + permitted Family admins
  | "affected_guardian_plus_managers" // the affected guardian + authorized Family managers
  | "protection_plan_viewer";       // only users permitted to see that protection plan

export interface FamilyNotificationSpec {
  type: FamilyNotificationType;
  severity: FamilyNotificationSeverity;
  titleKey: string;
  messageKey: string;
  entityType: FamilyNotificationEntityType;
  /** The Family page the CTA routes to. NEVER carries an entity id or query param (the page re-authorizes). */
  ctaRoute: string;
  recipientRule: FamilyRecipientRule;
  /** Whether the UI may dismiss it. Dismissal is ALWAYS a soft hide — the audit record is retained regardless. */
  dismissible: boolean;
}

const K = (t: FamilyNotificationType, part: "title" | "body") => `family_notif.${t}.${part}`;

export const FAMILY_NOTIFICATION_CATALOGUE: Record<FamilyNotificationType, FamilyNotificationSpec> = {
  family_signal_available:              { type: "family_signal_available",              severity: "attention", entityType: "signal",                  ctaRoute: "/family/signals",        recipientRule: "cs_authorized_recipient",        dismissible: true,  titleKey: K("family_signal_available", "title"),              messageKey: K("family_signal_available", "body") },
  family_urgent_signal:                 { type: "family_urgent_signal",                 severity: "urgent",    entityType: "signal",                  ctaRoute: "/family/signals",        recipientRule: "cs_authorized_recipient",        dismissible: false, titleKey: K("family_urgent_signal", "title"),                 messageKey: K("family_urgent_signal", "body") },
  family_incident_created:              { type: "family_incident_created",              severity: "urgent",    entityType: "incident",                ctaRoute: "/family/signals",        recipientRule: "cs_authorized_recipient",        dismissible: false, titleKey: K("family_incident_created", "title"),              messageKey: K("family_incident_created", "body") },
  family_incident_escalated:            { type: "family_incident_escalated",            severity: "urgent",    entityType: "incident",                ctaRoute: "/family/signals",        recipientRule: "cs_authorized_recipient",        dismissible: false, titleKey: K("family_incident_escalated", "title"),            messageKey: K("family_incident_escalated", "body") },
  family_delivery_available:            { type: "family_delivery_available",            severity: "attention", entityType: "delivery",                ctaRoute: "/family/deliveries",     recipientRule: "delivery_recipient",             dismissible: false, titleKey: K("family_delivery_available", "title"),            messageKey: K("family_delivery_available", "body") },
  family_delivery_acknowledged:         { type: "family_delivery_acknowledged",         severity: "info",      entityType: "delivery",                ctaRoute: "/family/deliveries",     recipientRule: "family_manager",                 dismissible: true,  titleKey: K("family_delivery_acknowledged", "title"),         messageKey: K("family_delivery_acknowledged", "body") },
  family_delivery_declined:             { type: "family_delivery_declined",             severity: "attention", entityType: "delivery",                ctaRoute: "/family/deliveries",     recipientRule: "family_manager",                 dismissible: true,  titleKey: K("family_delivery_declined", "title"),             messageKey: K("family_delivery_declined", "body") },
  family_guardian_invitation_accepted:  { type: "family_guardian_invitation_accepted",  severity: "info",      entityType: "invitation",              ctaRoute: "/family/invitations",    recipientRule: "inviter_plus_admins",            dismissible: true,  titleKey: K("family_guardian_invitation_accepted", "title"),  messageKey: K("family_guardian_invitation_accepted", "body") },
  family_guardian_invitation_expiring:  { type: "family_guardian_invitation_expiring",  severity: "attention", entityType: "invitation",              ctaRoute: "/family/invitations",    recipientRule: "inviter_plus_admins",            dismissible: true,  titleKey: K("family_guardian_invitation_expiring", "title"),  messageKey: K("family_guardian_invitation_expiring", "body") },
  family_authority_changed:             { type: "family_authority_changed",             severity: "attention", entityType: "authority",               ctaRoute: "/family/authorizations", recipientRule: "affected_guardian_plus_managers", dismissible: true, titleKey: K("family_authority_changed", "title"),             messageKey: K("family_authority_changed", "body") },
  family_consent_expiring:              { type: "family_consent_expiring",              severity: "attention", entityType: "consent",                 ctaRoute: "/family/authorizations", recipientRule: "family_manager",                 dismissible: true,  titleKey: K("family_consent_expiring", "title"),              messageKey: K("family_consent_expiring", "body") },
  family_recipient_authorization_changed:{ type: "family_recipient_authorization_changed", severity: "attention", entityType: "recipient_authorization", ctaRoute: "/family/authorizations", recipientRule: "affected_guardian_plus_managers", dismissible: true, titleKey: K("family_recipient_authorization_changed", "title"), messageKey: K("family_recipient_authorization_changed", "body") },
  family_protection_plan_updated:       { type: "family_protection_plan_updated",       severity: "attention", entityType: "protection_plan",         ctaRoute: "/family/signals",        recipientRule: "protection_plan_viewer",         dismissible: true,  titleKey: K("family_protection_plan_updated", "title"),       messageKey: K("family_protection_plan_updated", "body") },
};

/** Fail-closed type guard — an unknown string is never a Family notification type. */
export function isFamilyNotificationType(v: unknown): v is FamilyNotificationType {
  return typeof v === "string" && v in FAMILY_NOTIFICATION_CATALOGUE;
}

/** Look up a spec, fail-closed. Throws on an unknown type so a bad type can never silently produce a notification. */
export function familyNotificationSpec(type: string): FamilyNotificationSpec {
  if (!isFamilyNotificationType(type)) throw new Error(`unknown_family_notification_type:${String(type).slice(0, 40)}`);
  return FAMILY_NOTIFICATION_CATALOGUE[type];
}

export function familyNotificationSeverity(type: FamilyNotificationType): FamilyNotificationSeverity {
  return FAMILY_NOTIFICATION_CATALOGUE[type].severity;
}

/** Map the Family severity to the persisted DB NotificationSeverity enum (info|warning|critical). */
export function familyToDbSeverity(sev: FamilyNotificationSeverity): NotificationSeverity {
  return sev === "urgent" ? "critical" : sev === "attention" ? "warning" : "info";
}

/** Safe CTA route for a type — the base Family page, never an entity id or query param. */
export function familyNotificationCta(type: FamilyNotificationType): string {
  return FAMILY_NOTIFICATION_CATALOGUE[type].ctaRoute;
}

export function familyNotificationDismissible(type: FamilyNotificationType): boolean {
  return FAMILY_NOTIFICATION_CATALOGUE[type].dismissible;
}

export function familyRecipientRule(type: FamilyNotificationType): FamilyRecipientRule {
  return FAMILY_NOTIFICATION_CATALOGUE[type].recipientRule;
}

// ── Deterministic, per-recipient dedupe key ─────────────────────────────────────
/**
 * Deterministic dedupe key. Includes the recipient so two authorized recipients each get exactly one; the
 * `version` (a lifecycle/event discriminator) lets a genuinely-new lifecycle event create a new notification
 * while a RETRY of the same event no-ops (the DB enforces one row per (tenantId, dedupeKey)).
 */
export function familyNotificationDedupeKey(input: {
  type: FamilyNotificationType;
  recipientUserId: string;
  entityType: FamilyNotificationEntityType;
  entityId: string;
  version?: string | number | null;
}): string {
  return [input.type, input.recipientUserId, input.entityType, input.entityId, input.version == null ? "" : String(input.version)].join(":");
}

// ── Time-based expiry windows (invitation / consent / authority) ────────────────
/** Notification windows (whole days before expiry). Deterministic; a run fires at most once per (object, window). */
export const FAMILY_EXPIRY_WINDOWS_DAYS: readonly number[] = [7, 1];

/**
 * The COARSEST window an object with `daysRemaining` whole days left falls into, or null when it is outside every
 * window (too far out, or already expired). Deterministic and injected-now friendly. E.g. 7d→7, 3d→1, 1d→1,
 * 0d→null, 8d→null. The window value is part of the dedupe suffix so each window fires at most once.
 */
export function familyExpiryWindow(daysRemaining: number, windows: readonly number[] = FAMILY_EXPIRY_WINDOWS_DAYS): number | null {
  if (!Number.isFinite(daysRemaining) || daysRemaining <= 0) return null;
  const eligible = windows.filter((w) => daysRemaining <= w);
  return eligible.length ? Math.min(...eligible) : null;
}

/** Whole days remaining until `expiresAt` (0 once elapsed); null when there is no expiry. */
export function familyDaysUntil(expiresAt: Date | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

// ── Bounded, privacy-preserving metadata ────────────────────────────────────────
/**
 * The ONLY fields a Family notification may store. Identifiers are for authorization RE-CHECK + navigation; a
 * `safeReasonCode` is a bounded enum-like code (never a note); `safeRoute` is the base CTA. NO names, ages,
 * emails, tokens, notes, narratives, content, or free text.
 */
export interface FamilyNotificationMetadata {
  notificationType: FamilyNotificationType;
  severity: FamilyNotificationSeverity;
  entityType: FamilyNotificationEntityType;
  entityId: string;
  profileId?: string;
  createdAt?: string;      // ISO string (bounded), optional
  safeReasonCode?: string; // bounded code, [a-z0-9_]{1,40}
  safeRoute: string;
}

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;              // cuid/uuid-shaped identifiers only
const REASON_RE = /^[a-z0-9_]{1,40}$/;               // bounded enum-like reason code

/**
 * Build the bounded metadata for a Family notification, FAIL-CLOSED. Rejects (throws) any identifier that is not
 * id-shaped or a reason code that is not a bounded enum-like token, and NEVER copies through an arbitrary field —
 * only the allow-listed keys are ever emitted. This is the last line of defence against a PII/free-text leak.
 */
export function buildFamilyNotificationMetadata(input: {
  type: FamilyNotificationType;
  entityId: string;
  profileId?: string | null;
  createdAt?: Date | null;
  safeReasonCode?: string | null;
}): FamilyNotificationMetadata {
  const spec = familyNotificationSpec(input.type);
  if (!ID_RE.test(input.entityId)) throw new Error("family_notif_metadata:invalid_entity_id");
  if (input.profileId != null && !ID_RE.test(input.profileId)) throw new Error("family_notif_metadata:invalid_profile_id");
  if (input.safeReasonCode != null && !REASON_RE.test(input.safeReasonCode)) throw new Error("family_notif_metadata:invalid_reason_code");
  const meta: FamilyNotificationMetadata = {
    notificationType: spec.type,
    severity: spec.severity,
    entityType: spec.entityType,
    entityId: input.entityId,
    safeRoute: spec.ctaRoute,
  };
  if (input.profileId != null) meta.profileId = input.profileId;
  if (input.createdAt != null) meta.createdAt = input.createdAt.toISOString();
  if (input.safeReasonCode != null) meta.safeReasonCode = input.safeReasonCode;
  return meta;
}

/** The exact allow-listed metadata keys — used by the privacy tests to assert nothing else can appear. */
export const FAMILY_NOTIFICATION_METADATA_KEYS: readonly string[] = [
  "notificationType", "severity", "entityType", "entityId", "profileId", "createdAt", "safeReasonCode", "safeRoute",
];

// ── Unread badge formatting ─────────────────────────────────────────────────────
/** Bounded unread badge text: "" for 0, the number up to 99, "99+" beyond. */
export function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}
