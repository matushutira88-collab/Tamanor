/**
 * M7 — native connector OAuth: start, status, options, select, cancel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE TAMANOR ACCOUNT, TWO TRANSPORTS.
 *
 * Every endpoint here authenticates with the SAME opaque `UserSession` the web
 * uses — carried as a bearer instead of a cookie. There is no mobile user, no
 * mobile tenant and no second membership truth, so `userId`, `tenantId` and `role`
 * always come from that validated session and never from the request.
 *
 * THE BROWSER IS NOT A TAMANOR CLIENT. The system auth browser only ever displays
 * the PROVIDER's authorization page. It is never asked to log in to Tamanor, is
 * never given a session, and carries no Tamanor credential — the provider callback
 * correlates back through the durable `ConnectorOAuthFlow` state instead.
 *
 * THE DEEP LINK IS NOT AUTHORITATIVE. `tamanor://oauth/callback?flow=…` carries a
 * correlation id and nothing else. Every claim about what happened comes from the
 * bearer-authenticated status endpoint below.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything is injected and this module imports no runtime value (types only), so
 * the whole lifecycle is unit-testable without a database, a provider or Next.
 */

import type { SessionRejectReason } from "@guardora/db";
import type { ShellSessionDeps } from "./mobile-shell";

/* -------------------------------------------------------------------------- */
/* Bounded vocabularies                                                        */
/* -------------------------------------------------------------------------- */

/** The two connectors this product has. */
export const OAUTH_PROVIDERS = ["meta", "google_business"] as const;
export type OAuthProviderKey = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_INTENTS = ["connect", "reconnect"] as const;
export type OAuthIntentKey = (typeof OAUTH_INTENTS)[number];

/**
 * Flow lifecycle.
 *
 * `selection_required` is a first-class state, never folded into `completed`: a
 * Meta authorization that discovered Pages, or a Google grant that discovered
 * locations, is genuinely authorized but is NOT yet a connected account. Saying
 * "completed" there would claim a connection that does not exist.
 */
export const OAUTH_STATUSES = [
  "pending", "provider_pending", "selection_required",
  "completed", "failed", "cancelled", "expired",
] as const;
export type OAuthStatusKey = (typeof OAUTH_STATUSES)[number];

/**
 * Bounded failure vocabulary. Raw provider text is mapped INTO this set and never
 * forwarded, so a Graph message or a Google error body cannot reach a phone.
 */
export const OAUTH_RESULT_CODES = [
  "user_cancelled", "invalid_state", "expired", "permission_denied",
  "account_limit_reached", "brand_platform_limit_reached", "provider_unavailable",
  "token_exchange_failed", "missing_permission", "no_accounts", "selection_required",
  "save_failed", "not_found", "session_invalid", "unknown",
] as const;
export type OAuthResultCode = (typeof OAUTH_RESULT_CODES)[number];

export type OAuthError =
  | "unauthenticated" | "session_expired" | "session_revoked"
  | "verification_required" | "workspace_unsupported"
  | "permission_denied" | "invalid_request" | "not_found"
  | "conflict" | "provider_unavailable" | "server_error";

export interface OAuthResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Wire DTOs                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Provider availability. Deliberately three booleans and nothing else — no client
 * id, no redirect URI, no scope list, no configuration detail. In this
 * server-driven architecture the phone never builds a provider URL, so it needs
 * none of that.
 */
export interface ProviderAvailabilityDto {
  provider: OAuthProviderKey;
  configured: boolean;
  available: boolean;
  /** Google only: whether Google has approved Business Profile API access. */
  approved: boolean;
}

export interface StartResponseDto {
  flowId: string;
  /**
   * The provider's authorization URL, built ENTIRELY server-side. It carries the
   * normal OAuth parameters — client_id, redirect_uri, scope, state — and never a
   * Tamanor bearer, session token or client secret.
   */
  authorizationUrl: string;
  expiresAt: string;
}

