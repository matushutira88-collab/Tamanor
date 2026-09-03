/**
 * `useOAuthFlow` — all native connector-OAuth orchestration, kept out of JSX.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS CONTROLLER ENFORCES.
 *
 * Nothing the device observes is treated as an outcome. The auth browser closing,
 * a deep link arriving, the app resuming from the background, a cold start — all
 * four are wired to the SAME response: `void resolve()`, an authenticated read of
 * the server's status. There is no code path in this file that sets a status from
 * anything else, which is why a spoofed `tamanor://oauth/callback?...&success=true`
 * can at most cost one extra authenticated request.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Cold start works because the truth was never local: the app restores its bearer
 * through the normal M2 path, reads the persisted flow id, and asks the server.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import {
  cancelOAuthFlow, fetchOAuthFlow, fetchOAuthOptions, startOAuthFlow, submitOAuthSelection,
} from "@/api/oauth";
import { isSessionInvalid } from "@/api/client";
import type { ApiErrorCode, OAuthIntent, OAuthProvider } from "@/api/types";
import { useAuth } from "@/auth/auth-provider";
import { readToken } from "@/auth/session-storage";
import { markAccountsStale } from "@/accounts/accounts-sync";
import { parseOAuthDeepLink } from "./deep-link";
import { pendingFlowStorage } from "./oauth-storage-deps";
import {
  canSubmitSelection, initialOAuthState, isBusy, oauthReducer, shouldRefreshAccounts,
  type OAuthFlowState,
} from "./oauth-state";

export interface OAuthFlowController {
  state: OAuthFlowState;
  busy: boolean;
  canSubmit: boolean;
  start: (input: { provider: OAuthProvider; intent: OAuthIntent; brandId?: string; accountId?: string }) => Promise<void>;
  toggle: (optionId: string) => void;
  submit: () => Promise<void>;
  /** Re-read the authoritative status. Safe to call repeatedly. */
  resolve: (flowId?: string) => Promise<void>;
  reset: () => void;
}

