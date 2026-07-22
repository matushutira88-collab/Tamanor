import "server-only";
import { FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError, DeliveryNotEligibleError } from "@guardora/db";
import type { FamilyActionErrorCode } from "@/app/family/family-i18n";

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
