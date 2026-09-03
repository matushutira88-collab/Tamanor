/**
 * `useAccountsController` — all Accounts network logic, kept out of JSX.
 *
 * Race safety: every load carries a sequence number and only the newest may commit,
 * and each is aborted on supersession. Mutations are guarded per account, so a
 * double tap cannot send two POSTs.
 *
 * MULTI-OPERATOR SAFETY. That client guard is UX only. Another operator may
 * disconnect an account, toggle its monitoring or start its sync while this screen
 * is open, so:
 *   - a mutation NEVER updates a row optimistically; the row is replaced by the
 *     canonical one the server returns
 *   - a `not_found` from any mutation removes the row and refreshes, rather than
 *     leaving the screen claiming something that no longer exists
 *   - a sync is refused server-side on stale state, and `already_running` is
 *     reported truthfully instead of being retried
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  disconnectAccount as apiDisconnect, fetchAccounts, setAccountMonitoring, startAccountSync,
} from "@/api/accounts";
import { isSessionInvalid } from "@/api/client";
import type {
  AccountDisconnectResponse, ApiErrorCode, ConnectedAccountItem, SyncResult,
} from "@/api/types";
import { useAuth } from "@/auth/auth-provider";
import { readToken } from "@/auth/session-storage";
import { useShell } from "@/shell/shell-provider";
import {
  accountsReducer, applyFilter, filterCounts, initialAccountsState,
  type AccountFilter, type AccountsState,
} from "./accounts-state";
import { markAccountsStale } from "./accounts-sync";

export interface MutationResult<T = null> {
  ok: boolean;
  data: T | null;
  error: ApiErrorCode | null;
}

export interface AccountsController {
  state: AccountsState;
  /** The rows the active filter shows. */
  visible: ConnectedAccountItem[];
  counts: Record<AccountFilter, number>;
  setFilter: (filter: AccountFilter) => void;
  refresh: () => Promise<void>;
  retry: () => void;
  toggleMonitoring: (accountId: string, enabled: boolean) => Promise<MutationResult>;
  syncNow: (accountId: string) => Promise<MutationResult<SyncResult>>;
  disconnect: (accountId: string) => Promise<MutationResult<AccountDisconnectResponse>>;
  /** Ids with a mutation in flight — the row disables its own controls. */
  pendingIds: readonly string[];
}

export function useAccountsController(): AccountsController {
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [state, dispatch] = useReducer(accountsReducer, undefined, initialAccountsState);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      // Only a duplicate REFRESH is suppressed; a first load is never blocked, so a
      // remount or retry can always fetch. Supersession is handled by the ticket below.
      if (refresh && stateRef.current.phase === "refreshing") return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const ticket = ++seq.current;

      dispatch({ type: "LOAD_START", refresh });

      const token = await readToken();
      if (!token) {
        onSessionRejected("unauthenticated");
        return;
      }

      const result = await fetchAccounts(token, { signal: controller.signal });
      if (!mounted.current || ticket !== seq.current) return;

      if (result.ok) {
        dispatch({
          type: "LOAD_SUCCESS",
          accounts: result.data.accounts,
          capacity: result.data.capacity,
          canManage: result.data.capabilities.canManageConnectors,
          needsAttention: result.data.needsAttention,
        });
        return;
      }
      if (isSessionInvalid(result.error)) {
        onSessionRejected(result.error);
        return;
      }
      dispatch({ type: "LOAD_FAILURE", error: result.error });
    },
    [onSessionRejected],
  );

  useEffect(() => { void load(false); }, [load]);

  const refresh = useCallback(async () => { await load(true); }, [load]);
  const retry = useCallback(() => void load(false), [load]);
  const setFilter = useCallback((filter: AccountFilter) => dispatch({ type: "SET_FILTER", filter }), []);

  /** Run one mutation for one account, guarding against a double submit. */
  const guarded = useCallback(
    async <T>(accountId: string, run: (token: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      if (pendingIds.includes(accountId)) return { ok: false, data: null, error: null };
      setPendingIds((prev) => [...prev, accountId]);
      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected("unauthenticated");
          return { ok: false, data: null, error: "unauthenticated" };
        }
        return await run(token);
      } finally {
        if (mounted.current) setPendingIds((prev) => prev.filter((id) => id !== accountId));
      }
    },
    [pendingIds, onSessionRejected],
  );

  const toggleMonitoring = useCallback<AccountsController["toggleMonitoring"]>(
    (accountId, enabled) =>
      guarded(accountId, async (token) => {
        const result = await setAccountMonitoring(token, accountId, enabled);
        if (!mounted.current) return { ok: false, data: null, error: null };

        if (!result.ok) {
          if (isSessionInvalid(result.error)) onSessionRejected(result.error);
          // The row was never changed optimistically, so a failure leaves the screen
          // showing the last state the server actually confirmed.
          if (result.error === "not_found") {
            dispatch({ type: "ACCOUNT_REMOVED", accountId });
            markAccountsStale();
          }
          return { ok: false, data: null, error: result.error };
        }

        dispatch({ type: "ACCOUNT_UPDATED", account: result.data.account, capacity: result.data.capacity });
        // Monitored usage changed, so the shell's capacity counters must reconcile.
        void reloadShell({ refresh: true });
        return { ok: true, data: null, error: null };
      }),
    [guarded, onSessionRejected, reloadShell],
  );

  const syncNow = useCallback<AccountsController["syncNow"]>(
    (accountId) =>
      guarded(accountId, async (token) => {
        const result = await startAccountSync(token, accountId);
        if (!mounted.current) return { ok: false, data: null, error: null };

        if (!result.ok) {
          if (isSessionInvalid(result.error)) onSessionRejected(result.error);
          if (result.error === "not_found") {
            dispatch({ type: "ACCOUNT_REMOVED", accountId });
            markAccountsStale();
          }
          return { ok: false, data: null, error: result.error };
        }
        // A sync is asynchronous: the caller is told it STARTED and nothing more. No
        // completion is fabricated and no polling loop is started — the user refreshes.
        return { ok: true, data: result.data.result, error: null };
      }),
    [guarded, onSessionRejected],
  );

  const disconnect = useCallback<AccountsController["disconnect"]>(
    (accountId) =>
      guarded(accountId, async (token) => {
        const result = await apiDisconnect(token, accountId);
        if (!mounted.current) return { ok: false, data: null, error: null };

        if (!result.ok) {
          if (isSessionInvalid(result.error)) onSessionRejected(result.error);
          // A failed disconnect must RETAIN the account — never remove it hopefully.
          if (result.error === "not_found") {
            dispatch({ type: "ACCOUNT_REMOVED", accountId });
            markAccountsStale();
          }
          return { ok: false, data: null, error: result.error };
        }

        dispatch({ type: "ACCOUNT_REMOVED", accountId });
        markAccountsStale();
        // The cluster may have invalidated other rows too, so the list is re-read from
        // the server rather than guessed at.
        void load(true);
        // Connected-account count and capacity both changed.
        void reloadShell({ refresh: true });
        return { ok: true, data: result.data, error: null };
      }),
    [guarded, onSessionRejected, reloadShell, load],
  );

  const visible = useMemo(() => applyFilter(state.accounts, state.filter), [state.accounts, state.filter]);
  const counts = useMemo(() => filterCounts(state.accounts), [state.accounts]);

  return useMemo(
    () => ({ state, visible, counts, setFilter, refresh, retry, toggleMonitoring, syncNow, disconnect, pendingIds }),
    [state, visible, counts, setFilter, refresh, retry, toggleMonitoring, syncNow, disconnect, pendingIds],
  );
}
