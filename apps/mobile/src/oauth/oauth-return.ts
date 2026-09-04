/**
 * The OAuth RETURN HANDOFF — one place that decides "should we navigate, and where".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (M10C)
 *
 * The native return URL is `tamanor://oauth/callback?flow=…`. That was measured, not
 * assumed: `Linking.createURL("oauth/callback")` emits exactly that, and it is what
 * `openAuthSessionAsync` hands the provider as the return URL.
 *
 * Expo Router never navigates on it. Its linking prefix is `Linking.createURL("/")`
 * = `tamanor:///` — an EMPTY host — while the real URL puts `oauth` in the host and
 * `callback` in the path (`Linking.parse` → `{hostname:"oauth", path:"callback"}`).
 * The two do not line up, so the router matches nothing and the app stays wherever
 * it was. On a cold return that meant landing on Overview with the user expected to
 * find Connect on their own.
 *
 * WHERE THE HANDOFF ENDS UP (M10E)
 *
 * Two ways of acting on the captured id were built and measured on a real device,
 * and neither moves the screen:
 *   - imperative `router.replace/navigate/push` from a layout effect (M10C, six
 *     variants, down to a bare tab switch);
 *   - a declarative `<Redirect>` from the authenticated layout, gated on
 *     `useRootNavigationState()?.key` (M10D).
 * In both cases the state machine was verified correct — navigator ready, id
 * captured, redirect rendered, acknowledged once, no loop — only the navigation
 * had no effect. The invariant is navigating from a LAYOUT into a route nested in
 * its own tab stack. Navigation from a SCREEN works and always has.
 *
 * So this module holds the pending return and screens read it. Overview and the
 * Accounts list render a continuation card, and its CTA — a screen-level
 * `router.push` — opens Connect. One deliberate tap, no layout navigation.
 *
 * WHAT THIS MODULE IS ALLOWED TO KNOW
 *
 * A flow id. Nothing else. It parses through the SAME strict `parseOAuthDeepLink`
 * the rest of the app uses, so `success`, `status`, `error`, `code`, `state`,
 * `token` and every account/tenant/user field are discarded before they reach it —
 * a spoofed link cannot carry a claim in here.
 *
 * WHAT THIS MODULE MUST NEVER DO
 *
 * Call a provider, exchange a code, mark a flow complete, interpret a provider
 * result, persist a token, or create an account. It decides a destination. The
 * authenticated status read that follows is `useOAuthFlow`'s job, and stays the
 * only authority on what actually happened.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { parseOAuthDeepLink } from "./deep-link";

/** What the handoff should do next, given a captured id and the current auth state. */
export type OAuthReturnDecision =
  /** Nothing captured, or the same id was already handed off. Do nothing. */
  | { kind: "idle" }
  /** Auth has not resolved yet. Hold the id; decide once it has. */
  | { kind: "wait" }
  /** Authenticated: navigate to the canonical continuation surface with this id. */
  | { kind: "navigate"; flowId: string }
  /** Authoritatively not usable. Drop the id — a new session must not inherit it. */
  | { kind: "discard" };

/**
 * The auth facts this decision needs, passed in rather than imported so the rule is
 * a pure function and the auth machine stays the single source of those facts.
 */
export interface OAuthReturnAuth {
  /** Still validating the stored session — no decision is safe yet. */
  booting: boolean;
  /** `canEnterApp(state)`: server-validated, verified, supported workspace. */
  canEnterApp: boolean;
}

export interface OAuthReturnState {
  /** A validated flow id waiting for auth to resolve. */
  pending: string | null;
  /** The last id actually handed to navigation — the dedupe key. */
  handedOff: string | null;
}

export function initialOAuthReturnState(): OAuthReturnState {
  return { pending: null, handedOff: null };
}

/**
 * Capture a URL. Returns the next state; a URL that is not our exact callback shape
 * leaves the state untouched.
 *
 * The same provider round trip can legitimately arrive more than once — cold start
 * reads `getInitialURL()`, a warm return fires the `url` event, and the app may also
 * resume — so re-capturing an id that was already handed off is a no-op rather than
 * a second navigation. That is what stops the bouncing.
 */