export interface FlowDto {
  id: string;
  provider: OAuthProviderKey;
  intent: OAuthIntentKey;
  status: OAuthStatusKey;
  expiresAt: string;
  resultCode: OAuthResultCode | null;
  accountId: string | null;
  selectionRequired: boolean;
}

/** One selectable provider asset. Contains no token and no provider credential. */
export interface SelectableOptionDto {
  /** The canonical selection value, `${platform}:${externalId}` for Meta. */
  id: string;
  displayName: string;
  /** `facebook_page` | `instagram_business` | `google_business`. */
  kind: string;
  /** Whether this asset is already connected in this tenant. */
  alreadyConnected: boolean;
  eligible: boolean;
  /** Bounded reason when `eligible` is false. */
  reason: string | null;
}

export interface OptionsResponseDto {
  flowId: string;
  provider: OAuthProviderKey;
  options: SelectableOptionDto[];
}

export interface SelectResponseDto {
  flowId: string;
  status: OAuthStatusKey;
  connected: number;
  monitored: number;
  /** Selections the plan's monitored-account limit refused. */
  limited: number;
  /** Selections a brand's platform slot refused. */
  slotTaken: number;
  /** Submitted ids matching no server asset. A COUNT — never the value. */
  rejected: number;
  accountIds: string[];
  resultCode: OAuthResultCode | null;
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

/** The flow record, exactly as the repository returns it. */
export interface FlowRecord {
  id: string;
  userId: string;
  tenantId: string;
  sessionId: string;
  surface: string;
  provider: string;
  intent: string;
  brandId: string | null;
  accountId: string | null;
  status: string;
  resultCode: string | null;
  resultAccountId: string | null;
  resultRefId: string | null;
  createdAt: Date;
  expiresAt: Date;
  stateConsumedAt: Date | null;
  completedAt: Date | null;
}

export interface OAuthDeps extends ShellSessionDeps {
  /** The canonical connector permission — not a mobile RBAC copy. */
  canManageConnectors: (role: string) => boolean;

  providerAvailability: () => ProviderAvailabilityDto[];

  /** Tenant-scoped brand lookup. A foreign brand reads back as null. */
  findBrand: (input: { tenantId: string; brandId: string }) => Promise<{ id: string } | null>;
  /** Tenant-scoped account lookup for reconnect. A foreign account reads back as null. */
  findAccount: (input: { tenantId: string; accountId: string }) => Promise<{
    id: string; brandId: string; platform: string;
  } | null>;
  /** The tenant's brands, for the connect target picker. */
  listBrands: (input: { tenantId: string }) => Promise<{ id: string; name: string }[]>;

  /** 32 random bytes, base64url. The RAW value; only its hash is ever stored. */
  generateState: () => string;
  hashState: (state: string) => string;
  createFlow: (input: {
    userId: string; tenantId: string; sessionId: string;
    provider: OAuthProviderKey; intent: OAuthIntentKey;
    brandId: string | null; accountId: string | null;
    stateHash: string; expiresAt: Date;
  }) => Promise<{ id: string }>;

  /** Build the provider authorization URL. Server-side only; needs the app secret's sibling config. */
  buildAuthorizationUrl: (input: {
    provider: OAuthProviderKey; state: string;
  }) => { ok: true; url: string } | { ok: false; reason: "not_configured" | "unavailable" };

  readFlow: (input: { tenantId: string; userId: string; flowId: string }) => Promise<FlowRecord | null>;
  finalizeFlow: (input: {
    tenantId: string; flowId: string;
    status: "completed" | "failed" | "cancelled";
    resultCode: OAuthResultCode | null;
    resultAccountId?: string | null;
  }) => Promise<boolean>;

  /** Bounded, token-free selectable assets for a flow in `selection_required`. */
  loadOptions: (input: { flow: FlowRecord }) => Promise<SelectableOptionDto[] | null>;
  /** Apply a selection through the canonical connector services. */
  applySelection: (input: {
    flow: FlowRecord;
    actorRole: string;
    selected: readonly string[];
  }) => Promise<{
    ok: boolean;
    code?: OAuthResultCode;
    connected: number; monitored: number; limited: number; slotTaken: number; rejected: number;
    accountIds: string[];
  }>;

