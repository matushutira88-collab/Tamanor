/**
 * Action Queue list state — pure, so every rule is testable without a renderer.
 *
 * Shares the shape of the M4 Inbox reducer deliberately: same load modes, same
 * dedup-on-append, same "a failed refresh keeps the list" rule. What differs is the
 * reconciliation: a DECISION can move an item out of the current tab, and the
 * server hands back fresh badge counts with it.
 */

import type { ApiErrorCode, QueueCounts, QueueItem, QueueTab } from "@/api/types";

export type QueuePhase = "idle" | "loading" | "refreshing" | "loading_more" | "ready" | "error";

export interface QueueState {
  phase: QueuePhase;
  items: QueueItem[];
  cursor: string | null;
  hasMore: boolean;
  counts: QueueCounts | null;
  error: ApiErrorCode | null;
  loadMoreFailed: boolean;
  /** Server's verdict on whether this role may decide. UX only. */
  canDecide: boolean;
}

export function initialQueueState(): QueueState {
  return {
    phase: "idle", items: [], cursor: null, hasMore: false, counts: null,
    error: null, loadMoreFailed: false, canDecide: false,
  };
}

export type QueueEvent =
  | { type: "LOAD_START"; mode: "first" | "refresh" | "more" }
  | {
      type: "LOAD_SUCCESS";
      mode: "first" | "refresh" | "more";
      items: QueueItem[];
      cursor: string | null;
      hasMore: boolean;
      counts: QueueCounts;
      canDecide: boolean;
    }
  | { type: "LOAD_FAILURE"; mode: "first" | "refresh" | "more"; error: ApiErrorCode }
  /** A decision returned the item's fresh canonical state (and possibly new counts). */
  | { type: "ITEM_DECIDED"; item: QueueItem; tab: QueueTab; counts?: QueueCounts | null }
  | { type: "RESET" };

/** Append, dropping any id already present. */
export function appendUnique(existing: QueueItem[], incoming: QueueItem[]): QueueItem[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((i) => i.id));
  const added = incoming.filter((i) => !seen.has(i.id));
  return added.length === 0 ? existing : [...existing, ...added];
}

/**
 * The canonical tab → state mapping, mirroring `queueTabStates` in @guardora/ai.
 * Used ONLY to decide whether a decided row still belongs on screen; the server
 * remains the authority for what a tab actually contains.
 */
const TAB_STATES: Record<Exclude<QueueTab, "all">, QueueItem["queueState"][]> = {
  active: ["approval_required", "failed"],
  approval: ["approval_required"],
  blocked: ["blocked_by_safety", "failed"],
  resolved: ["executed", "no_action", "approved", "rejected", "rollback_needed"],
};

export function belongsInTab(item: QueueItem, tab: QueueTab): boolean {
  if (tab === "all") return true;
  return TAB_STATES[tab].includes(item.queueState);
}

export function queueReducer(state: QueueState, event: QueueEvent): QueueState {
  switch (event.type) {
    case "LOAD_START":
      return {
        ...state,
        phase:
          event.mode === "more" ? "loading_more"
            : event.mode === "refresh" && state.items.length > 0 ? "refreshing"
              : "loading",
        error: event.mode === "more" ? state.error : null,
        loadMoreFailed: false,
      };

    case "LOAD_SUCCESS":
      return {
        phase: "ready",
        items: event.mode === "more" ? appendUnique(state.items, event.items) : event.items,
        cursor: event.cursor,
        hasMore: event.hasMore,
        counts: event.counts,
        error: null,
        loadMoreFailed: false,
        canDecide: event.canDecide,
      };

    case "LOAD_FAILURE":
      if (event.mode === "more") {
        return { ...state, phase: "ready", error: event.error, loadMoreFailed: true };
      }
      // A failed refresh must never discard a valid list.
      return {
        ...state,
        phase: state.items.length > 0 ? "ready" : "error",
        error: event.error,
        loadMoreFailed: false,
      };

    case "ITEM_DECIDED": {
      const index = state.items.findIndex((i) => i.id === event.item.id);
      // Counts come from the server after a decision, so the badge never drifts.
      const counts = event.counts ?? state.counts;
      if (index === -1) return { ...state, counts };
      // A decided row leaves the tab when its new state no longer belongs there —
      // approving in "Approval" removes it, but "All" keeps everything.
      const items = belongsInTab(event.item, event.tab)
        ? state.items.map((i) => (i.id === event.item.id ? event.item : i))
        : state.items.filter((i) => i.id !== event.item.id);
      return { ...state, items, counts };
    }

    case "RESET":
      return { ...initialQueueState(), canDecide: state.canDecide, counts: state.counts };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived view helpers                                                        */
/* -------------------------------------------------------------------------- */

export const isFirstLoad = (s: QueueState): boolean => s.phase === "loading" && s.items.length === 0;
export const isRefreshing = (s: QueueState): boolean => s.phase === "refreshing";
export const isLoadingMore = (s: QueueState): boolean => s.phase === "loading_more";
export const isBlockingError = (s: QueueState): boolean => s.phase === "error" && s.items.length === 0;
export const isEmpty = (s: QueueState): boolean =>
  s.phase === "ready" && s.items.length === 0 && s.error === null;
