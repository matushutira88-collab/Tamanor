/**
 * `useQueueController` — all Action Queue network logic, kept out of JSX.
 *
 * Race safety: every request carries a sequence number and only the newest may
 * commit, and each is aborted on supersession. Decisions are additionally guarded
 * per item, so a double tap cannot send two POSTs — but that is a UX guard only:
 * the SERVER's atomic conditional write is what actually prevents two operators
 * from overwriting each other, and a 409 is surfaced with canonical state.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { fetchQueue, submitQueueDecision } from "@/api/queue";
import { isSessionInvalid } from "@/api/client";
import type { ApiErrorCode, QueueDecision, QueueItem, QueueTab } from "@/api/types";
import { useAuth } from "@/auth/auth-provider";
import { readToken } from "@/auth/session-storage";
import { useShell } from "@/shell/shell-provider";
import { initialQueueState, queueReducer, type QueueState } from "./queue-state";
import { markQueueStale } from "./queue-sync";

export interface DecisionResult {
  ok: boolean;
  /** Set when the decision failed. `conflict` means someone else decided first. */
  error: ApiErrorCode | null;
}

export interface QueueController {
  state: QueueState;
  tab: QueueTab;
  setTab: (tab: QueueTab) => void;
  refresh: () => Promise<void>;
  loadMore: () => void;
  retry: () => void;
  decide: (itemId: string, decision: QueueDecision) => Promise<DecisionResult>;
  /** Ids with a decision in flight — the row disables its own controls. */
  pendingIds: readonly string[];
}

export function useQueueController(): QueueController {
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [state, dispatch] = useReducer(queueReducer, undefined, initialQueueState);
  const [tab, setTabState] = useState<QueueTab>("active");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  const load = useCallback(
    async (mode: "first" | "refresh" | "more") => {
      const current = stateRef.current;
      // Guard only the modes a user can trigger repeatedly by accident: an
      // onEndReached storm and a double pull-to-refresh. A "first" load is never
      // guarded — it comes from mount or a TAB CHANGE, and `stateRef` still holds
      // the pre-RESET phase at that moment, so guarding it would silently swallow
      // the new tab's load when the user switches tabs mid-request. Supersession is
      // already handled correctly below by the abort + sequence number.
      if (mode === "more" && (!current.hasMore || current.phase === "loading_more")) return;
      if (mode === "refresh" && current.phase === "refreshing") return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const ticket = ++seq.current;

      dispatch({ type: "LOAD_START", mode });

      const token = await readToken();
      if (!token) {
        onSessionRejected("unauthenticated");
        return;
      }

      const result = await fetchQueue(
        token,
        tabRef.current,
        mode === "more" ? current.cursor : null,
        { signal: controller.signal },
      );

      // Only the newest request may commit — a stale tab response is dropped.
      if (!mounted.current || ticket !== seq.current) return;

      if (result.ok) {
        dispatch({
          type: "LOAD_SUCCESS",
          mode,
          items: result.data.items,
          cursor: result.data.page.nextCursor,
          hasMore: result.data.page.hasMore,
          counts: result.data.counts,
          canDecide: result.data.canDecide,
        });
        return;
      }
      if (isSessionInvalid(result.error)) {
        onSessionRejected(result.error);
        return;
      }
      dispatch({ type: "LOAD_FAILURE", mode, error: result.error });
    },
    [onSessionRejected],
  );

  // A tab change resets the page chain and fetches page one.
  useEffect(() => {
    dispatch({ type: "RESET" });
    void load("first");
  }, [tab, load]);

  const setTab = useCallback((next: QueueTab) => {
    setTabState((prev) => (prev === next ? prev : next));
  }, []);

  const refresh = useCallback(async () => {
    await load("refresh");
  }, [load]);
  const loadMore = useCallback(() => void load("more"), [load]);
  const retry = useCallback(() => void load(stateRef.current.items.length > 0 ? "more" : "first"), [load]);

  const decide = useCallback<QueueController["decide"]>(
    async (itemId, decision) => {
      // One decision per item at a time. A UX guard — the server is the real one.
      if (pendingIds.includes(itemId)) return { ok: false, error: null };
      setPendingIds((prev) => [...prev, itemId]);

      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected("unauthenticated");
          return { ok: false, error: "unauthenticated" };
        }

        const result = await submitQueueDecision(token, itemId, decision);
        if (!mounted.current) return { ok: false, error: null };

        if (!result.ok) {
          if (isSessionInvalid(result.error)) onSessionRejected(result.error);
          // On a conflict the caller refetches; the local row is never optimistically
          // changed, so the screen keeps showing the last state the server confirmed.
          if (result.error === "conflict") {
            markQueueStale();
            void load("refresh");
          }
          return { ok: false, error: result.error };
        }

        if (result.data.item) {
          dispatch({
            type: "ITEM_DECIDED",
            item: result.data.item,
            tab: tabRef.current,
            counts: result.data.counts,
          });
        }
        // A decision changes the Alerts badge, so reconcile the shell once — not the
        // whole dashboard, and not on every harmless read.
        void reloadShell({ refresh: true });
        return { ok: true, error: null };
      } finally {
        if (mounted.current) setPendingIds((prev) => prev.filter((id) => id !== itemId));
      }
    },
    [onSessionRejected, pendingIds, reloadShell, load],
  );

  return useMemo(
    () => ({ state, tab, setTab, refresh, loadMore, retry, decide, pendingIds }),
    [state, tab, setTab, refresh, loadMore, retry, decide, pendingIds],
  );
}

export type { QueueItem };