  writeAudit: (input: {
    tenantId: string; userId: string; event: string;
    targetId: string; metadata: Record<string, unknown>;
  }) => Promise<void>;

  now?: () => Date;
}

/** Authorization lifetime — long enough for a real login, MFA and consent. */
export const OAUTH_TTL_MS = 10 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Bounded helpers                                                             */
/* -------------------------------------------------------------------------- */

function isMember<T extends string>(vocab: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (vocab as readonly string[]).includes(v);
}

/** Coerce to a bounded key or a fallback. Prototype-safe by construction. */
function bounded<T extends string>(vocab: readonly T[], v: unknown, fallback: T): T {
  return isMember(vocab, v) ? v : fallback;
}

/** Map a stored platform onto the provider that owns it. */
export function providerForPlatform(platform: string): OAuthProviderKey | null {
  if (platform === "facebook_page" || platform === "instagram_business") return "meta";
  if (platform === "google_business") return "google_business";
  return null;
}

/**
 * Derive the status the phone should see.
 *
 * Expiry is applied at READ time, not only by a sweeper: a flow whose window has
 * passed reports `expired` even if no job has touched the row, so a stale pending
 * flow can never look actionable.
 */
export function effectiveStatus(flow: FlowRecord, now: Date): OAuthStatusKey {
  const status = bounded(OAUTH_STATUSES, flow.status, "failed");
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  return flow.expiresAt.getTime() <= now.getTime() ? "expired" : status;
}

export function toFlowDto(flow: FlowRecord, now: Date): FlowDto {
  const status = effectiveStatus(flow, now);
  return {
    id: flow.id,
    provider: bounded(OAUTH_PROVIDERS, flow.provider, "meta"),
    intent: bounded(OAUTH_INTENTS, flow.intent, "connect"),
    status,
    expiresAt: flow.expiresAt.toISOString(),
    resultCode: isMember(OAUTH_RESULT_CODES, flow.resultCode) ? flow.resultCode : null,
    accountId: flow.resultAccountId,
    selectionRequired: status === "selection_required",
  };
}

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

function err(status: number, error: OAuthError): OAuthResponse {
  return { status, body: { error } };
}

interface OAuthSession {
  userId: string;
  tenantId: string;
  role: string;
  sessionId: string;
}
type Gate = { ok: true; session: OAuthSession } | { ok: false; response: OAuthResponse };

/**
 * The ONE read gate: bearer → validated `UserSession` → verified email → BUSINESS
 * workspace. Identical in substance to the web's cookie gate; only the transport
 * differs.
 */
export async function authorizeOAuthRead(
  authorization: string | null | undefined,
  deps: ShellSessionDeps,
): Promise<Gate> {
  const token = /^Bearer[ ]+(\S+)$/.exec((authorization ?? "").trim())?.[1] ?? null;
  if (!token) return { ok: false, response: err(401, "unauthenticated") };

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const reason: SessionRejectReason | undefined = result.reason;
    if (reason === "session_expired_idle") deps.emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") deps.emitOpsEvent("auth.session_expired_absolute", { reason });

    const mapped: OAuthError =
      reason === "session_expired" || reason === "session_expired_idle" || reason === "session_expired_absolute"
        ? "session_expired"
        : reason === "session_revoked" || reason === "password_changed"
          ? "session_revoked"
          : "unauthenticated";
    return { ok: false, response: err(401, mapped) };
  }

  const s = result.session;
  if (!s.emailVerified) return { ok: false, response: err(403, "verification_required") };
  if (deps.classifyWorkspace(s.workspaceKind) !== "business") {
    return { ok: false, response: err(403, "workspace_unsupported") };
  }
  return {
    ok: true,
    session: { userId: s.userId, tenantId: s.tenantId, role: s.role, sessionId: s.sessionId },
  };
}

