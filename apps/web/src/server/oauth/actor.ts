import "server-only";
import type { Role } from "@guardora/core";

/**
 * M7 — the transport-neutral OAuth actor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE TAMANOR ACCOUNT, TWO TRANSPORTS.
 *
 * A web browser proves identity with an httpOnly cookie; a phone proves it with a
 * bearer header. Both resolve the SAME `UserSession` row, in the same table,
 * belonging to the same `User` and the same tenant `Membership`. There is no
 * mobile user, no mobile tenant, and no second membership truth — only two ways of
 * carrying the same opaque session token.
 *
 * This type is where that stops mattering. Once a request has produced an
 * `OAuthActor`, every downstream connector rule — brand validation, entitlement
 * limits, per-brand platform caps, token vault writes, account persistence, audit
 * — reads the same three fields and cannot tell which transport it came from.
 * `surface` exists only for audit metadata and for choosing where to redirect at
 * the end; it must never gate a permission or widen an authorization.
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface OAuthActor {
  userId: string;
  tenantId: string;
  role: Role;
  /** The originating `UserSession.id`. Never the raw session token. */
  sessionId: string;
  /** Which transport authenticated the request. Presentation and audit only. */
  surface: "web" | "mobile";
}

/** Shape shared by the web `AppSession` and the mobile `ResolvedSession`. */
interface SessionLike {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * Build an actor from an already-validated WEB cookie session.
 *
 * The caller has already run `requireSession()` / `getSession()`, so this performs
 * no authorization of its own — it is a pure projection.
 */
export function actorFromWebSession(session: SessionLike): OAuthActor {
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role as Role,
    sessionId: session.sessionId,
    surface: "web",
  };
}

/**
 * Build an actor from an already-validated MOBILE bearer session.
 *
 * Identical projection, from the identical `UserSession`. The only difference is
 * the `surface` label. If this function had to do anything more than relabel, the
 * two transports would have diverged — which is exactly what M7 forbids.
 */
export function actorFromMobileSession(session: SessionLike): OAuthActor {
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role as Role,
    sessionId: session.sessionId,
    surface: "mobile",
  };
}
