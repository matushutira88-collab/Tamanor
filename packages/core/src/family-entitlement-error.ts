/**
 * FAMILY-BILLING S2 — the typed Family entitlement error contract.
 *
 * Thrown by the server-side Family capacity guard (in @guardora/db); caught and mapped to a safe,
 * localized surface by the web layer later. The payload is deliberately small and SAFE: a stable
 * machine code, the capability/limit NAME, and optional current/max counts. It carries NO Stripe
 * identifiers, NO secrets, and NO child data — so it is safe to log and to serialize to a client.
 * Clients must switch on `code`, never parse the (English, non-authoritative) message.
 */

/** The four stable entitlement error categories. */
export const FAMILY_ENTITLEMENT_CODES = [
  "family_plan_limit_reached",   // a hard capacity cap was reached
  "family_access_restricted",    // restricted / suspended / deleting — administrative mutation denied
  "family_feature_unavailable",  // a boolean capability is not in the current plan
  "family_billing_state_invalid", // the tenant's billing/plan state could not be determined → fail closed
] as const;

export type FamilyEntitlementCode = (typeof FAMILY_ENTITLEMENT_CODES)[number];

export function isFamilyEntitlementCode(v: unknown): v is FamilyEntitlementCode {
  return typeof v === "string" && (FAMILY_ENTITLEMENT_CODES as readonly string[]).includes(v);
}

/** A safe, serializable snapshot of an entitlement denial — no PII, no secrets, no Stripe ids. */
export type FamilyEntitlementDetail = {
  code: FamilyEntitlementCode;
  /** The capability / limit name, e.g. "protected_profile" | "guardian" | "invitation" | "export". */
  capability: string;
  /** Current usage, when safe to expose (counts only — never a child record). */
  current?: number;
  /** The maximum allowed (null = unlimited), when applicable. */
  max?: number | null;
};

/**
 * The one error the Family capacity guard throws. `name` is stable ("FamilyEntitlementError") so the
 * web mapper can `instanceof`-check it. The message is a plain code string (never localized copy).
 */
export class FamilyEntitlementError extends Error {
  readonly code: FamilyEntitlementCode;
  readonly capability: string;
  readonly current?: number;
  readonly max?: number | null;

  constructor(code: FamilyEntitlementCode, capability: string, current?: number, max?: number | null) {
    super(code);
    this.name = "FamilyEntitlementError";
    this.code = code;
    this.capability = capability;
    this.current = current;
    this.max = max;
  }

  /** The safe, serializable detail (what a client/UI may receive). */
  detail(): FamilyEntitlementDetail {
    return { code: this.code, capability: this.capability, current: this.current, max: this.max };
  }
}

export function isFamilyEntitlementError(e: unknown): e is FamilyEntitlementError {
  return e instanceof FamilyEntitlementError ||
    (typeof e === "object" && e !== null && (e as { name?: string }).name === "FamilyEntitlementError");
}
