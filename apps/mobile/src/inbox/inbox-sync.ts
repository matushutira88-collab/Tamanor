/**
 * A one-bit staleness signal between the Inbox list and the detail screen.
 *
 * They are separate route components with separate controllers, so a mutation made
 * on the detail screen (archive, mark read, priority…) does not reach the list's
 * state. Without this the user would archive an item, tap back, and still see it —
 * the UI would be lying about what the server holds.
 *
 * Deliberately a module-level flag rather than a context or a store: nothing needs
 * to re-render on it, the list simply asks once when it regains focus. Marking is
 * idempotent, and consuming clears it so a focus without an intervening mutation
 * costs no request.
 */

let stale = false;

/** Record that the Inbox changed somewhere other than the list. */
export function markInboxStale(): void {
  stale = true;
}

/** True once if the Inbox changed since the last check; clears the flag. */
export function consumeInboxStale(): boolean {
  if (!stale) return false;
  stale = false;
  return true;
}

/** Test seam: reset between cases. */
export function resetInboxStale(): void {
  stale = false;
}