/** The WRITE gate: the read gate plus the canonical `Permission.ConnectorManage`. */
async function authorizeOAuthWrite(
  authorization: string | null | undefined,
  deps: OAuthDeps,
): Promise<Gate> {
  const gate = await authorizeOAuthRead(authorization, deps);
  if (!gate.ok) return gate;
  if (!deps.canManageConnectors(gate.session.role)) {
    return { ok: false, response: err(403, "permission_denied") };
  }
  return gate;
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/oauth/providers                                             */
/* -------------------------------------------------------------------------- */

export async function handleOAuthProviders(
  req: { authorization: string | null | undefined },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const canManage = deps.canManageConnectors(gate.session.role);
  let brands: { id: string; name: string }[] = [];
  try {
    brands = await deps.listBrands({ tenantId: gate.session.tenantId });
  } catch {
    return err(500, "server_error");
  }

  return {
    status: 200,
    body: {
      // Availability only. No client id, no redirect URI, no scopes, no secret.
      providers: deps.providerAvailability(),
      // Connect targets, tenant-scoped. The id is a routing hint the start endpoint
      // re-validates; it is never authority.
      brands: brands.map((b) => ({ id: b.id, name: b.name })),
      canManageConnectors: canManage,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/oauth/start                                                */
/* -------------------------------------------------------------------------- */

export async function handleOAuthStart(
  req: { authorization: string | null | undefined; body: unknown },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;
  const { userId, tenantId, sessionId } = gate.session;
  const now = deps.now?.() ?? new Date();

  const raw = (req.body ?? {}) as { provider?: unknown; intent?: unknown; brandId?: unknown; accountId?: unknown };
  if (!isMember(OAUTH_PROVIDERS, raw.provider)) return err(400, "invalid_request");
  if (!isMember(OAUTH_INTENTS, raw.intent)) return err(400, "invalid_request");
  const intent = raw.intent;
  let provider: OAuthProviderKey = raw.provider;

  const availability = deps.providerAvailability().find((p) => p.provider === provider);
  if (!availability || !availability.available) return err(409, "provider_unavailable");

  let brandId: string | null = null;
  let accountId: string | null = null;

  try {
    if (intent === "reconnect") {
      // RECONNECT derives everything from the canonical account. A client-supplied
      // brandId or provider is ignored entirely — it is not even read.
      const id = typeof raw.accountId === "string" ? raw.accountId.trim() : "";
      if (!id) return err(400, "invalid_request");
      const account = await deps.findAccount({ tenantId, accountId: id });
      // A foreign account is indistinguishable from a missing one.
      if (!account) return err(404, "not_found");

      const derived = providerForPlatform(account.platform);
      if (!derived) return err(409, "provider_unavailable");
      // A mismatch between the requested provider and the account's real platform is
      // a rejection, not a silent correction.
      if (derived !== provider) return err(400, "invalid_request");
      provider = derived;
      accountId = account.id;
      brandId = account.brandId;
    } else {
      // CONNECT accepts a brand as a TARGET, then re-validates it against the
      // session's tenant. A foreign brand reads back as null under RLS.
      const id = typeof raw.brandId === "string" ? raw.brandId.trim() : "";
      if (!id) return err(400, "invalid_request");
      const brand = await deps.findBrand({ tenantId, brandId: id });
      if (!brand) return err(404, "not_found");
      brandId = brand.id;
    }
  } catch {
    return err(500, "server_error");
  }

  // The RAW state goes to the provider; only its hash is persisted.
  const state = deps.generateState();
  const stateHash = deps.hashState(state);
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS);

  const url = deps.buildAuthorizationUrl({ provider, state });
  if (!url.ok) return err(409, "provider_unavailable");

  let flow: { id: string };
  try {
    flow = await deps.createFlow({
      userId, tenantId, sessionId, provider, intent, brandId, accountId, stateHash, expiresAt,
    });
  } catch {
    return err(500, "server_error");
  }

  await deps.writeAudit({
    tenantId, userId,
    event: intent === "reconnect" ? "oauth.reconnect_started" : "oauth.started",
    targetId: accountId ?? `${provider}:${brandId ?? ""}`,
    // Bounded metadata only — no state, no hash, no URL, no token.
    metadata: { platform: provider, intent, surface: "mobile" },
  }).catch(() => {});

  const body: StartResponseDto = {
    flowId: flow.id,
    authorizationUrl: url.url,
    expiresAt: expiresAt.toISOString(),
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/oauth/flows/:flowId                                         */
/* -------------------------------------------------------------------------- */

/**
 * The authoritative answer to "what happened?".
 *
 * Ownership is checked on all three axes — user, tenant AND the originating
 * `UserSession` — so a different login of the same person, or another member of
 * the same tenant, gets `not_found` rather than a view of someone else's
 * authorization.
 */
export async function handleOAuthStatus(
  req: { authorization: string | null | undefined; flowId: string | null | undefined },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const flowId = req.flowId?.trim();
  if (!flowId) return err(400, "invalid_request");
  const now = deps.now?.() ?? new Date();

  let flow: FlowRecord | null;
  try {
    flow = await deps.readFlow({ tenantId: gate.session.tenantId, userId: gate.session.userId, flowId });
  } catch {
    return err(500, "server_error");
  }
  if (!flow) return err(404, "not_found");
  if (flow.tenantId !== gate.session.tenantId) return err(404, "not_found");
  if (flow.userId !== gate.session.userId) return err(404, "not_found");
  if (flow.sessionId !== gate.session.sessionId) return err(404, "not_found");

  return { status: 200, body: toFlowDto(flow, now) as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/oauth/flows/:flowId/options                                 */
/* -------------------------------------------------------------------------- */

export async function handleOAuthOptions(
  req: { authorization: string | null | undefined; flowId: string | null | undefined },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const flowId = req.flowId?.trim();
  if (!flowId) return err(400, "invalid_request");
  const now = deps.now?.() ?? new Date();

  let flow: FlowRecord | null;
  try {
    flow = await deps.readFlow({ tenantId: gate.session.tenantId, userId: gate.session.userId, flowId });
  } catch {
    return err(500, "server_error");
  }
  if (!flow || flow.sessionId !== gate.session.sessionId) return err(404, "not_found");

  const status = effectiveStatus(flow, now);
  // Options exist only while a selection is genuinely outstanding.
  if (status !== "selection_required") return err(409, "conflict");

  let options: SelectableOptionDto[] | null;
  try {
    options = await deps.loadOptions({ flow });
  } catch {
    return err(500, "server_error");
  }
  if (!options) return err(404, "not_found");

  const body: OptionsResponseDto = {
    flowId: flow.id,
    provider: bounded(OAUTH_PROVIDERS, flow.provider, "meta"),
    options,
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/oauth/flows/:flowId/select                                 */
/* -------------------------------------------------------------------------- */

/** A generous but finite cap, so a malicious body cannot become a workload. */
const MAX_SELECTION = 100;

export async function handleOAuthSelect(
  req: { authorization: string | null | undefined; flowId: string | null | undefined; body: unknown },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const flowId = req.flowId?.trim();
  if (!flowId) return err(400, "invalid_request");
  const now = deps.now?.() ?? new Date();

  const raw = (req.body ?? {}) as { selected?: unknown };
  if (!Array.isArray(raw.selected)) return err(400, "invalid_request");
  const selected = raw.selected
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_SELECTION);
  if (selected.length === 0) return err(400, "invalid_request");

  let flow: FlowRecord | null;
  try {
    flow = await deps.readFlow({ tenantId: gate.session.tenantId, userId: gate.session.userId, flowId });
  } catch {
    return err(500, "server_error");
  }
  if (!flow || flow.sessionId !== gate.session.sessionId) return err(404, "not_found");

  const status = effectiveStatus(flow, now);
  // A second submit after the first completed finds a terminal flow and is refused,
  // rather than importing the same assets twice.
  if (status !== "selection_required") return err(409, "conflict");

  let result: Awaited<ReturnType<OAuthDeps["applySelection"]>>;
  try {
    result = await deps.applySelection({ flow, actorRole: gate.session.role, selected });
  } catch {
    await deps.finalizeFlow({
      tenantId: flow.tenantId, flowId: flow.id, status: "failed", resultCode: "save_failed",
    }).catch(() => {});
    return err(500, "server_error");
  }

  if (!result.ok) {
    const code = result.code ?? "save_failed";
    await deps.finalizeFlow({
      tenantId: flow.tenantId, flowId: flow.id, status: "failed", resultCode: code,
    }).catch(() => {});
    const body: SelectResponseDto = {
      flowId: flow.id, status: "failed",
      connected: 0, monitored: 0, limited: 0, slotTaken: 0, rejected: result.rejected,
      accountIds: [], resultCode: code,
    };
    return { status: 200, body: body as unknown as Record<string, unknown> };
  }

  // Nothing landed: report the truthful bounded reason rather than "completed".
  const nothingConnected = result.connected === 0;
  const code: OAuthResultCode | null =
    nothingConnected && result.slotTaken > 0 ? "brand_platform_limit_reached"
      : nothingConnected && result.limited > 0 ? "account_limit_reached"
        : nothingConnected ? "no_accounts"
          : null;

  await deps.finalizeFlow({
    tenantId: flow.tenantId, flowId: flow.id,
    status: nothingConnected ? "failed" : "completed",
    resultCode: code,
    resultAccountId: result.accountIds[0] ?? null,
  }).catch(() => {});

  await deps.writeAudit({
    tenantId: flow.tenantId, userId: gate.session.userId,
    event: nothingConnected ? "oauth.failed" : "oauth.completed",
    targetId: flow.id,
    metadata: {
      platform: flow.provider, intent: flow.intent, surface: "mobile",
      connected: result.connected, monitored: result.monitored,
      limited: result.limited, slotTaken: result.slotTaken, rejected: result.rejected,
    },
  }).catch(() => {});

  const body: SelectResponseDto = {
    flowId: flow.id,
    status: nothingConnected ? "failed" : "completed",
    connected: result.connected,
    monitored: result.monitored,
    limited: result.limited,
    slotTaken: result.slotTaken,
    rejected: result.rejected,
    accountIds: result.accountIds,
    resultCode: code,
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/oauth/flows/:flowId/cancel                                 */
/* -------------------------------------------------------------------------- */

/**
 * Record that the user dismissed the auth browser.
 *
 * The transition is server-authoritative and one-way: `finalizeFlow` only matches a
 * non-terminal row, so a provider callback that lands AFTER a cancel finds a
 * terminal flow and is refused — a late success can never resurrect a cancelled
 * authorization.
 */
export async function handleOAuthCancel(
  req: { authorization: string | null | undefined; flowId: string | null | undefined },
  deps: OAuthDeps,
): Promise<OAuthResponse> {
  const gate = await authorizeOAuthWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const flowId = req.flowId?.trim();
  if (!flowId) return err(400, "invalid_request");
  const now = deps.now?.() ?? new Date();

  let flow: FlowRecord | null;
  try {
    flow = await deps.readFlow({ tenantId: gate.session.tenantId, userId: gate.session.userId, flowId });
  } catch {
    return err(500, "server_error");
  }
  if (!flow || flow.sessionId !== gate.session.sessionId) return err(404, "not_found");

  await deps.finalizeFlow({
    tenantId: flow.tenantId, flowId: flow.id, status: "cancelled", resultCode: "user_cancelled",
  }).catch(() => {});

  // Re-read so the reply is the SERVER's resulting state, not the requested one —
  // cancelling an already-completed flow truthfully reports `completed`.
  let fresh: FlowRecord | null = null;
  try {
    fresh = await deps.readFlow({ tenantId: gate.session.tenantId, userId: gate.session.userId, flowId });
  } catch { /* fall through to the pre-cancel view */ }

  return {
    status: 200,
    body: toFlowDto(fresh ?? flow, now) as unknown as Record<string, unknown>,
  };
}
