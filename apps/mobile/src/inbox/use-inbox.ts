/**
 * `useInboxController` — all Inbox network logic, kept out of JSX.
 *
 * Responsibilities: filters, debounced search, keyset paging, refresh, mutation
 * reconciliation and shell-badge reconciliation. The rules themselves live in the
 * pure `inbox-state` reducer; this hook is the React lifecycle around it.
 *
 * Race safety: every request carries a sequence number, and only the newest may
 * commit. Changing a filter while a page is in flight therefore cannot be
 * overwritten by the older response, and each request is also aborted on
 * supersession so the socket is not left running.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { fetchInbox, performInboxAction } from "@/api/inbox";
import { isSessionInvalid } from "@/api/client";
import type {
  ApiErrorCode, InboxActionKey, InboxFilters, InboxItem, InboxPriority, InboxWorkflow,
} from "@/api/types";
import { useAuth } from "@/auth/auth-provider";
import { readToken } from "@/auth/session-storage";
import { useShell } from "@/shell/shell-provider";
import {
  DEFAULT_FILTERS, inboxReducer, initialInboxState, type InboxState,
} from "./inbox-state";

/** Wait this long after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 400;

/** Longest search term the client will send; the server truncates independently. */
export const MAX_SEARCH_LENGTH = 200;

export interface InboxController {
  state: InboxState;
  filters: InboxFilters;
  /** Raw text in the search box — may differ from `filters.q` while debouncing. */
  searchText: string;
  setSearchText: (text: string) => void;
  setFilters: (next: InboxFilters) => void;
  setView: (view: InboxFilters["view"]) => void;
  refresh: () => Promise<void>;
  loadMore: () => void;
  retry: () => void;
  /** Runs one internal action and patches the affected row from the server's answer. */
  act: (itemId: string, action: InboxActionKey, value?: InboxPriority | InboxWorkflow) => Promise<ApiErrorCode | null>;
  /** Ids with a mutation in flight — the row disables its own controls. */
  pendingIds: readonly string[];
}

export function useInboxController(): InboxController {
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [state, dispatch] = useReducer(inboxReducer, undefined, initialInboxState);
  const [filters, setFiltersState] = useState<InboxFilters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  // Read inside callbacks without making them change identity every render.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
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
    async (mode: "first" | "refresh" | "more") => {
      const current = stateRef.current;
      // Never start a second page while one is running, and never page past the end.
      if (mode === "more" && (!current.hasMore || current.phase === "loading_more")) return;
      if (mode !== "more" && (current.phase === "loading" || current.phase === "refreshing")) return;

      // Supersede any in-flight request: its response can no longer commit.
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

      const result = await fetchInbox(
        token,
        filtersRef.current,
        mode === "more" ? current.cursor : null,
        { signal: controller.signal },
      );

      // Only the newest request may commit — a stale filter/search response is dropped.
      if (!mounted.current || ticket !== seq.current) return;

      if (result.ok) {
        dispatch({
          type: "LOAD_SUCCESS",
          mode,
          items: result.data.items,
          cursor: result.data.page.nextCursor,
          hasMore: result.data.page.hasMore,
          counts: result.data.counts,
          canAct: result.data.canAct,
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

  // Any filter change (including a debounced search) resets the page chain and
  // fetches page one. Keyed on the serialized filters so it fires exactly once.
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    dispatch({ type: "RESET" });
    void load("first");
  }, [filterKey, load]);

  // Debounce the search box into the filter set.
  useEffect(() => {
    const trimmed = searchText.trim().slice(0, MAX_SEARCH_LENGTH);
    const next = trimmed.length > 0 ? trimmed : null;
    if (next === filtersRef.current.q) return;

    const timer = setTimeout(() => {
      setFiltersState((prev) => (prev.q === next ? prev : { ...prev, q: next }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const setFilters = useCallback((next: InboxFilters) => setFiltersState(next), []);
  const setView = useCallback((view: InboxFilters["view"]) => {
    setFiltersState((prev) => (prev.view === view ? prev : { ...prev, view }));
  }, []);

  const refresh = useCallback(async () => {
    await load("refresh");
  }, [load]);
  const loadMore = useCallback(() => void load("more"), [load]);
  const retry = useCallback(() => void load(stateRef.current.items.length > 0 ? "more" : "first"), [load]);

  const act = useCallback<InboxController["act"]>(
    async (itemId, action, value) => {
      // One mutation per row at a time — a double tap cannot send two POSTs.
      if (pendingIds.includes(itemId)) return null;
      setPendingIds((prev) => [...prev, itemId]);

      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected("unauthenticated");
          return "unauthenticated";
        }

        const result = await performInboxAction(token, itemId, action, value);
        if (!mounted.current) return null;

        if (!result.ok) {
          if (isSessionInvalid(result.error)) onSessionRejected(result.error);
          // The local row is left exactly as the server last described it — a failed
          // mutation never optimistically changes what the user sees.
          return result.error;
        }

        // Patch the single row from the server's canonical state rather than
        // refetching the whole list.
        if (result.data.item) {
          dispatch({ type: "ITEM_PATCHED", item: result.data.item, view: filtersRef.current.view });
        }

        // Read/archive change unread membership, so the shell badge would otherwise
        // drift. Reconciled once here rather than on every field change.
        if (action !== "priority" && action !== "workflow") {
          void reloadShell({ refresh: true });
        }
        return null;
      } finally {
        if (mounted.current) setPendingIds((prev) => prev.filter((id) => id !== itemId));
      }
    },
    [onSessionRejected, pendingIds, reloadShell],
  );

  return useMemo(
    () => ({
      state, filters, searchText, setSearchText, setFilters, setView,
      refresh, loadMore, retry, act, pendingIds,
    }),
    [state, filters, searchText, setFilters, setView, refresh, loadMore, retry, act, pendingIds],
  );
}

export type { InboxItem };
