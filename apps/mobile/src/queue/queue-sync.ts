/**
 * A one-bit staleness signal between the Action Queue list and the detail screen.
 *
 * Same pattern as the M4 Inbox: they are separate route components with separate
 * controllers, so a decision made on the detail screen must tell the list to
 * reconcile when the user navigates back — otherwise an approved item would still
 * sit in the Approval tab, which would be a lie about server state.
 *
 * Marking is idempotent; consuming clears it, so a focus with no intervening
 * decision costs no request.
 */

let stale = false;

/** Record that the queue changed somewhere other than the list. */
export function markQueueStale(): void {
  stale = true;
}

/** True once if the queue changed since the last check; clears the flag. */
export function consumeQueueStale(): boolean {
  if (!stale) return false;
  stale = false;
  return true;
}

/** Test seam: reset between cases. */
export function resetQueueStale(): void {
  stale = false;
}
