import "server-only";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError, DeliveryNotEligibleError } from "@guardora/db";
import { isFamilyInvitationErrorCode, isFamilyAuthorityErrorCode, isFamilyConsentErrorCode, type FamilyActionErrorCode, type FamilyInvitationErrorCode, type FamilyAuthorityErrorCode, type FamilyConsentErrorCode } from "@/app/family/family-i18n";

/**
 * CS-C6.1 — map a repository exception to ONE safe, serializable, non-PII error group. This is the ONLY
 * error information a Family destructive-action UI is allowed to surface: never a stack trace, a Prisma/SQL
 * detail, a raw message, an id, a label, or any tenant/PII. Anything unrecognized fails closed to
 * `retry_later` (a generic "try again") so an unexpected internal error is never leaked to the client.
 */
export function toFamilyActionErrorCode(e: unknown): FamilyActionErrorCode {
  if (e instanceof FamilyForbiddenError) return "forbidden";
  if (e instanceof FamilyNotFoundError) return "not_found";
  if (e instanceof DeliveryNotEligibleError) return "authorization_not_effective";
  if (e instanceof FamilyValidationError) return "invalid_state";
  return "retry_later";
}

/** CS-C6.1 — the safe result shape a Family destructive action returns to `useActionState`. */
export type FamilyActionState = { ok: true } | { ok: false; error: FamilyActionErrorCode };
export const FAMILY_ACTION_IDLE: FamilyActionState = { ok: true };

/**
 * CS-C8 — map an invitation-workflow exception to ONE safe invitation error GROUP. FamilyValidationError
 * already carries the precise safe code in `.field` (e.g. "primary_conflict", "duplicate_pending_invitation",
 * "already_guardian", "expired", "already_accepted"); anything else fails closed to invalid_state /
 * retry_later. Never leaks a stack, SQL/Prisma detail, id, token, email or PII.
 */
export function toFamilyInvitationErrorCode(e: unknown): FamilyInvitationErrorCode {
  if (e instanceof FamilyForbiddenError) return "forbidden";
  if (e instanceof FamilyNotFoundError) return "not_found";
  if (e instanceof FamilyValidationError) return isFamilyInvitationErrorCode(e.field) ? e.field : "invalid_state";
  return "retry_later";
}
/** CS-C8 — the safe result shape an invitation destructive action returns to `useActionState`. */
export type FamilyInvitationActionState = { ok: true } | { ok: false; error: FamilyInvitationErrorCode };

/**
 * CS-C9 — map an authority-workflow exception to ONE safe authority error GROUP. FamilyValidationError
 * carries the precise safe code in `.field` (e.g. "authority_already_active", "self_management_forbidden",
 * "inactive_relationship", "invalid_authority_level"); a not-found record → authority_not_found; a
 * forbidden actor → delegation_forbidden; anything else fails closed to invalid_state / retry_later. Never
 * leaks a stack, SQL/Prisma detail, id, PII or the authorization chain.
 */
export function toFamilyAuthorityErrorCode(e: unknown): FamilyAuthorityErrorCode {
  if (e instanceof FamilyForbiddenError) return "delegation_forbidden";
  if (e instanceof FamilyNotFoundError) return "authority_not_found";
  if (e instanceof FamilyValidationError) return isFamilyAuthorityErrorCode(e.field) ? e.field : "invalid_state";
  return "retry_later";
}
/** CS-C9 — the safe result shape an authority destructive action returns to `useActionState`. */
export type FamilyAuthorityActionState = { ok: true } | { ok: false; error: FamilyAuthorityErrorCode };

/**
 * CS-C10 — map a consent-workflow exception to ONE safe consent error GROUP. FamilyValidationError carries
 * the precise safe code in `.field` (e.g. "consent_already_active", "inactive_relationship",
 * "consent_expired"); a not-found record → consent_not_found; a forbidden actor → invalid_state; anything
 * else fails closed to invalid_state / retry_later. Never leaks a stack, SQL/Prisma detail, id, PII or chain.
 */
export function toFamilyConsentErrorCode(e: unknown): FamilyConsentErrorCode {
  if (e instanceof FamilyForbiddenError) return "invalid_state";
  if (e instanceof FamilyNotFoundError) return "consent_not_found";
  if (e instanceof FamilyValidationError) return isFamilyConsentErrorCode(e.field) ? e.field : "invalid_state";
  return "retry_later";
}
/** CS-C10 — the safe result shape a consent destructive action returns to `useActionState`. */
export type FamilyConsentActionState = { ok: true } | { ok: false; error: FamilyConsentErrorCode };