export function useOAuthFlow(): OAuthFlowController {
  const { onSessionRejected } = useAuth();
  const [state, dispatch] = useReducer(oauthReducer, undefined, initialOAuthState);
  const [, force] = useState(0);

  const mounted = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Guards against two concurrent status reads for the same flow. */
  const resolving = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /* ------------------------------------------------------------ resolve --- */

  /**
   * Read the SERVER's status. This is the only function in the controller that may
   * change the flow's outcome.
   */
  const resolve = useCallback<OAuthFlowController["resolve"]>(
    async (explicitFlowId) => {
      const flowId = explicitFlowId ?? stateRef.current.flowId;
      if (!flowId || resolving.current) return;
      resolving.current = true;
      dispatch({ type: "CHECKING" });

      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected("unauthenticated");
          return;
        }
        const result = await fetchOAuthFlow(token, flowId);
        if (!mounted.current) return;

        if (!result.ok) {
          if (isSessionInvalid(result.error)) {
            onSessionRejected(result.error);
            return;
          }
          // A flow that is not ours — or no longer exists — reads as not_found, which
          // is exactly what a spoofed or stale id produces. Nothing is claimed.
          dispatch({ type: "STATUS_FAILED", error: result.error });
          await pendingFlowStorage.clear();
          return;
        }

        dispatch({ type: "STATUS_RESOLVED", flow: result.data });

        if (result.data.status === "selection_required") {
          const opts = await fetchOAuthOptions(token, flowId);
          if (mounted.current && opts.ok) {
            dispatch({ type: "OPTIONS_LOADED", options: opts.data.options });
          }
          return;
        }

        // Terminal: the marker has done its job.
        if (result.data.status !== "pending" && result.data.status !== "provider_pending") {
          await pendingFlowStorage.clear();
          // Only a server-confirmed completion may invalidate the Accounts list.
          if (result.data.status === "completed") markAccountsStale();
        }
      } finally {
        resolving.current = false;
        if (mounted.current) force((n) => n + 1);
      }
    },
    [onSessionRejected],
  );

  /* -------------------------------------------------------------- start --- */

  const start = useCallback<OAuthFlowController["start"]>(
    async (input) => {
      dispatch({ type: "START", provider: input.provider, intent: input.intent });

      const token = await readToken();
      if (!token) {
        onSessionRejected("unauthenticated");
        return;
      }

      const started = await startOAuthFlow(token, input);
      if (!mounted.current) return;
      if (!started.ok) {
        if (isSessionInvalid(started.error)) {
          onSessionRejected(started.error);
          return;
        }
        dispatch({ type: "START_FAILED", error: started.error });
        return;
      }

      const { flowId, authorizationUrl } = started.data;
      dispatch({ type: "STARTED", flowId });
      await pendingFlowStorage.write({
        flowId, provider: input.provider, intent: input.intent,
        startedAt: new Date().toISOString(),
      });

      // The SYSTEM auth browser — never a WebView, and never an embedded provider
      // login. The URL was built entirely server-side; the app only opens it.
      let closed = false;
      try {
        const result = await WebBrowser.openAuthSessionAsync(
          authorizationUrl,
          Linking.createURL("oauth/callback"),
        );
        closed = result.type !== "opened";
      } catch {
        // A device with no usable browser. The flow is still resolvable server-side.
        closed = true;
      }

      if (!mounted.current) return;
      if (closed) {
        // The browser closing proves NOTHING — a success closes it too. Ask the server.
        dispatch({ type: "BROWSER_RETURNED" });
        await resolve(flowId);
      }
    },
    [onSessionRejected, resolve],
  );

  /* ---------------------------------------------------------- deep link --- */

  useEffect(() => {
    const handle = (url: string | null | undefined) => {
      const parsed = parseOAuthDeepLink(url);
      // Anything that is not our exact callback shape is dropped silently.
      if (parsed.kind !== "oauth_callback") return;
      // A DOORBELL: it names a flow, and we then go and ask the server about it.
      dispatch({ type: "CALLBACK_SIGNAL", flowId: parsed.flowId });
      void resolve(parsed.flowId);
    };

    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    // Cold start: the link that launched the app.
    void Linking.getInitialURL().then(handle).catch(() => {});
    return () => sub.remove();
  }, [resolve]);

  /* ------------------------------------------------------- app resumed --- */

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== "active") return;
      const current = stateRef.current;
      // Resuming with a flow still open is another "look again" signal — the browser
      // may have completed while the app was backgrounded and killed.
      if (current.flowId && (current.phase === "awaiting_browser" || current.phase === "checking")) {
        void resolve(current.flowId);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [resolve]);

  /* ------------------------------------------------------- cold resume --- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Nothing in flight locally, but a marker may have survived a kill.
      if (stateRef.current.flowId) return;
      const pending = await pendingFlowStorage.read();
      if (cancelled || !pending || !mounted.current) return;
      dispatch({ type: "CALLBACK_SIGNAL", flowId: pending.flowId });
      await resolve(pending.flowId);
    })();
    return () => { cancelled = true; };
  }, [resolve]);

  /* ----------------------------------------------------------- selection -- */

  const toggle = useCallback((optionId: string) => {
    dispatch({ type: "TOGGLE_OPTION", id: optionId });
  }, []);

  const submit = useCallback(async () => {
    const current = stateRef.current;
    if (!current.flowId || !canSubmitSelection(current)) return;
    dispatch({ type: "SUBMITTING" });

    const token = await readToken();
    if (!token) {
      onSessionRejected("unauthenticated");
      return;
    }
    const result = await submitOAuthSelection(token, current.flowId, current.selected);
    if (!mounted.current) return;

    if (!result.ok) {
      if (isSessionInvalid(result.error)) {
        onSessionRejected(result.error);
        return;
      }
      dispatch({ type: "STATUS_FAILED", error: result.error });
      return;
    }

    dispatch({
      type: "SELECTION_APPLIED",
      status: result.data.status,
      resultCode: result.data.resultCode,
      connected: result.data.connected,
      limited: result.data.limited,
      slotTaken: result.data.slotTaken,
    });
    await pendingFlowStorage.clear();
    // Again: only the SERVER's `completed` invalidates the Accounts list.
    if (result.data.status === "completed") markAccountsStale();
  }, [onSessionRejected]);

  const reset = useCallback(() => {
    const current = stateRef.current;
    // Tell the server the user walked away, so a late provider callback finds a
    // terminal flow. Best-effort: the TTL closes it regardless.
    if (current.flowId && !["completed", "failed", "cancelled", "expired"].includes(current.status ?? "")) {
      void (async () => {
        const token = await readToken();
        if (token && current.flowId) await cancelOAuthFlow(token, current.flowId).catch(() => {});
      })();
    }
    void pendingFlowStorage.clear();
    dispatch({ type: "RESET" });
  }, []);

  return useMemo(
    () => ({
      state,
      busy: isBusy(state),
      canSubmit: canSubmitSelection(state),
      start, toggle, submit, resolve, reset,
    }),
    [state, start, toggle, submit, resolve, reset],
  );
}

export { shouldRefreshAccounts };
