/**
 * Tamanor Child Safety — Internal Delivery FOUNDATION (CS-C5).
 *
 * The LAST backend-only foundation before UI. A SafetySignalDelivery is ONLY an INTERNAL record that a
 * minimal, already-authorized safety disclosure is PREPARED for a specific authorized recipient — plus
 * its internal availability state and acknowledgement/decline. It NEVER sends anything: no email/SMS/
 * push/webhook/notification/incident/case/evidence, no platform contact, no raw content.
 *
 * A delivery may exist ONLY for a currently-EFFECTIVE CS-C4 recipient authorization decision — the
 * repository re-checks `getEffectiveRecipientAuthorization` before create and for effectiveness; CS-C5
 * never re-derives the authorization chain itself. Values are TEXT validated here (no DB enum types);
 * the disclosure snapshot is safe enum + bounded scalars only (no JSON / free text).
 *
 * Client-safe subpath: `@guardora/core/child-safety-delivery`.
 */

// --- Channel (INTERNAL ONLY) -------------------------------------------------

/** The ONLY delivery channel in CS-C5. EMAIL/SMS/PUSH/WEBHOOK/MESSENGER/… deliberately do not exist. */
export enum SafetyDeliveryChannel {
  InternalInbox = "internal_inbox",
}
export const ALL_SAFETY_DELIVERY_CHANNELS: readonly SafetyDeliveryChannel[] = Object.values(SafetyDeliveryChannel);
export const isSafetyDeliveryChannel = (x: unknown): x is SafetyDeliveryChannel => (ALL_SAFETY_DELIVERY_CHANNELS as readonly string[]).includes(x as string);

// --- Status + lifecycle ------------------------------------------------------

export enum SafetyDeliveryStatus {
  Prepared = "prepared",
  Available = "available",
  Acknowledged = "acknowledged",
  Declined = "declined",
  Failed = "failed",
  Revoked = "revoked",
  Expired = "expired",
  Superseded = "superseded",
  Archived = "archived",
}
export const ALL_SAFETY_DELIVERY_STATUSES: readonly SafetyDeliveryStatus[] = Object.values(SafetyDeliveryStatus);
export const isSafetyDeliveryStatus = (x: unknown): x is SafetyDeliveryStatus => (ALL_SAFETY_DELIVERY_STATUSES as readonly string[]).includes(x as string);

/** Central explicit transition map. Nothing auto-advances; no scheduler/cron/worker. */
export const SAFETY_DELIVERY_TRANSITIONS: Readonly<Record<SafetyDeliveryStatus, readonly SafetyDeliveryStatus[]>> = {
  [SafetyDeliveryStatus.Prepared]: [SafetyDeliveryStatus.Available, SafetyDeliveryStatus.Failed, SafetyDeliveryStatus.Revoked, SafetyDeliveryStatus.Expired, SafetyDeliveryStatus.Superseded, SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Available]: [SafetyDeliveryStatus.Acknowledged, SafetyDeliveryStatus.Declined, SafetyDeliveryStatus.Revoked, SafetyDeliveryStatus.Expired, SafetyDeliveryStatus.Superseded, SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Acknowledged]: [SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Declined]: [SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Failed]: [SafetyDeliveryStatus.Archived, SafetyDeliveryStatus.Superseded],
  [SafetyDeliveryStatus.Revoked]: [SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Expired]: [SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Superseded]: [SafetyDeliveryStatus.Archived],
  [SafetyDeliveryStatus.Archived]: [],
};
/** True iff `from → to` is an allowed transition. Fail-closed on unknown status. */
export function isValidSafetyDeliveryTransition(from: string, to: string): boolean {
  if (!isSafetyDeliveryStatus(from) || !isSafetyDeliveryStatus(to)) return false;
  return (SAFETY_DELIVERY_TRANSITIONS[from] ?? []).includes(to);
}

// --- Reason codes (allow-listed) --------------------------------------------

