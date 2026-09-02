/**
 * Authenticated app-shell context.
 *
 * Loads `/api/mobile/bootstrap` once the user is authenticated and exposes the
 * server's answer to the shell: workspace identity, access/billing state, usage,
 * badge counters and the allowed navigation set.
 *
 * The navigation set is a UX affordance ONLY. Hiding a tab is not a permission
 * check — every endpoint re-authorizes independently, so a hidden destination that
 * somehow got opened would still be refused by the server.
 *
 * A 401/403 here is handed to the M2 auth machine rather than handled locally, so
 * an expired session signs the user out through the one existing path.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from "react";

import { fetchBootstrap } from "@/api/shell";
import { isSessionInvalid } from "@/api/client";
import type { ApiErrorCode, Bootstrap, NavKey } from "@/api/types";
import { useAuth } from "@/auth/auth-provider";
import { readToken } from "@/auth/session-storage";
import { initialQueryState, queryReducer, type QueryState } from "@/data/query";

interface ShellContextValue {
  state: QueryState<Bootstrap>;
  bootstrap: Bootstrap | null;
  /** Destinations the server says this role/workspace may see. */
  allowedNav: NavKey[];
  reload: (options?: { refresh?: boolean }) => Promise<void>;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    queryReducer<Bootstrap>,
    null,
    initialQueryState<Bootstrap>,
  );
  const { onSessionRejected } = useAuth();
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(
    async (options?: { refresh?: boolean }) => {
      // One bootstrap at a time: a pull-to-refresh during the first load must not
      // fire a second request.
      if (inFlight.current) return;
      inFlight.current = true;
      dispatch({ type: "START", refresh: options?.refresh });

      try {
        const token = await readToken();
        if (!token) {
          // No credential at all — this is the auth machine's business, not ours.
          onSessionRejected("unauthenticated");
          return;
        }

        const result = await fetchBootstrap(token);
        if (!mounted.current) return;

        if (result.ok) {
          dispatch({ type: "SUCCESS", data: result.data.bootstrap });
          return;
        }

        // An invalid session is routed through the ONE existing auth path.
        if (isSessionInvalid(result.error)) {
          onSessionRejected(result.error);
          return;
        }
        dispatch({ type: "FAILURE", error: result.error });
      } finally {
        inFlight.current = false;
      }
    },
    [onSessionRejected],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<ShellContextValue>(
    () => ({
      state,
      bootstrap: state.data,
      // Fail closed: until the server has answered, no destination is "allowed".
      allowedNav: state.data?.nav.allowed ?? [],
      reload: load,
    }),
    [state, load],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>.");
  return value;
}

/** Convenience for screens that only need the badge counters. */
export function useShellCounts(): { pendingReview: number; unreadNotifications: number } {
  const { bootstrap } = useShell();
  return bootstrap?.counts ?? { pendingReview: 0, unreadNotifications: 0 };
}

export type { ApiErrorCode };
