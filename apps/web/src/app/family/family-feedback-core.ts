/**
 * FAMILY-UI-02B — pure feedback logic for the Family success toast.
 *
 * Deliberately React-free and Next-free so it can be unit-tested in a plain tsx/node
 * process (see family-feedback-core.test.ts). The client component `family-feedback.tsx`
 * imports these; nothing here imports the component.
 *
 * Family-local only — never used by, or exported to, the Business console.
 */

/**
 * The success verbs the Family server actions redirect with as `?ok=<verb>`. Each is a
 * safe, closed token — never a raw message, id or PII. Kept in sync with the `redirect(...
 * ?ok=...)` calls across the Family action files.
 */
export const FAMILY_TOAST_VERBS = [
  "created",
  "updated",
  "archived",
  "restored",
  "revoked",
  "evaluated",
  "guardian_deactivated",
  "authority_revoked",
  "authority_suspended",
  "consent_revoked",
  "consent_suspended",
  "assessment_rejected",
  "assessment_suspended",
  "assessment_expired",
] as const;

export type FamilyToastVerb = (typeof FAMILY_TOAST_VERBS)[number];

export function isFamilyToastVerb(v: string | null | undefined): v is FamilyToastVerb {
  return typeof v === "string" && (FAMILY_TOAST_VERBS as readonly string[]).includes(v);
}

/**
 * Resolve an `?ok=` verb to a localized success message.
 *   - empty / missing verb   → null (show nothing)
 *   - known verb             → its specific message
 *   - unknown (but present)  → the generic fallback (still a success, just unlabelled)
 *
 * Only ever returns text from the caller-supplied dictionary, so a stray/never-mapped
 * verb can never surface a raw token or technical detail to the user.
 */
export function familyToastMessage(
  ok: string | null | undefined,
  messages: Record<string, string>,
  fallback: string,
): string | null {
  if (!ok) return null;
  return messages[ok] ?? fallback;
}

/**
 * Whether to emit a toast for the current `?ok=` value given the last one already emitted.
 * Returns false for an absent verb and for a repeat of the last emitted token — so a
 * re-render, a param that lingers, or a Back navigation to the same `?ok=` never re-toasts.
 */
export function shouldEmitToast(lastToken: string | null, ok: string | null | undefined): boolean {
  if (!ok) return false;
  return ok !== lastToken;
}
