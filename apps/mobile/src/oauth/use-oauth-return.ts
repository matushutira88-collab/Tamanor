/**
 * The two halves of the native OAuth return, kept deliberately apart.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THEY ARE SEPARATE (M10D)
 *
 * M10C built this as one hook that captured the URL and then called
 * `router.replace`. The capture half worked on device — the logs showed the id
 * arriving, the auth boot being waited out, and the decision reaching "navigate".
 * The navigation half never took effect: an imperative `router.*` issued from a
 * layout effect is silently dropped in this build, right down to a bare tab switch,
 * while the same call from a button inside a screen works.
 *
 * So the capture stays (it was never the problem) and the navigation is replaced by
 * a DECLARATIVE `<Redirect>` rendered from inside the authenticated navigator, where
 * the router is unambiguously live. Nothing here navigates.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useSyncExternalStore } from "react";
import * as Linking from "expo-linking";

import {
  captureOAuthReturnUrl, decideOAuthReturn, discardOAuthReturnHandoff,
  getOAuthReturnSnapshot, subscribeOAuthReturn,
  type OAuthReturnAuth, type OAuthReturnState,
} from "./oauth-return";

/**
 * Feed native URLs into the coordinator. Mounted once, as high as possible, because
 * a COLD return arrives at `getInitialURL()` long before `(app)` exists.
 *
 * Its job ends the moment a validated id is in the store. It does not decide, does
 * not navigate, and cannot express an outcome.
 */
export function useOAuthReturnCapture(): void {
  useEffect(() => {
    let cancelled = false;
    const onUrl = (url: string | null | undefined) => {
      if (!cancelled) captureOAuthReturnUrl(url);
    };

    // Cold start: the URL that launched the app. Warm: every later delivery.
    void Linking.getInitialURL().then(onUrl).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => onUrl(e.url));
    return () => { cancelled = true; sub.remove(); };
  }, []);
}

/** Read the current handoff. Re-renders the caller when it changes. */
export function useOAuthReturnState(): OAuthReturnState {
  return useSyncExternalStore(subscribeOAuthReturn, getOAuthReturnSnapshot, getOAuthReturnSnapshot);
}

/**
 * Drop a pending return the moment auth is AUTHORITATIVELY unusable.
 *
 * `booting` is not that moment — a cold return is captured before the session has
 * been validated, and treating "not yet known" as "signed out" would throw away
 * every legitimate cold continuation. Only once boot has finished and the user
 * still cannot enter the app does the id go.
 *
 * It goes without being remembered, so a later login finds nothing pending.
 * `ConnectorOAuthFlow` is bound to its originating session; a new session must
 * never inherit a flow the old one started.
 */
export function useOAuthReturnAuthGate(auth: OAuthReturnAuth): void {
  const { booting, canEnterApp } = auth;
  useEffect(() => {
    const decision = decideOAuthReturn(getOAuthReturnSnapshot(), { booting, canEnterApp });
    if (decision.kind === "discard") discardOAuthReturnHandoff();
  }, [booting, canEnterApp]);
}
