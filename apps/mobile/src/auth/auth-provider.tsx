/**
 * Wires secure storage + the API + the state machine into one context.
 *
 * This file is deliberately thin: the decisions live in `auth-machine` (pure
 * reducer) and `auth-flows` (pure orchestration), both of which are unit-tested.
 * What remains here is React lifecycle — mounting, the foreground listener, and
 * dispatching the events those modules return.
 *
 * Invariants preserved: the token never enters React state (only the validated
 * PROFILE does, and that is not durable auth truth), the session endpoint is called
 * on cold start and after a meaningful background interval — never per render and
 * never on a polling timer — and no connectivity failure can produce a signed-in
 * state.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { fetchSession, login, logout } from "@/api/auth";
import type { ApiErrorCode, SessionProfile } from "@/api/types";
import {
  bootstrapSession, createSubmitGuard, performSignIn, performSignOut, revalidateSession,
  type AuthFlowDeps,
} from "./auth-flows";
import { authReducer, initialAuthState, sessionOf, type AuthState } from "./auth-machine";
import { deleteToken, readToken, writeToken } from "./session-storage";

/** Don't revalidate on every foreground — only after the app was away this long. */
const REVALIDATE_AFTER_BACKGROUND_MS = 60_000;

/** The real dependency set. Tests exercise the flows directly, not through React. */
const flowDeps: AuthFlowDeps = {
  store: { readToken, writeToken, deleteToken },
  api: { fetchSession, login, logout },
};

export interface SignOutResult {
  /** False when the server could not be reached to revoke. Local state is cleared regardless. */
  serverRevoked: boolean;
}

interface AuthContextValue {
  state: AuthState;
  session: SessionProfile | null;
  /** Resolves to null on success, or a bounded error code on failure. */
  signIn: (input: { email: string; password: string; rememberMe: boolean }) => Promise<ApiErrorCode | null>;
  signOut: () => Promise<SignOutResult>;
  /** Re-ask the server. Used by the verification screen and the foreground check. */
  revalidate: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, deps = flowDeps }: { children: ReactNode; deps?: AuthFlowDeps }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  // Synchronous one-at-a-time gate: two taps in the same tick cannot both submit.
  const submitGuard = useRef(createSubmitGuard());
  const backgroundedAt = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const event = await bootstrapSession(deps);
      if (mounted.current) dispatch(event);
    })();
  }, [deps]);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (input) => {
      // Already submitting — ignore the extra tap rather than starting a second login.
      if (!submitGuard.current.tryAcquire()) return null;
      dispatch({ type: "LOGIN_STARTED" });
      try {
        const { event, error } = await performSignIn(deps, input);
        if (mounted.current) dispatch(event);
        return error;
      } finally {
        submitGuard.current.release();
      }
    },
    [deps],
  );

  const signOut = useCallback<AuthContextValue["signOut"]>(async () => {
    const { event, serverRevoked } = await performSignOut(deps);
    if (mounted.current) dispatch(event);
    return { serverRevoked };
  }, [deps]);

  const revalidate = useCallback(async () => {
    const event = await revalidateSession(deps);
    if (mounted.current) dispatch(event);
  }, [deps]);

  // Revalidate when the app returns from a meaningful spell in the background.
  // Not a poller: nothing runs while the app is in the foreground.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next !== "active") return;

      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (since === null || Date.now() - since < REVALIDATE_AFTER_BACKGROUND_MS) return;
      void revalidate();
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [revalidate]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, session: sessionOf(state), signIn, signOut, revalidate }),
    [state, signIn, signOut, revalidate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}
