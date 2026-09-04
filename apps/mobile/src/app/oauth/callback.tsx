/**
 * `tamanor://oauth/callback` — the route the OAuth return URL actually lands on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE EXISTS (M10B)
 *
 * The return URL has two independent readers, and before M10B only one was wired:
 *
 *   1. `useOAuthFlow` hears the URL and treats it as a DOORBELL — it takes the
 *      flow id and asks the authenticated status endpoint what really happened.
 *
 *   2. Expo Router ALSO reads the same URL as a navigation intent. `oauth/callback`
 *      matched no route, so a WARM return fell through to `+not-found`, and a COLD
 *      return had no declared destination at all. Proven on a real development
 *      build: the status read returned a correct 404 for an unknown flow while the
 *      user was simultaneously dumped on a dead end.
 *
 * So the URL now resolves to a real screen, declared in the ROOT stack so it can
 * render in every auth state rather than only inside a group the boot gate hides.
 *
 * ITS ROLE AFTER M10C. Continuation no longer depends on this route being reached.
 * M10C measured why the router never navigates here — its linking prefix is
 * `tamanor:///` (empty host) while the real return URL `tamanor://oauth/callback`
 * puts `oauth` in the host — so `useOAuthReturnHandoff` captures the flow id from
 * the deep-link layer and navigates itself.
 *
 * This route is kept as the FALLBACK, and deliberately so: it is what guarantees a
 * valid callback can never fall to `+not-found` if the router's matching ever
 * changes. It is not a second continuation — it resolves auth by the same rules and
 * lands on the same canonical Connect surface with the same single `flow` param, so
 * whichever path runs, exactly one controller resolves exactly one flow.
 *
 * THIS ROUTE IS A DISPATCHER, NOT AN AUTHORITY.
 *
 * It reads exactly one thing from the URL — `flow` — and only after shape-checking
 * it with the same `isValidFlowId` the deep-link parser uses. It cannot read a
 * result: there is no `success`, `status`, `error`, `code`, `state`, `token` or
 * account parameter anywhere in this file, so a spoofed link carries no claim.
 * The flow id is a correlation reference; the server's authenticated status
 * response stays the only source of truth, exactly as M7 requires.
 *
 * AUTH IS RESOLVED BEFORE ROUTING.
 *   - booting                → hold. Never guess a destination mid-boot, and never
 *                              bypass the M2 gate.
 *   - authenticated          → hand the id to the canonical Connect surface, which
 *                              owns `useOAuthFlow`. No second state machine.
 *   - anything else          → DISCARD the id and send the arrival to the canonical
 *                              screen for that auth state (login / verify-email /
 *                              unsupported-workspace), mirroring the `(auth)` guards.
 *
 * Discarding is deliberate and fails closed. `ConnectorOAuthFlow` is bound to the
 * originating `sessionId`, so a flow started by a session that is now gone must
 * NOT be inherited by whoever logs in next. Carrying the id across a login would
 * invite exactly that. The server would reject it anyway — this simply refuses to
 * ask the question.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

import { canEnterApp, isBooting } from '@/auth/auth-machine';
import { useAuth } from '@/auth/auth-provider';
import { isValidFlowId } from '@/oauth/deep-link';
import { Loading, Screen } from '@/components/ui';
import { t } from '@/i18n';

export default function OAuthCallbackRoute() {
  const { state } = useAuth();
  // `useLocalSearchParams` yields string[] for a repeated key (`?flow=A&flow=B`).
  // `isValidFlowId` rejects anything that is not a single well-formed string, so a
  // duplicated, empty, missing or oversized value all land on the same safe path.
  const { flow } = useLocalSearchParams<{ flow?: string | string[] }>();
  const flowId = isValidFlowId(flow) ? flow.trim() : null;

  // The session is still being validated. Hold — the destination depends on the
  // answer, and the M2 boot gate is not something a deep link may skip.
  if (isBooting(state)) {
    return (
      <Screen centered>
        <Loading label={t.common.loading} />
      </Screen>
    );
  }

  // Not signed in (or expired / unverified / unsupported workspace). Drop the flow
  // reference and hand over to the canonical destination for that state.
  //
  // The target mirrors the `(auth)` group's own guards exactly. It cannot be a blanket
  // `/` — that resolves inside `(app)`, which is hidden while signed out, so the arrival
  // rendered nothing at all (observed: a blank screen on a logged-out cold start).
  if (!canEnterApp(state)) {
    if (state.status === 'verification_required') return <Redirect href="/verify-email" />;
    if (state.status === 'workspace_unsupported') return <Redirect href="/unsupported-workspace" />;
    return <Redirect href="/login" />;
  }

  // Signed in. Hand the correlation id to the screen that owns the OAuth
  // controller; a malformed or absent id simply opens Connect with nothing to
  // resume, which is the correct no-op.
  return (
    <Redirect href={flowId ? { pathname: '/accounts/connect', params: { flow: flowId } } : '/accounts/connect'} />
  );
}
