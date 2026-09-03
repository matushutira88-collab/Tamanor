/**
 * Accounts list state — pure, so every rule is testable without a renderer.
 *
 * Unlike the M4 Inbox and the M5 Action Queue, Accounts is a BOUNDED management list:
 * a tenant has a handful of connections, the canonical server query returns all of
 * them in one batched read, and there is no cursor. So there is no pagination here,
 * and the quick filter is applied on the device — which is safe precisely because
 * the whole set is already present and every filter value is a bounded key.
 *
 * What the reducer must guarantee is the same as before: a failed refresh never
 * destroys a good list, and a mutation adopts the SERVER's row rather than an
 * optimistic guess.
 */

import type {
  AccountCapacity, ApiErrorCode, ConnectedAccountItem,
} from "@/api/types";
import { needsAttention } from "./presentation";

export type AccountsPhase = "idle" | "loading" | "refreshing" | "ready" | "error";

/** The bounded quick filters. Client-side by design — see the module comment. */
export const ACCOUNT_FILTERS = ["all", "attention", "monitored", "unmonitored"] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

export interface AccountsState {
  phase: AccountsPhase;
  accounts: ConnectedAccountItem[];
  capacity: AccountCapacity | null;
  /** Server's verdict on whether this role may manage connectors. UX only. */
  canManage: boolean;
  needsAttention: number;
  error: ApiErrorCode | null;
  filter: AccountFilter;
}

export function initialAccountsState(): AccountsState {
  return {
    phase: "idle", accounts: [], capacity: null, canManage: false,
    needsAttention: 0, error: null, filter: "all",
  };
}

export type AccountsEvent =
  | { type: "LOAD_START"; refresh: boolean }
  | {
      type: "LOAD_SUCCESS";
      accounts: ConnectedAccountItem[];
      capacity: AccountCapacity;
      canManage: boolean;
      needsAttention: number;
    }
  | { type: "LOAD_FAILURE"; error: ApiErrorCode }
  /** A mutation returned the account's fresh canonical state. */
  | { type: "ACCOUNT_UPDATED"; account: ConnectedAccountItem; capacity?: AccountCapacity | null }
  /** A disconnect succeeded — the row leaves the list. */
  | { type: "ACCOUNT_REMOVED"; accountId: string }
  | { type: "SET_FILTER"; filter: AccountFilter };

export function accountsReducer(state: AccountsState, event: AccountsEvent): AccountsState {
  switch (event.type) {
    case "LOAD_START":
      return {
        ...state,
        phase: event.refresh && state.accounts.length > 0 ? "refreshing" : "loading",
        error: null,
      };

    case "LOAD_SUCCESS":
      return {
        ...state,
        phase: "ready",
        accounts: event.accounts,
        capacity: event.capacity,
        canManage: event.canManage,
        needsAttention: event.needsAttention,
        error: null,
      };

    case "LOAD_FAILURE":
      // A failed refresh must never discard a valid list.
      return {
        ...state,
        phase: state.accounts.length > 0 ? "ready" : "error",
        error: event.error,
      };

    case "ACCOUNT_UPDATED": {
      const accounts = state.accounts.map((a) => (a.id === event.account.id ? event.account : a));
      return {
        ...state,
        accounts,
        capacity: event.capacity ?? state.capacity,
        // Recomputed from the SERVER's rows, so the summary can never drift.
        needsAttention: accounts.filter(needsAttention).length,
      };
    }

    case "ACCOUNT_REMOVED": {
      const accounts = state.accounts.filter((a) => a.id !== event.accountId);
      if (accounts.length === state.accounts.length) return state;
      return { ...state, accounts, needsAttention: accounts.filter(needsAttention).length };
    }

    case "SET_FILTER":
      return state.filter === event.filter ? state : { ...state, filter: event.filter };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived views                                                               */
/* -------------------------------------------------------------------------- */

/** Apply the quick filter. Every predicate reads a bounded, server-supplied field. */
export function applyFilter(
  accounts: readonly ConnectedAccountItem[],
  filter: AccountFilter,
): ConnectedAccountItem[] {
  switch (filter) {
    case "attention": return accounts.filter(needsAttention);
    case "monitored": return accounts.filter((a) => a.monitoringEnabled);
    case "unmonitored": return accounts.filter((a) => !a.monitoringEnabled);
    default: return [...accounts];
  }
}

/** How many accounts each filter would show — drives the chip counts. */
export function filterCounts(accounts: readonly ConnectedAccountItem[]): Record<AccountFilter, number> {
  return {
    all: accounts.length,
    attention: accounts.filter(needsAttention).length,
    monitored: accounts.filter((a) => a.monitoringEnabled).length,
    unmonitored: accounts.filter((a) => !a.monitoringEnabled).length,
  };
}

export const isFirstLoad = (s: AccountsState): boolean => s.phase === "loading" && s.accounts.length === 0;
export const isRefreshing = (s: AccountsState): boolean => s.phase === "refreshing";
export const isBlockingError = (s: AccountsState): boolean => s.phase === "error" && s.accounts.length === 0;
export const isEmpty = (s: AccountsState): boolean =>
  s.phase === "ready" && s.accounts.length === 0 && s.error === null;
/** Empty only BECAUSE of the filter — a different message from "no accounts at all". */
export const isFilteredEmpty = (s: AccountsState): boolean =>
  s.phase === "ready" && s.accounts.length > 0 && applyFilter(s.accounts, s.filter).length === 0;