export enum SafetyDeliveryReasonCode {
  ValidEffectiveAuthorization = "valid_effective_authorization",
  AuthorizationNotFound = "authorization_not_found",
  AuthorizationNotEffective = "authorization_not_effective",
  AuthorizationRevoked = "authorization_revoked",
  AuthorizationSuperseded = "authorization_superseded",
  AuthorizationExpired = "authorization_expired",
  AuthorizationArchived = "authorization_archived",
  SignalArchived = "signal_archived",
  RecipientInactive = "recipient_inactive",
  RecipientMismatch = "recipient_mismatch",
  TenantMismatch = "tenant_mismatch",
  ProfileMismatch = "profile_mismatch",
  ScopeNotAuthorized = "scope_not_authorized",
  UnsupportedChannel = "unsupported_channel",
  DuplicateDelivery = "duplicate_delivery",
  DeliveryRevoked = "delivery_revoked",
  DeliveryExpired = "delivery_expired",
  SupersededByNewDelivery = "superseded_by_new_delivery",
  InvalidStatusTransition = "invalid_status_transition",
}
export const ALL_SAFETY_DELIVERY_REASON_CODES: readonly SafetyDeliveryReasonCode[] = Object.values(SafetyDeliveryReasonCode);
export const isSafetyDeliveryReasonCode = (x: unknown): x is SafetyDeliveryReasonCode => (ALL_SAFETY_DELIVERY_REASON_CODES as readonly string[]).includes(x as string);

// --- Recommended action class (allow-listed; NOT legal/medical advice) -------

export enum SafetyRecommendedActionClass {
  ReviewWithGuardian = "review_with_guardian",
  ContactSafetyProfessional = "contact_safety_professional",
  PreserveCalmAndVerify = "preserve_calm_and_verify",
  DiscussWithProtectedPerson = "discuss_with_protected_person",
  FollowPlatformSafetyGuidance = "follow_platform_safety_guidance",
  NoImmediateAction = "no_immediate_action",
}
export const ALL_SAFETY_RECOMMENDED_ACTION_CLASSES: readonly SafetyRecommendedActionClass[] = Object.values(SafetyRecommendedActionClass);
export const isSafetyRecommendedActionClass = (x: unknown): x is SafetyRecommendedActionClass => (ALL_SAFETY_RECOMMENDED_ACTION_CLASSES as readonly string[]).includes(x as string);

// --- Idempotency key (bounded, opaque, no raw-content hash) ------------------

export const SAFETY_DELIVERY_IDEMPOTENCY_KEY_MAX = 64;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]+$/;
export function isValidDeliveryIdempotencyKey(x: unknown): x is string {
  return typeof x === "string" && x.length >= 1 && x.length <= SAFETY_DELIVERY_IDEMPOTENCY_KEY_MAX && IDEMPOTENCY_KEY_RE.test(x);
}

// --- Pure row-effectiveness (DB additionally re-checks CS-C4 authorization) ---

export interface SafetyDeliveryRowState {
  deliveryStatus: string; expiredAt: Date | null; revokedAt: Date | null; supersededAt: Date | null; archivedAt: Date | null; declinedAt: Date | null; failedAt: Date | null;
}
/**
 * Row-level effectiveness: an active status (prepared/available/acknowledged), no revoke/supersede/
 * archive/decline/fail, and not time-expired. Unknown status → false (fail-closed). The DB layer
 * ADDITIONALLY re-checks the live CS-C4 authorization, signal, and recipient membership.
 */
export function isSafetyDeliveryRowEffective(d: SafetyDeliveryRowState, now: Date): boolean {
  if (!isSafetyDeliveryStatus(d.deliveryStatus)) return false;
  const active: readonly string[] = [SafetyDeliveryStatus.Prepared, SafetyDeliveryStatus.Available, SafetyDeliveryStatus.Acknowledged];
  if (!active.includes(d.deliveryStatus)) return false;
  if (d.revokedAt !== null || d.supersededAt !== null || d.archivedAt !== null || d.declinedAt !== null || d.failedAt !== null) return false;
  if (d.expiredAt !== null && d.expiredAt.getTime() <= now.getTime()) return false;
  return true;
}

// --- Input allowlists --------------------------------------------------------

export const SAFETY_DELIVERY_EVALUATE_FIELDS: readonly string[] = ["recipientAuthorizationDecisionId", "requestedScopes"];
export const SAFETY_DELIVERY_CREATE_FIELDS: readonly string[] = ["recipientAuthorizationDecisionId", "idempotencyKey", "requestedScopes", "recommendedActionClass", "deliveryChannel"];

// --- Defaults + bounds -------------------------------------------------------

export const SAFETY_DELIVERY_DEFAULT_STATUS = SafetyDeliveryStatus.Prepared;
export const SAFETY_DELIVERY_DEFAULT_CHANNEL = SafetyDeliveryChannel.InternalInbox;
export const SAFETY_DELIVERY_LIST_MAX_LIMIT = 200;
export const SAFETY_DELIVERY_LIST_DEFAULT_LIMIT = 50;
export function clampSafetyDeliveryLimit(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return SAFETY_DELIVERY_LIST_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SAFETY_DELIVERY_LIST_MAX_LIMIT);
}
