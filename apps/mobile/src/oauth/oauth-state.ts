/**
 * The native OAuth flow state machine — pure, so every rule is testable without a
 * renderer, a browser or a server.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONLY THE SERVER MOVES THIS MACHINE FORWARD.
 *
 * There is deliberately no event that carries an outcome from the device. The
 * browser returning, the deep link arriving and the app resuming are all just
 * "look again" signals; the only event that can set `selection_required`,
 * `completed` or `failed` is `STATUS_RESOLVED`, whose payload comes from the
 * authenticated status endpoint.
 *
 * That is what makes a spoofed `tamanor://oauth/callback?flow=…&success=true`
 * harmless: it can at most cause an extra authenticated status read.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type {
  ApiErrorCode, OAuthFlow, OAuthIntent, OAuthProvider, OAuthResultCode,
  OAuthSelectableOption, OAuthStatus,
} from "@/api/types";

/**
 * What the UI is doing, which is NOT the same as what the server thinks.
 *
 *   idle              — nothing in progress
 *   starting          — asking the server for an authorization URL
 *   awaiting_browser  — the system auth browser is open
 *   checking          — reading the authoritative status
 *   selecting         — the server said selection_required; options are shown
 *   submitting        — applying the user's selection
 *   done              — a terminal server status was observed
 */
export type OAuthPhase =
  | "idle" | "starting" | "awaiting_browser" | "checking"
  | "selecting" | "submitting" | "done";

export interface OAuthFlowState {
  phase: OAuthPhase;
  /** The correlation id. Present from `start` until the flow is cleared. */
  flowId: string | null;
  provider: OAuthProvider | null;
  intent: OAuthIntent | null;
  /** The SERVER's status. Never inferred from the device. */
  status: OAuthStatus | null;
  resultCode: OAuthResultCode | null;
  options: OAuthSelectableOption[];
  /** Option ids the user has ticked. Always a subset of `options`. */
  selected: string[];
  /** Bounded transport error, if the last request failed. */
  error: ApiErrorCode | null;
  /** Counts from a completed selection, for the confirmation message. */
  connected: number;
  limited: number;
  slotTaken: number;
}

export function initialOAuthState(): OAuthFlowState {
  return {
    phase: "idle", flowId: null, provider: null, intent: null, status: null,
    resultCode: null, options: [], selected: [], error: null,
    connected: 0, limited: 0, slotTaken: 0,
  };
}

export type OAuthEvent =
  | { type: "START"; provider: OAuthProvider; intent: OAuthIntent }
  | { type: "STARTED"; flowId: string }
  | { type: "START_FAILED"; error: ApiErrorCode }
  /** The auth browser closed. Says NOTHING about the outcome. */
  | { type: "BROWSER_RETURNED" }
  /** A deep link arrived. Also says nothing — it only names a flow. */
  | { type: "CALLBACK_SIGNAL"; flowId: string }
  | { type: "CHECKING" }
  /** THE only event that can report an outcome. Comes from the server. */
  | { type: "STATUS_RESOLVED"; flow: OAuthFlow }
  | { type: "STATUS_FAILED"; error: ApiErrorCode }
  | { type: "OPTIONS_LOADED"; options: OAuthSelectableOption[] }
  | { type: "TOGGLE_OPTION"; id: string }
  | { type: "SUBMITTING" }
  | {
      type: "SELECTION_APPLIED";
      status: OAuthStatus;
      resultCode: OAuthResultCode | null;
      connected: number; limited: number; slotTaken: number;
    }
  | { type: "RESET" };

/** Terminal server statuses. Nothing further will happen to the flow. */
const TERMINAL: readonly OAuthStatus[] = ["completed", "failed", "cancelled", "expired"];
export const isTerminal = (s: OAuthStatus | null): boolean =>
  s !== null && TERMINAL.includes(s);

export function oauthReducer(state: OAuthFlowState, event: OAuthEvent): OAuthFlowState {
  switch (event.type) {
    case "START":
      return {
        ...initialOAuthState(),
        phase: "starting", provider: event.provider, intent: event.intent,
      };

    case "STARTED":
      return { ...state, phase: "awaiting_browser", flowId: event.flowId, error: null };

    case "START_FAILED":
      return { ...state, phase: "idle", error: event.error };

    // The browser closing proves nothing — not even that the user cancelled, because
    // a completed authorization also closes it. The controller asks the server.
    case "BROWSER_RETURNED":
      return state.flowId ? { ...state, phase: "checking" } : { ...state, phase: "idle" };

    // A deep link for a DIFFERENT flow is ignored rather than adopted, so an
    // unrelated (or hostile) link cannot redirect an in-progress flow.
    case "CALLBACK_SIGNAL":
      if (state.flowId && event.flowId !== state.flowId) return state;
      return { ...state, phase: "checking", flowId: state.flowId ?? event.flowId };

    case "CHECKING":
      return { ...state, phase: "checking", error: null };

    case "STATUS_RESOLVED": {
      const f = event.flow;
      return {
        ...state,
        flowId: f.id,
        provider: f.provider,
        intent: f.intent,
        status: f.status,
        resultCode: f.resultCode,
        error: null,
        // Selection is the only non-terminal stop; everything else is done or waiting.
        phase: f.status === "selection_required" ? "selecting"
          : isTerminal(f.status) ? "done"
            : "awaiting_browser",
      };
    }

    case "STATUS_FAILED":
      // The flow is retained: losing a status read must not lose the correlation id.
      return { ...state, phase: "done", error: event.error };

    case "OPTIONS_LOADED":
      return {
        ...state,
        options: event.options,
        // A reload must not resurrect a tick for an option that no longer exists.
        selected: state.selected.filter((id) => event.options.some((o) => o.id === id)),
      };

    case "TOGGLE_OPTION": {
      // Only an option the SERVER offered, and only one that is eligible, may be ticked.
      const option = state.options.find((o) => o.id === event.id);
      if (!option || !option.eligible) return state;
      const selected = state.selected.includes(event.id)
        ? state.selected.filter((id) => id !== event.id)
        : [...state.selected, event.id];
      return { ...state, selected };
    }

    case "SUBMITTING":
      return { ...state, phase: "submitting", error: null };

    case "SELECTION_APPLIED":
      return {
        ...state,
        phase: "done",
        status: event.status,
        resultCode: event.resultCode,
        connected: event.connected,
        limited: event.limited,
        slotTaken: event.slotTaken,
      };

    case "RESET":
      return initialOAuthState();

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived views                                                               */
/* -------------------------------------------------------------------------- */

export const isBusy = (s: OAuthFlowState): boolean =>
  s.phase === "starting" || s.phase === "checking" || s.phase === "submitting";

/** Whether the selection can be submitted. */
export const canSubmitSelection = (s: OAuthFlowState): boolean =>
  s.phase === "selecting" && s.selected.length > 0;

/**
 * Whether the Accounts list should be refreshed.
 *
 * ONLY a server-confirmed `completed` qualifies. A closed browser, a deep link or a
 * local guess never does — which is precisely the anti-spoof rule.
 */
export const shouldRefreshAccounts = (s: OAuthFlowState): boolean =>
  s.phase === "done" && s.status === "completed";

/** Whether the flow ended without connecting anything. */
export const didFail = (s: OAuthFlowState): boolean =>
  s.phase === "done" && s.status !== null && s.status !== "completed";
