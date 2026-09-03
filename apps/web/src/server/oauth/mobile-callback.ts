import "server-only";
import {
  consumeConnectorOAuthState, hashOAuthState, originatingSessionIsValid,
  updateConnectorOAuthFlow, finalizeConnectorOAuthFlow,
  type ConnectorOAuthFlowRecord,
} from "@guardora/db";
import type { OAuthActor } from "./actor";

/**
 * M7 — the mobile branch of the existing provider callbacks.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW A CALLBACK KNOWS WHOSE IT IS, WITH NO COOKIE.
 *
 * A provider callback arrives carrying only `code` and `state`. For a web flow the
 * actor is recovered from `tamanor_session`; for a mobile flow there is no cookie
 * at all, and manufacturing one would leak a credential. So the callback hashes
 * the state it received and looks for a `ConnectorOAuthFlow` — the row created,
 * server-side, when the authenticated phone started the authorization.
 *
 * The lookup ATOMICALLY consumes the state in the same statement, so it is also
 * the replay guard: a second delivery of the same callback finds `stateConsumedAt`
 * already set and is refused.
 *
 * THE ORDER MATTERS. `tryResolveMobileFlow` runs BEFORE the web session is read.
 * A web state is a `randomUUID` that was never written to this table, so it simply
 * finds nothing and the caller falls through to the untouched web path. No web
 * behaviour changes.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * NOTHING SENSITIVE LEAVES. The completion redirect carries a flow id and nothing
 * else — no code, no state, no token, no user id, no tenant id, no provider text.
 */

/** The app's deep-link scheme, matching `expo.scheme` in app.json. */
export const MOBILE_SCHEME = "tamanor";

/**
 * The completion deep link.
 *
 * Deliberately just a correlation id. It is a WAKE-UP SIGNAL — the app must ask the
 * authenticated status endpoint what actually happened, because anything encoded
 * here could be forged by any app able to send the scheme.
 */
export function mobileCallbackUrl(flowId: string): string {
  return `${MOBILE_SCHEME}://oauth/callback?flow=${encodeURIComponent(flowId)}`;
}

export type MobileFlowResolution =
  | { kind: "not_mobile" }
  | { kind: "resolved"; flow: ConnectorOAuthFlowRecord; actor: OAuthActor }
  /** `flowId` lets a rejection still deep-link the app home to read the truth. */
  | { kind: "rejected"; flowId: string | null; code: MobileCallbackFailure };

/** Bounded callback failures. Never provider text. */
export type MobileCallbackFailure =
  | "invalid_state" | "expired" | "session_invalid" | "user_cancelled"
  | "token_exchange_failed" | "no_accounts" | "missing_permission"
  | "provider_unavailable" | "save_failed" | "unknown";

/**
 * Try to resolve a MOBILE flow from the provider's `state`.
 *
 * Returns `not_mobile` when the state matches no flow — which is exactly what a
 * normal web callback does, so the caller continues down its existing path.
 */
export async function tryResolveMobileFlow(input: {
  rawState: string | null | undefined;
  /** The provider the callback belongs to, so a Meta state cannot drive Google. */
  provider: "meta" | "google_business";
  now?: Date;
}): Promise<MobileFlowResolution> {
  const raw = input.rawState?.trim();
  if (!raw) return { kind: "not_mobile" };
  const now = input.now ?? new Date();

  const consumed = await consumeConnectorOAuthState(hashOAuthState(raw), now);
  if (!consumed.ok) {
    // `not_found` is the normal web case: that state was never one of ours.
    if (consumed.reason === "not_found") return { kind: "not_mobile" };
    return {
      kind: "rejected",
      flowId: consumed.flowId,
      code: consumed.reason === "expired" ? "expired" : "invalid_state",
    };
  }

  const flow = consumed.flow;

  // A Meta state must not be redeemable at the Google callback, or vice versa.
  if (flow.provider !== input.provider) {
    await finalizeConnectorOAuthFlow({
      tenantId: flow.tenantId, flowId: flow.id, status: "failed", resultCode: "invalid_state",
    }).catch(() => {});
    return { kind: "rejected", flowId: flow.id, code: "invalid_state" };
  }

  // A web-surface flow (if the web ever adopts this table) is not our branch.
  if (flow.surface !== "mobile") return { kind: "not_mobile" };

  // The originating login must still be usable. A logout revokes the session row,
  // so an authorization started before a logout fails closed here — the raw session
  // token is deliberately not stored, and this is the strongest test available
  // without it.
  if (!(await originatingSessionIsValid(flow.sessionId, now))) {
    await finalizeConnectorOAuthFlow({
      tenantId: flow.tenantId, flowId: flow.id, status: "failed", resultCode: "session_invalid",
    }).catch(() => {});
    return { kind: "rejected", flowId: flow.id, code: "session_invalid" };
  }

  return {
    kind: "resolved",
    flow,
    actor: {
      // Identity comes from the STORED flow, never from anything the browser sent.
      userId: flow.userId,
      tenantId: flow.tenantId,
      role: "" as OAuthActor["role"], // filled by the caller from the membership
      sessionId: flow.sessionId,
      surface: "mobile",
    },
  };
}

/** Mark a mobile flow as awaiting the user's native selection. */
export async function markSelectionRequired(input: {
  flow: ConnectorOAuthFlowRecord;
  /** The canonical follow-up record (e.g. the MetaOnboardingSession). Never a token. */
  resultRefId: string | null;
}): Promise<void> {
  await updateConnectorOAuthFlow({
    tenantId: input.flow.tenantId,
    flowId: input.flow.id,
    status: "selection_required",
    resultCode: null,
    resultRefId: input.resultRefId,
  });
}

/** Terminate a mobile flow with a bounded code. Never overwrites a terminal state. */
export async function failMobileFlow(
  flow: ConnectorOAuthFlowRecord,
  code: MobileCallbackFailure,
): Promise<void> {
  await finalizeConnectorOAuthFlow({
    tenantId: flow.tenantId, flowId: flow.id, status: "failed", resultCode: code,
  }).catch(() => {});
}