export function captureOAuthReturn(
  state: OAuthReturnState,
  url: string | null | undefined,
): OAuthReturnState {
  const parsed = parseOAuthDeepLink(url);
  if (parsed.kind !== "oauth_callback") return state;
  if (state.handedOff === parsed.flowId) return state;
  if (state.pending === parsed.flowId) return state;
  return { ...state, pending: parsed.flowId };
}

/** What to do right now. Pure — the caller performs the navigation. */
export function decideOAuthReturn(
  state: OAuthReturnState,
  auth: OAuthReturnAuth,
): OAuthReturnDecision {
  if (!state.pending) return { kind: "idle" };
  // Never decide mid-boot: `canEnterApp` is false while booting, and treating that
  // as "not signed in" would throw away a legitimate return during a cold start.
  if (auth.booting) return { kind: "wait" };
  if (!auth.canEnterApp) return { kind: "discard" };
  return { kind: "navigate", flowId: state.pending };
}

/** Record that `flowId` was handed to navigation, so it is never handed twice. */
export function markOAuthReturnHandedOff(
  state: OAuthReturnState,
  flowId: string,
): OAuthReturnState {
  return { pending: null, handedOff: flowId };
}

/**
 * Drop a pending return without remembering it.
 *
 * Used when auth is authoritatively unusable. `ConnectorOAuthFlow` is bound to the
 * originating `sessionId`, so a flow started by a session that is gone must not be
 * resurrected by whoever logs in next — including the same person logging back in a
 * moment later. Forgetting it is the fail-closed answer, and it is deliberate that
 * `handedOff` is NOT set here: this id was never handed anywhere.
 */
export function discardOAuthReturn(state: OAuthReturnState): OAuthReturnState {
  return { ...state, pending: null };
}

/* -------------------------------------------------------------------------- */
/* M10D — the in-memory handoff store                                          */
/* -------------------------------------------------------------------------- */

/**
 * The rules above are pure. This is the one place they are actually held, so the
 * link listener and the authenticated layout can talk without either owning the
 * other.
 *
 * It is module state ON PURPOSE. A cold return arrives at `getInitialURL()` before
 * the auth machine has finished booting and long before `(app)` mounts, so the id
 * has to outlive both — but it must NOT outlive the process. There is deliberately
 * no persistence here: `ConnectorOAuthFlow` is bound to the originating session, so
 * a flow must never survive to be inherited by a later one. M7's `pendingFlowStorage`
 * remains the only durable pending-flow mechanism, and this is not a second one.
 */
let store: OAuthReturnState = initialOAuthReturnState();
const listeners = new Set<() => void>();

function emit(next: OAuthReturnState): void {
  if (next === store) return;
  store = next;
  for (const l of listeners) l();
}

/** Subscribe to handoff changes. Returns the unsubscribe function. */
export function subscribeOAuthReturn(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current snapshot. Stable between changes, so it is safe for `useSyncExternalStore`. */
export function getOAuthReturnSnapshot(): OAuthReturnState {
  return store;
}

/** Feed a URL in. Anything that is not our exact callback shape is ignored. */
export function captureOAuthReturnUrl(url: string | null | undefined): void {
  emit(captureOAuthReturn(store, url));
}

/**
 * Record that navigation for `flowId` has been issued.
 *
 * This is a CLIENT NAVIGATION fact and nothing more. It does not mean the OAuth
 * flow completed, was cancelled, or needs a selection — those remain the server's
 * to decide, and are read through `useOAuthFlow`. Acknowledging only stops the
 * layout re-issuing a redirect it has already issued, which is what prevents the
 * parent-renders-while-child-is-mounted loop.
 */
export function acknowledgeOAuthReturn(flowId: string): void {
  if (store.pending !== flowId) return;
  emit(markOAuthReturnHandedOff(store, flowId));
}

/** Drop a pending return without remembering it. See `discardOAuthReturn`. */
export function discardOAuthReturnHandoff(): void {
  emit(discardOAuthReturn(store));
}

/** Test-only: return the module store to its initial state. */
export function resetOAuthReturnStore(): void {
  store = initialOAuthReturnState();
  listeners.clear();
}
