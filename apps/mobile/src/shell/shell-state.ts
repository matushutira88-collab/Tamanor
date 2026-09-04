/**
 * Shell phase — pure, so the app-shell's failure and recovery rules are testable
 * without React or a device.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (M8C, defect 1)
 *
 * `/api/mobile/bootstrap` is the ONLY authority for workspace identity, plan and
 * allowed navigation. Before M8C its failure was invisible: the provider recorded
 * an error nobody read, `allowedNav` stayed empty, and the shell settled into a
 * permanently degraded two-tab state with no workspace name, no badges and an
 * empty More screen. The dashboard could recover on its own while the shell
 * around it stayed broken, and nothing short of an app restart repaired it.
 *
 * So a bootstrap failure gets a phase of its own, the shell renders it, and it
 * carries a retry. Three rules hold everything together:
 *
 *   FAIL CLOSED — with no bootstrap the shell shows an error, never a guessed
 *   navigation set. Nothing here fabricates workspace data.
 *
 *   A FAILED RELOAD KEEPS CONTENT — once bootstrap has answered, a later failure
 *   does not collapse the tab bar. That matches the dashboard's own refresh rule
 *   and stops a blip from throwing the user out of the app shell.
 *
 *   STALE IS NOT HEALTHY — that retained content still counts as needing a
 *   reload, so a screen-level retry repairs the shell behind it.
 *
 * An expired or revoked session is NOT a shell error: the provider hands 401 /
 * `session_expired` / `session_revoked` to the M2 auth machine before any of
 * this is reached, so the user is signed out through the one existing path
 * rather than parked on a retry button that can never succeed.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { QueryState } from "@/data/query";
import type { Bootstrap } from "@/api/types";

/**
 * What the app shell should render.
 *
 *  - `booting` — no answer yet; show the splash/skeleton, never an error.
 *  - `ready`   — bootstrap has answered at least once; render the real shell.
 *  - `error`   — bootstrap failed and there is nothing to fall back on.
 */
export type ShellPhase = "booting" | "ready" | "error";

export function shellPhase(state: QueryState<Bootstrap>): ShellPhase {
  // Content wins over status: a failed RELOAD keeps the shell usable.
  if (state.data !== null) return "ready";
  if (state.status === "error") return "error";
  return "booting";
}

/**
 * True when a screen-level retry should ALSO re-run the shell bootstrap.
 *
 * The common case this exists for is one underlying outage failing both requests
 * at once: the user taps the dashboard's "Try again" and expects the whole screen
 * back, tab bar included. A HEALTHY shell is deliberately left alone so an
 * ordinary dashboard refresh does not drag a second request along with it.
 *
 * Overlapping requests are not this function's problem — `ShellProvider` refuses
 * a second bootstrap while one is in flight — so a repeated tap is safe.
 */
export function shellNeedsReload(state: QueryState<Bootstrap>): boolean {
  return state.status === "error" || state.data === null;
}
