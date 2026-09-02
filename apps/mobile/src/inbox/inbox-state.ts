/**
 * The Inbox list state machine — pure, so every rule that matters is testable
 * without a renderer, a device or a network.
 *
 * The rules this encodes:
 *   - a FIRST load shows a skeleton; a refresh keeps the current rows on screen
 *   - appended pages DEDUPLICATE by id, so a row inserted concurrently on the
 *     server can never appear twice
 *   - a filter/view/search change RESETS the page chain (rows and cursor)
 *   - a failed load-more keeps the list and offers a retry
 *   - a mutation patches ONE row from the server's canonical response, and drops
 *     the row when it no longer belongs to the active view
 */

import type {
  ApiErrorCode, InboxCounts, InboxFilters, InboxItem, InboxView,
} from "@/api/types";

export type InboxPhase =
  | "idle" | "loading" | "refreshing" | "loading_more" | "ready" | "error";

export interface InboxState {
  phase: InboxPhase;
  items: InboxItem[];
  cursor: string | null;
  hasMore: boolean;
  counts: InboxCounts | null;
  /** Set for a blocking failure OR a failed load-more; the phase distinguishes them. */
  error: ApiErrorCode | null;
  /** True when the last load-more failed, so the footer can offer a retry. */
  loadMoreFailed: boolean;
  /** Server's verdict on whether this role may mutate. UX only. */
  canAct: boolean;
}

export const DEFAULT_FILTERS: InboxFilters = {
  view: "default", range: "all", type: null, sentiment: null, workflow: null,
  priority: null, risk: null, provider: null, label: null, assignee: null, q: null,
};

export function initialInboxState(): InboxState {
  return {
    phase: "idle", items: [], cursor: null, hasMore: false, counts: null,
    error: null, loadMoreFailed: false, canAct: false,
  };
}

export type InboxEvent =
  | { type: "LOAD_START"; mode: "first" | "refresh" | "more" }
  | {
      type: "LOAD_SUCCESS";
      mode: "first" | "refresh" | "more";
      items: InboxItem[];
      cursor: string | null;
      hasMore: boolean;
      counts: InboxCounts;
      canAct: boolean;
    }
  | { type: "LOAD_FAILURE"; mode: "first" | "refresh" | "more"; error: ApiErrorCode }
  /** A mutation returned the row's fresh canonical state. */
  | { type: "ITEM_PATCHED"; item: InboxItem; view: InboxView }
  /** The filter set changed — the page chain is no longer valid. */
  | { type: "RESET" };

/**
 * Append `incoming` to `existing`, dropping any id already present.
 *
 * Keyset pagination is stable, but a row can still repeat if it was updated between
 * two page reads. Deduplicating on append is cheaper and safer than trusting that
 * never happens.
 */
export function appendUnique(existing: InboxItem[], incoming: InboxItem[]): InboxItem[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((i) => i.id));
  const added = incoming.filter((i) => !seen.has(i.id));
  return added.length === 0 ? existing : [...existing, ...added];
}

/**
 * Whether an item still belongs in the given view after being mutated.
 *
 * The default inbox hides archived rows, `archived` shows only those, and `unread`
 * shows only unread ones — mirroring the server's own where-builder. A row that no
 * longer matches is removed rather than left behind lying about its state.
 */
export function belongsInView(item: InboxItem, view: InboxView): boolean {
  switch (view) {
    case "archived": return item.archived;
    case "unread": return !item.isRead && !item.archived;
    case "assigned_me":
    case "unassigned": return !item.archived;
    default: return !item.archived;
  }
}

export function inboxReducer(state: InboxState, event: InboxEvent): InboxState {
  switch (event.type) {
    case "LOAD_START":
      return {
        ...state,
        // A refresh or a load-more keeps the rows visible; only a first load blocks.
        phase: event.mode === "more" ? "loading_more" : event.mode === "refresh" && state.items.length > 0 ? "refreshing" : "loading",
        error: event.mode === "more" ? state.error : null,
        loadMoreFailed: false,
      };

    case "LOAD_SUCCESS":
      return {
        phase: "ready",
        // A first load or a refresh REPLACES; only a page append merges.
        items: event.mode === "more" ? appendUnique(state.items, event.items) : event.items,
        cursor: event.cursor,
        hasMore: event.hasMore,
        counts: event.counts,
        error: null,
        loadMoreFailed: false,
        canAct: event.canAct,
      };

    case "LOAD_FAILURE":
      // A failed load-more or refresh must NOT discard a valid list.
      if (event.mode === "more") {
        return { ...state, phase: "ready", error: event.error, loadMoreFailed: true };
      }
      return {
        ...state,
        phase: state.items.length > 0 ? "ready" : "error",
        error: event.error,
        loadMoreFailed: false,
      };

    case "ITEM_PATCHED": {
      const index = state.items.findIndex((i) => i.id === event.item.id);
      if (index === -1) return state;
      const stillHere = belongsInView(event.item, event.view);
      const items = stillHere
        ? state.items.map((i) => (i.id === event.item.id ? event.item : i))
        : state.items.filter((i) => i.id !== event.item.id);
      return { ...state, items };
    }

    case "RESET":
      return { ...initialInboxState(), canAct: state.canAct, counts: state.counts };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived view helpers                                                        */
/* -------------------------------------------------------------------------- */

/** True when the screen should show a blocking skeleton rather than rows. */
export const isFirstLoad = (s: InboxState): boolean => s.phase === "loading" && s.items.length === 0;
/** True when rows are on screen and a refresh is running behind them. */
export const isRefreshing = (s: InboxState): boolean => s.phase === "refreshing";
/** True when a further page is being appended. */
export const isLoadingMore = (s: InboxState): boolean => s.phase === "loading_more";
/** True when there is nothing to show and an error must replace the list. */
export const isBlockingError = (s: InboxState): boolean => s.phase === "error" && s.items.length === 0;
/** True when the load succeeded and genuinely returned nothing. */
export const isEmpty = (s: InboxState): boolean =>
  s.phase === "ready" && s.items.length === 0 && s.error === null;

/** Any filter beyond the view/range defaults is "active" and should be shown. */
export function activeFilterCount(filters: InboxFilters): number {
  let n = 0;
  if (filters.range !== "all") n++;
  for (const key of ["type", "sentiment", "workflow", "priority", "risk", "provider", "label", "assignee"] as const) {
    if (filters[key] !== null) n++;
  }
  return n;
}

/** True when the empty result is caused by filters/search rather than an empty inbox. */
export function isFilteredEmpty(filters: InboxFilters): boolean {
  return activeFilterCount(filters) > 0 || (filters.q !== null && filters.q !== "");
}

/** Filters minus every advanced narrowing — "Clear filters" keeps the view and search. */
export function clearedFilters(filters: InboxFilters): InboxFilters {
  return { ...DEFAULT_FILTERS, view: filters.view, q: filters.q };
}
