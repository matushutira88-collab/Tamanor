/**
 * A one-bit staleness signal between the Accounts list and the account detail screen.
 *
 * Same pattern as the M4 Inbox and M5 Action Queue: they are separate route
 * components with separate controllers, so a monitoring toggle or a disconnect made
 * on the detail screen must tell the list to reconcile when the user navigates back
 * — otherwise a disconnected account would still sit in the list, which would be a
 * lie about server state.
 *
 * Marking is idempotent; consuming clears it, so a focus with no intervening
 * mutation costs no request.
 */

let stale = false;

/** Record that the accounts list changed somewhere other than the list. */
export function markAccountsStale(): void {
  stale = true;
}

/** True once if the accounts changed since the last check; clears the flag. */
export function consumeAccountsStale(): boolean {
  if (!stale) return false;
  stale = false;
  return true;
}

/** Test seam: reset between cases. */
export function resetAccountsStale(): void {
  stale = false;
}
