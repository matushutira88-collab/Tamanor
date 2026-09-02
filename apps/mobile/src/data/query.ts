/**
 * A very small authenticated-read abstraction.
 *
 * Deliberately not Redux, React Query, or any state framework: the dashboard needs
 * exactly three things that plain state gets wrong, and they are implemented here
 * as pure functions so each is unit-testable.
 *
 *   1. LOADING vs REFRESHING — a pull-to-refresh must keep the current content on
 *      screen; only a first load may show a skeleton.
 *   2. DUPLICATE SUPPRESSION — tapping the same timeframe twice, or refreshing
 *      while a refresh is running, must not start a second request.
 *   3. STALE PROTECTION — if the user switches 7d → 90d and the 7d response lands
 *      last, it must NOT overwrite the 90d data. Sequence numbers, not timestamps.
 */

import type { ApiErrorCode } from "@/api/types";

export type QueryStatus = "idle" | "loading" | "refreshing" | "success" | "error";

export interface QueryState<T> {
  status: QueryStatus;
  /** Retained across refreshes and across a failed refresh. */
  data: T | null;
  error: ApiErrorCode | null;
}

export function initialQueryState<T>(): QueryState<T> {
  return { status: "idle", data: null, error: null };
}

export type QueryEvent<T> =
  /** `refresh` distinguishes pull-to-refresh from a first/blocking load. */
  | { type: "START"; refresh?: boolean }
  | { type: "SUCCESS"; data: T }
  | { type: "FAILURE"; error: ApiErrorCode };

export function queryReducer<T>(state: QueryState<T>, event: QueryEvent<T>): QueryState<T> {
  switch (event.type) {
    case "START":
      return {
        // Keeping data during a refresh is what lets the screen stay populated.
        // A first load (no data yet) is "loading" so the skeleton can show.
        status: event.refresh && state.data !== null ? "refreshing" : "loading",
        data: state.data,
        error: null,
      };
    case "SUCCESS":
      return { status: "success", data: event.data, error: null };
    case "FAILURE":
      // A failed REFRESH keeps the last good content and reports the error
      // alongside it; a failed first load has nothing to show.
      return { status: "error", data: state.data, error: event.error };
    default:
      return state;
  }
}

/** True when the screen should show a blocking skeleton rather than content. */
export function isInitialLoad<T>(state: QueryState<T>): boolean {
  return state.status === "loading" && state.data === null;
}

/** True when content is on screen and a refresh is in flight behind it. */
export function isRefreshing<T>(state: QueryState<T>): boolean {
  return state.status === "refreshing";
}

/**
 * True when the screen has nothing to show and must render an error instead.
 * A failed refresh over existing data is NOT this — that keeps the content.
 */
export function isBlockingError<T>(state: QueryState<T>): boolean {
  return state.status === "error" && state.data === null;
}

/* -------------------------------------------------------------------------- */
/* Request sequencing                                                          */
/* -------------------------------------------------------------------------- */

export interface RequestTicket {
  seq: number;
  /** True when an identical request was already in flight — the caller must skip. */
  duplicate: boolean;
}

export interface RequestTracker {
  /** Claim a slot for `key`. A duplicate ticket must not perform a request. */
  begin: (key: string) => RequestTicket;
  /** Only the newest ticket may commit its result. */
  isLatest: (seq: number) => boolean;
  /** Release the in-flight marker for a ticket. */
  end: (ticket: RequestTicket) => void;
  readonly inFlight: string | null;
}

/**
 * Tracks one logical read at a time.
 *
 * `key` identifies the request (here, the timeframe): the same key while a request
 * is in flight is a duplicate and is refused; a DIFFERENT key supersedes the old
 * one, whose response is then no longer the latest and will be discarded.
 */
export function createRequestTracker(): RequestTracker {
  let seq = 0;
  let latest = 0;
  let current: string | null = null;

  return {
    begin(key: string): RequestTicket {
      if (current === key) return { seq: latest, duplicate: true };
      seq += 1;
      latest = seq;
      current = key;
      return { seq, duplicate: false };
    },
    isLatest(candidate: number): boolean {
      return candidate === latest;
    },
    end(ticket: RequestTicket): void {
      // Only clear the marker if this ticket is still the active one; a superseded
      // request finishing late must not unlock the newer one.
      if (!ticket.duplicate && ticket.seq === latest) current = null;
    },
    get inFlight(): string | null {
      return current;
    },
  };
}
