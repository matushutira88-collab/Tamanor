/**
 * M6 — native Accounts: list, detail, monitoring, manual read-only sync, disconnect.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE FOUR SEPARATE TRUTHS. The defining property of this module.
 *
 *   CONNECTION HEALTH  ≠  MONITORING  ≠  AUTO-SYNC  ≠  PROVIDER ACTION CAPABILITY
 *
 * They travel as four independent fields and are never combined into one "Active".
 * A connected account with monitoring off and auto-sync running is representable;
 * so is a reconnect-required account whose monitoring is on. Nothing here may
 * collapse them, and `connectionState` is the ONLY field allowed to drive green.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PROVIDER-WRITE BOUNDARY. Mobile can start exactly one provider operation: a
 * READ-ONLY sync, through the canonical `runReadOnlySync`. There is no hide, no
 * delete, no reply, no moderation, and no kill-switch mutation. Disconnect goes
 * through the canonical `disconnectAccount` — this module never nulls a token
 * column itself.
 *
 * TOKEN BOUNDARY. No token, partial token, refresh token, vault id or provider
 * auth header is representable in any DTO here. Only a bounded `tokenHealth`
 * presentation key crosses the wire.
 *
 * Everything is injected and this module imports no runtime value (types only), so
 * the whole lifecycle is unit-testable without a database, a provider or Next.
 */

import type { SessionRejectReason } from "@guardora/db";
import type { ShellSessionDeps } from "./mobile-shell";

/* -------------------------------------------------------------------------- */
/* Bounded vocabularies — the canonical enums, nothing invented                */
/* -------------------------------------------------------------------------- */

/** Canonical `ConnectionState` (@guardora/core connection-state.ts). */
export const CONNECTION_STATES = [
  "CONNECTED_HEALTHY", "WAITING_FIRST_SYNC", "DEGRADED",
  "REAUTH_REQUIRED", "SYNC_FAILED", "DISCONNECTED",
] as const;
export type ConnectionStateKey = (typeof CONNECTION_STATES)[number];

/** Canonical `AutoSyncState`. */
export const AUTO_SYNC_STATES = [
  "ENABLED_HEALTHY", "ENABLED_DEGRADED", "ENABLED_REAUTH_REQUIRED",
  "DISABLED", "NOT_CONFIGURED",
] as const;
export type AutoSyncStateKey = (typeof AUTO_SYNC_STATES)[number];

/** Canonical `FirstSyncState` (@guardora/core sync-state.ts). */
export const FIRST_SYNC_STATES = ["waiting_first_sync", "syncing", "synced", "failed"] as const;
export type FirstSyncStateKey = (typeof FIRST_SYNC_STATES)[number];

/** Canonical `DashboardAccountRow.accountKind`. */
export const ACCOUNT_KINDS = ["real", "read_only", "test"] as const;
export type AccountKindKey = (typeof ACCOUNT_KINDS)[number];

/** Canonical `Platform` enum values. An unrecognized platform becomes `unknown`. */
export const PLATFORM_KEYS = [
  "facebook_page", "instagram_business", "youtube",
  "linkedin_company", "tiktok", "google_business", "unknown",
] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/**
 * `ConnectedAccount.tokenHealth` presentation. This is the ONLY token-derived value
 * that may cross the wire — never a token, a fragment of one, or an expiry the
 * product does not already show.
 */
export const TOKEN_HEALTHS = ["unknown", "ok", "expiring_soon", "expired", "invalid", "revoked"] as const;
export type TokenHealthKey = (typeof TOKEN_HEALTHS)[number];

/**
 * Bounded reconnect / failure reasons. Raw `lastError`, `requiresReconnectReason`
 * and any provider error body are mapped INTO this set; anything unrecognized
 * becomes `unknown`, so an internal or provider string can never reach a customer.
 */
export const ACCOUNT_REASONS = [
  "token_expired", "permission_missing", "provider_unavailable", "rate_limited",
  "sync_failed", "reconnect_required", "no_token", "disconnected",
  "credential_persist_failed", "instagram_disconnected", "account_not_discoverable",
  "unknown",
] as const;
export type AccountReasonKey = (typeof ACCOUNT_REASONS)[number];

/** Bounded `SyncRunStatus`. */
export const SYNC_RUN_STATUSES = [
  "running", "completed", "failed", "partial_success", "skipped_locked",
  "disconnected", "permission_missing", "rate_limited", "api_unavailable", "interrupted",
] as const;
export type SyncRunStatusKey = (typeof SYNC_RUN_STATUSES)[number];

/**
 * A capability's truthful availability. `not_implemented` and `requires_web` are
 * distinct on purpose: the first means Tamanor does not do it at all, the second
 * means it exists but cannot be driven from the phone yet.
 */
export const CAPABILITY_STATES = [
  "available", "unavailable", "not_implemented", "not_configured",
  "missing_permission", "requires_web", "blocked_by_safety",
] as const;
export type CapabilityStateKey = (typeof CAPABILITY_STATES)[number];

/** Bounded outcome of a manual sync request. */
export const SYNC_RESULTS = [
  "started", "already_running", "reconnect_required", "not_supported", "not_found",
] as const;
export type SyncResultKey = (typeof SYNC_RESULTS)[number];

/** Bounded provider-revocation classification from the canonical disconnect service. */
export const REVOKE_RESULTS = ["revoked", "unsupported", "already_invalid", "failed"] as const;
export type RevokeResultKey = (typeof REVOKE_RESULTS)[number];

export type AccountsError =
  | "unauthenticated" | "session_expired" | "session_revoked"
  | "verification_required" | "workspace_unsupported"
  | "permission_denied" | "account_limit_reached"
  | "invalid_request" | "not_found" | "conflict" | "server_error";

export interface AccountsResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Wire DTOs                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One connected account as the phone sees it.
 *
 * The four truths are the four separate fields `connectionState`, `monitoringEnabled`,
 * `autoSyncState` and `capabilities` — deliberately not merged, not ordered by
 * precedence, and not summarized into a single status.
 */
export interface AccountDto {
  id: string;
  platform: PlatformKey;
  /** Display label for the platform. Never derived by a two-way conditional. */
  platformLabel: string;
  name: string | null;
  username: string | null;
  accountKind: AccountKindKey;

  /** TRUTH 1 — the canonical connection resolver's verdict. Only this may be green. */
  connectionState: ConnectionStateKey;
  needsReconnect: boolean;
  /** Bounded reason for a reconnect / failure, when the server knows one. */
  reason: AccountReasonKey | null;

  /** TRUTH 2 — does Tamanor monitor this account. Independent of the connection. */
  monitoringEnabled: boolean;
  /** Whether the plan currently allows turning monitoring ON. A UX hint only. */
  monitoringCanBeEnabled: boolean;

  /** TRUTH 3 — automatic synchronization. */
  autoSyncState: AutoSyncStateKey;
  firstSyncState: FirstSyncStateKey;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;

  commentsToday: number;
  riskToday: number;

  /** TRUTH 4 — what may actually be done. Presentation; the server re-checks all of it. */
  capabilities: AccountCapabilitiesDto;
  /** Whether this ROLE may manage connectors at all. A UX hint only. */
  canManage: boolean;
}

export interface AccountCapabilitiesDto {
  canRead: CapabilityStateKey;
  canSync: CapabilityStateKey;
  canMonitor: CapabilityStateKey;
  canReconnect: CapabilityStateKey;
  canDisconnect: CapabilityStateKey;
  /** Moderation and reply are reported truthfully — M6 adds neither. */
  moderationState: CapabilityStateKey;
  replyState: CapabilityStateKey;
}

export interface CapacityDto {
  used: number;
  /** `-1` means unlimited (the canonical overview's convention). */
  limit: number;
  remaining: number;
  monitored: number;
}

export interface AccountsListResponse {
  accounts: AccountDto[];
  capacity: CapacityDto;
  capabilities: { canManageConnectors: boolean };
  /** Accounts whose connection is not healthy — the "needs attention" summary. */
  needsAttention: number;
}

export interface SyncRunDto {
  id: string;
  status: SyncRunStatusKey;
  startedAt: string;
  finishedAt: string | null;
  /** Bounded counts only — never a provider body, cursor or exception. */
  fetched: number;
  created: number;
  /** Normalized failure reason. The raw `error` column never travels. */
  reason: AccountReasonKey | null;
  /** Whether the run used demo data — already customer-visible on the web. */
  demo: boolean;
}

export interface AccountDetailDto extends AccountDto {
  /** Bounded token PRESENTATION. Never a token or any part of one. */
  tokenHealth: TokenHealthKey;
  /** Only when the product already shows it (the web detail page does). */
  tokenExpiresAt: string | null;
  lastSuccessfulProviderCheckAt: string | null;
  /** Display-only: protection actions paused. M6 exposes no mutation for it. */
  protectionPaused: boolean;
  brandName: string | null;
  syncRuns: SyncRunDto[];
}

export interface AccountDetailResponse {
  account: AccountDetailDto;
  capacity: CapacityDto;
  capabilities: { canManageConnectors: boolean };
}

export interface MonitoringResponse {
  account: AccountDto;
  capacity: CapacityDto;
}

export interface SyncResponse {
  result: SyncResultKey;
}

export interface DisconnectResponse {
  disconnected: boolean;
  /** How many local accounts shared these credentials. A COUNT, never ids. */
  clusterCount: number;
  clusterPlatforms: PlatformKey[];
  providerRevoke: RevokeResultKey;
  manualCleanupRecommended: boolean;
}

/* -------------------------------------------------------------------------- */
/* Source rows — exactly what the canonical services already return            */
/* -------------------------------------------------------------------------- */

/** Mirrors `DashboardAccountRow` from `getDashboardAccountsOverview`. */
export interface AccountSourceRow {
  id: string;
  platform: string;
  name: string | null;
  username: string | null;
  monitoringEnabled: boolean;
  monitoringCanBeEnabled: boolean;
  connectionState: string;
  autoSyncState: string;
  reconnectRequired: boolean;
  commentsToday: number;
  riskToday: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  accountKind: string;
  /** From `deriveFirstSyncState` — the resolver needs the active-lease set. */
  firstSyncState: string;
  /** Raw classification inputs, normalized here and never forwarded verbatim. */
  lastError: string | null;
  requiresReconnectReason: string | null;
  /** Granted provider permissions, used only for capability presentation. */
  grantedPermissions: string[];
}

export interface AccountsSource {
  rows: AccountSourceRow[];
  capacity: { used: number; limit: number; remaining: number };
  monitored: number;
}

export interface AccountDetailSource extends AccountSourceRow {
  tokenHealth: string;
  tokenExpiresAt: Date | null;
  lastSuccessfulGraphCheckAt: Date | null;
  killSwitch: boolean;
  globalKillSwitch: boolean;
  brandName: string | null;
  syncRuns: {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    fetched: number;
    created: number;
    error: string | null;
    mock: boolean;
  }[];
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

export interface AccountsDeps extends ShellSessionDeps {
  /** The canonical connector-management permission — not a mobile RBAC copy. */
  canManageConnectors: (role: string) => boolean;

  listAccounts: (input: { tenantId: string }) => Promise<AccountsSource>;
  getAccount: (input: { tenantId: string; accountId: string }) => Promise<AccountDetailSource | null>;
  /** Re-reads ONE account through the same canonical projection as the list. */
  getAccountRow: (input: { tenantId: string; accountId: string }) => Promise<AccountSourceRow | null>;
  getCapacity: (input: { tenantId: string }) => Promise<{ used: number; limit: number; remaining: number; monitored: number }>;

  /** Canonical `enableAccountMonitoringWithinLimit` — ATOMIC against the plan limit. */
  enableMonitoring: (input: { tenantId: string; accountId: string }) => Promise<{ ok: true } | { ok: false; reason: "account_limit_reached" }>;
  /** Canonical `setAccountMonitoring(..., false)`. Returns rows affected. */
  disableMonitoring: (input: { tenantId: string; accountId: string }) => Promise<number>;

  /** Schedules the canonical READ-ONLY sync. Must not block on the provider. */
  startReadOnlySync: (input: { tenantId: string; accountId: string }) => void;
  /** True when a sync lease for this account is currently held. */
  hasActiveSyncLease: (input: { tenantId: string; accountId: string }) => Promise<boolean>;

  /** Canonical `disconnectAccount`. This module never nulls a token column itself. */
  disconnectAccount: (input: { tenantId: string; accountId: string }) => Promise<{
    found: boolean;
    clusterCount: number;
    clusterPlatforms: string[];
    providerRevoke: string;
    manualCleanupRecommended: boolean;
  }>;

  writeAudit: (input: {
    tenantId: string; userId: string; event: string;
    targetId: string; metadata: Record<string, unknown>;
  }) => Promise<void>;

  now?: () => Date;
}

/* -------------------------------------------------------------------------- */
/* Bounded normalization                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Own-property membership test.
 *
 * M4, M5 and M6 all found prototype-lookup bugs from `Record<string, X>[key]`, so
 * every vocabulary check in this file goes through here. `__proto__` and
 * `constructor` are ordinary unknown values, not inherited members.
 */
function isMember<T extends string>(vocab: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (vocab as readonly string[]).includes(value);
}

/** Coerce to a bounded key, or the given fallback. Never returns an unbounded string. */
function bounded<T extends string>(vocab: readonly T[], value: unknown, fallback: T): T {
  return isMember(vocab, value) ? value : fallback;
}

/**
 * Platform normalization. There is deliberately NO two-way conditional here: an
 * unrecognized platform becomes the explicit `unknown` key with a generic label,
 * never "Facebook".
 */
export function normalizePlatform(raw: unknown): PlatformKey {
  return bounded(PLATFORM_KEYS, raw, "unknown");
}

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  facebook_page: "Facebook Page",
  instagram_business: "Instagram Business",
  youtube: "YouTube",
  linkedin_company: "LinkedIn Company Page",
  tiktok: "TikTok",
  google_business: "Google Business Profile",
  unknown: "Connected account",
};

/** Label for a platform. Mirrors `PLATFORM_META[...].label`; `unknown` is generic. */
export function platformLabelFor(key: PlatformKey): string {
  return PLATFORM_LABELS[key];
}

/**
 * Map a raw failure/reconnect classification onto the bounded reason vocabulary.
 *
 * `lastError`, `requiresReconnectReason` and a `SyncRun.error` are all internal
 * strings that may carry provider wording, ids or unstable text, so none of them is
 * ever forwarded. An unrecognized value is `unknown`, not the value itself.
 */
export function normalizeReason(raw: unknown): AccountReasonKey | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (isMember(ACCOUNT_REASONS, raw)) return raw;
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* Capability resolution — truthful, per platform and per mode                 */
/* -------------------------------------------------------------------------- */

/**
 * Read-only ingestion is wired for Meta only.
 *
 * `runReadOnlySync` gates on `getMetaConfig()`/`META_LIVE_SYNC` and drives the Meta
 * content transport, so a Google Business location — which IS a real
 * `ConnectedAccount` row, imported by `importGoogleBusinessLocation` — has no sync
 * implementation behind it. Reporting `canSync: "available"` for it would be a lie
 * and would fire a doomed provider request, so Google Business reports
 * `requires_web` and the sync endpoint refuses with `not_supported`.
 */
const SYNC_IMPLEMENTED_PLATFORMS: readonly PlatformKey[] = ["facebook_page", "instagram_business"];

/** The Meta permission that gates hiding. Mirrors the web detail page's matrix. */
const HIDE_PERMISSION = "pages_manage_engagement";

export function resolveCapabilities(input: {
  platform: PlatformKey;
  connectionState: ConnectionStateKey;
  accountKind: AccountKindKey;
  grantedPermissions: readonly string[];
  canManage: boolean;
}): AccountCapabilitiesDto {
  const { platform, connectionState, accountKind, grantedPermissions, canManage } = input;
  const disconnected = connectionState === "DISCONNECTED";
  const needsReauth = connectionState === "REAUTH_REQUIRED";

  // Reading is what Tamanor does with every connected account.
  const canRead: CapabilityStateKey = disconnected ? "unavailable" : "available";

  // Manual sync: implemented for Meta only, blocked by the canonical resolver's
  // reconnect/disconnect verdict, and gated on the connector-manage permission.
  const syncImplemented = SYNC_IMPLEMENTED_PLATFORMS.includes(platform);
  const canSync: CapabilityStateKey =
    !syncImplemented ? "requires_web"
      : disconnected || needsReauth ? "unavailable"
        : !canManage ? "missing_permission"
          : "available";

  const canMonitor: CapabilityStateKey =
    disconnected ? "unavailable" : !canManage ? "missing_permission" : "available";

  // Reconnect and disconnect always run through the web connector flow for connect;
  // disconnect itself is a first-class mobile action.
  const canReconnect: CapabilityStateKey = !canManage ? "missing_permission" : "requires_web";
  const canDisconnect: CapabilityStateKey =
    disconnected ? "unavailable" : !canManage ? "missing_permission" : "available";

  // Moderation. `modeAllowsActions` is false for EVERY ConnectorMode in this product,
  // so no account can act — and M6 adds no moderation surface regardless. Facebook
  // additionally needs the engagement permission before hiding is even conceivable.
  const moderationState: CapabilityStateKey =
    // A demo/placeholder connection has no provider behind it at all.
    accountKind === "test" ? "unavailable"
      : platform !== "facebook_page" ? "not_implemented"
        : !grantedPermissions.includes(HIDE_PERMISSION) ? "missing_permission"
          : "requires_web";

  // Replying is not implemented anywhere in the product.
  const replyState: CapabilityStateKey = "not_implemented";

  return { canRead, canSync, canMonitor, canReconnect, canDisconnect, moderationState, replyState };
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toAccountDto(row: AccountSourceRow, canManage: boolean): AccountDto {
  const platform = normalizePlatform(row.platform);
  const connectionState = bounded(CONNECTION_STATES, row.connectionState, "DISCONNECTED");
  const accountKind = bounded(ACCOUNT_KINDS, row.accountKind, "test");

  return {
    id: row.id,
    platform,
    platformLabel: platformLabelFor(platform),
    name: row.name,
    username: row.username,
    accountKind,

    connectionState,
    needsReconnect: row.reconnectRequired === true,
    // A reconnect reason wins over a stale sync error — it is the actionable one.
    reason: normalizeReason(row.requiresReconnectReason) ?? normalizeReason(row.lastError),

    monitoringEnabled: row.monitoringEnabled === true,
    monitoringCanBeEnabled: row.monitoringCanBeEnabled === true,

    autoSyncState: bounded(AUTO_SYNC_STATES, row.autoSyncState, "NOT_CONFIGURED"),
    firstSyncState: bounded(FIRST_SYNC_STATES, row.firstSyncState, "waiting_first_sync"),
    lastSuccessfulSyncAt: iso(row.lastSuccessAt),
    lastAttemptAt: iso(row.lastAttemptAt),

    commentsToday: row.commentsToday,
    riskToday: row.riskToday,

    capabilities: resolveCapabilities({
      platform, connectionState, accountKind,
      grantedPermissions: row.grantedPermissions ?? [],
      canManage,
    }),
    canManage,
  };
}

export function toCapacityDto(
  capacity: { used: number; limit: number; remaining: number },
  monitored: number,
): CapacityDto {
  return { used: capacity.used, limit: capacity.limit, remaining: capacity.remaining, monitored };
}

export function toSyncRunDto(run: AccountDetailSource["syncRuns"][number]): SyncRunDto {
  const status = bounded(SYNC_RUN_STATUSES, run.status, "failed");
  return {
    id: run.id,
    status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
    fetched: run.fetched,
    created: run.created,
    // The `error` column holds free-form engine/provider text — it is classified, never sent.
    reason: run.error ? reasonForRunStatus(status) : null,
    demo: run.mock === true,
  };
}

/** Map a failed run's STATUS onto the bounded reason vocabulary. */
function reasonForRunStatus(status: SyncRunStatusKey): AccountReasonKey {
  switch (status) {
    case "permission_missing": return "permission_missing";
    case "rate_limited": return "rate_limited";
    case "api_unavailable": return "provider_unavailable";
    case "disconnected": return "disconnected";
    case "failed": return "sync_failed";
    case "interrupted": return "sync_failed";
    default: return "unknown";
  }
}

export function toDetailDto(src: AccountDetailSource, canManage: boolean): AccountDetailDto {
  return {
    ...toAccountDto(src, canManage),
    tokenHealth: bounded(TOKEN_HEALTHS, src.tokenHealth, "unknown"),
    tokenExpiresAt: iso(src.tokenExpiresAt),
    lastSuccessfulProviderCheckAt: iso(src.lastSuccessfulGraphCheckAt),
    // Either switch pausing protection is the same customer-visible fact.
    protectionPaused: src.killSwitch === true || src.globalKillSwitch === true,
    brandName: src.brandName,
    syncRuns: src.syncRuns.map(toSyncRunDto),
  };
}

/** Accounts whose connection is not healthy — drives the list's attention summary. */
export function countNeedsAttention(accounts: readonly AccountDto[]): number {
  return accounts.filter((a) => a.connectionState !== "CONNECTED_HEALTHY").length;
}

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

function err(status: number, error: AccountsError): AccountsResponse {
  return { status, body: { error } };
}

interface AccountsSession {
  userId: string;
  tenantId: string;
  role: string;
}
type AccountsGate =
  | { ok: true; session: AccountsSession }
  | { ok: false; response: AccountsResponse };

/**
 * The ONE read gate: bearer → validated session → verified email → BUSINESS
 * workspace. Tenant and role come from the session; the request supplies neither.
 */
export async function authorizeAccountsRead(
  authorization: string | null | undefined,
  deps: ShellSessionDeps,
): Promise<AccountsGate> {
  const token = /^Bearer[ ]+(\S+)$/.exec((authorization ?? "").trim())?.[1] ?? null;
  if (!token) return { ok: false, response: err(401, "unauthenticated") };

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const reason: SessionRejectReason | undefined = result.reason;
    if (reason === "session_expired_idle") deps.emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") deps.emitOpsEvent("auth.session_expired_absolute", { reason });

    const mapped: AccountsError =
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
  return { ok: true, session: { userId: s.userId, tenantId: s.tenantId, role: s.role } };
}

/**
 * The WRITE gate: everything the read gate checks, plus the canonical
 * `Permission.ConnectorManage`. A client-sent `canManage`, `monitoringCanBeEnabled`
 * or role is never consulted — those fields exist only to shape the UI.
 */
async function authorizeAccountsWrite(
  authorization: string | null | undefined,
  deps: AccountsDeps,
): Promise<AccountsGate> {
  const gate = await authorizeAccountsRead(authorization, deps);
  if (!gate.ok) return gate;
  if (!deps.canManageConnectors(gate.session.role)) {
    return { ok: false, response: err(403, "permission_denied") };
  }
  return gate;
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/accounts                                                    */
/* -------------------------------------------------------------------------- */

export async function handleAccountsList(
  req: { authorization: string | null | undefined },
  deps: AccountsDeps,
): Promise<AccountsResponse> {
  const gate = await authorizeAccountsRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const canManage = deps.canManageConnectors(gate.session.role);

  let source: AccountsSource;
  try {
    source = await deps.listAccounts({ tenantId: gate.session.tenantId });
  } catch {
    return err(500, "server_error");
  }

  const accounts = source.rows.map((row) => toAccountDto(row, canManage));
  const body: AccountsListResponse = {
    accounts,
    capacity: toCapacityDto(source.capacity, source.monitored),
    capabilities: { canManageConnectors: canManage },
    needsAttention: countNeedsAttention(accounts),
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/accounts/:accountId                                         */
/* -------------------------------------------------------------------------- */

export async function handleAccountDetail(
  req: { authorization: string | null | undefined; accountId: string | null | undefined },
  deps: AccountsDeps,
): Promise<AccountsResponse> {
  const gate = await authorizeAccountsRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const accountId = req.accountId?.trim();
  if (!accountId) return err(400, "invalid_request");

  const canManage = deps.canManageConnectors(gate.session.role);

  let src: AccountDetailSource | null;
  let capacity: { used: number; limit: number; remaining: number; monitored: number };
  try {
    [src, capacity] = await Promise.all([
      deps.getAccount({ tenantId: gate.session.tenantId, accountId }),
      deps.getCapacity({ tenantId: gate.session.tenantId }),
    ]);
  } catch {
    return err(500, "server_error");
  }
  // A foreign account and a missing account are ONE indistinguishable outcome — the
  // response must never confirm that another tenant's id exists.
  if (!src) return err(404, "not_found");

  const body: AccountDetailResponse = {
    account: toDetailDto(src, canManage),
    capacity: toCapacityDto(capacity, capacity.monitored),
    capabilities: { canManageConnectors: canManage },
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/accounts/:accountId/monitoring                             */
/* -------------------------------------------------------------------------- */

export async function handleMonitoringToggle(
  req: {
    authorization: string | null | undefined;
    accountId: string | null | undefined;
    body: unknown;
  },
  deps: AccountsDeps,
): Promise<AccountsResponse> {
  const gate = await authorizeAccountsWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const accountId = req.accountId?.trim();
  if (!accountId) return err(400, "invalid_request");

  // The ONLY accepted field. A tenantId, role, limit or canEnable in the body is
  // ignored — the server derives every one of them.
  const raw = (req.body ?? {}) as { enabled?: unknown };
  if (typeof raw.enabled !== "boolean") return err(400, "invalid_request");
  const enabled = raw.enabled;

  const tenantId = gate.session.tenantId;

  try {
    if (enabled) {
      // The canonical ATOMIC enable. Capacity is never re-derived here, so the plan
      // limit cannot be bypassed by a forged `monitoringCanBeEnabled`. A foreign or
      // missing account also surfaces as `account_limit_reached` — deliberately
      // indistinguishable, exactly as the canonical function reports it.
      const res = await deps.enableMonitoring({ tenantId, accountId });
      if (!res.ok) {
        deps.emitOpsEvent("subscription.account_limit_reached", { operation: "enable_monitoring" });
        return err(409, "account_limit_reached");
      }
      deps.emitOpsEvent("account.monitoring_enabled", { operation: "toggle" });
    } else {
      const count = await deps.disableMonitoring({ tenantId, accountId });
      // Zero rows means the account is not this tenant's (or is gone) — same safe answer.
      if (count === 0) return err(404, "not_found");
      deps.emitOpsEvent("account.monitoring_disabled", { operation: "toggle" });
    }
  } catch {
    return err(500, "server_error");
  }

  // Re-read the canonical row so the client adopts the SERVER's resulting state
  // rather than assuming its own optimistic value.
  let row: AccountSourceRow | null;
  let capacity: { used: number; limit: number; remaining: number; monitored: number };
  try {
    [row, capacity] = await Promise.all([
      deps.getAccountRow({ tenantId, accountId }),
      deps.getCapacity({ tenantId }),
    ]);
  } catch {
    return err(500, "server_error");
  }
  if (!row) return err(404, "not_found");

  await deps.writeAudit({
    tenantId, userId: gate.session.userId,
    event: enabled ? "account.monitoring_enabled" : "account.monitoring_disabled",
    targetId: accountId,
    metadata: { surface: "mobile", enabled, platform: normalizePlatform(row.platform) },
  }).catch(() => {});

  const body: MonitoringResponse = {
    account: toAccountDto(row, true),
    capacity: toCapacityDto(capacity, capacity.monitored),
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/accounts/:accountId/sync                                   */
/* -------------------------------------------------------------------------- */

/**
 * Start a manual READ-ONLY sync.
 *
 * Non-blocking, matching the web: the provider round trip is scheduled to run after
 * the response, so the phone never holds an HTTP connection open for it. The reply
 * is a bounded key — never a provider payload, and never a fabricated completion.
 */
export async function handleAccountSync(
  req: { authorization: string | null | undefined; accountId: string | null | undefined },
  deps: AccountsDeps,
): Promise<AccountsResponse> {
  const gate = await authorizeAccountsWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const accountId = req.accountId?.trim();
  if (!accountId) return err(400, "invalid_request");
  const tenantId = gate.session.tenantId;

  let row: AccountSourceRow | null;
  try {
    row = await deps.getAccountRow({ tenantId, accountId });
  } catch {
    return err(500, "server_error");
  }
  // Re-read AUTHORITATIVE state: another operator may have disconnected this account
  // while the screen was open, so the client's view is never trusted.
  if (!row) return { status: 404, body: { result: "not_found" } };

  const platform = normalizePlatform(row.platform);
  const connectionState = bounded(CONNECTION_STATES, row.connectionState, "DISCONNECTED");

  // Only Meta has a read-only sync implementation behind it. Reporting anything else
  // as syncable would launch a doomed provider request.
  if (!SYNC_IMPLEMENTED_PLATFORMS.includes(platform)) {
    return { status: 200, body: { result: "not_supported" } satisfies SyncResponse as unknown as Record<string, unknown> };
  }

  // The canonical `manualSyncBlocked` rule: never start a sync that can only fail.
  if (connectionState === "REAUTH_REQUIRED" || connectionState === "DISCONNECTED") {
    return { status: 200, body: { result: "reconnect_required" } };
  }

  // Server-side deduplication check. This is a courteous early answer, NOT the
  // guarantee — the canonical sync lease inside `runReadOnlySync` is what actually
  // prevents two provider cycles, and it is atomic.
  try {
    if (await deps.hasActiveSyncLease({ tenantId, accountId })) {
      return { status: 200, body: { result: "already_running" } };
    }
  } catch {
    // A lease read failure must not block a legitimate sync; the lease still guards it.
  }

  deps.startReadOnlySync({ tenantId, accountId });

  // No ops event: the canonical sync engine already emits its own lifecycle events,
  // and inventing a new one here would add a second, divergent telemetry vocabulary.
  await deps.writeAudit({
    tenantId, userId: gate.session.userId,
    event: "connector.sync_started",
    targetId: accountId,
    metadata: { surface: "mobile", platform, trigger: "manual", readOnly: true },
  }).catch(() => {});

  return { status: 202, body: { result: "started" } };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/accounts/:accountId/disconnect                             */
/* -------------------------------------------------------------------------- */

export async function handleAccountDisconnect(
  req: { authorization: string | null | undefined; accountId: string | null | undefined },
  deps: AccountsDeps,
): Promise<AccountsResponse> {
  const gate = await authorizeAccountsWrite(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const accountId = req.accountId?.trim();
  if (!accountId) return err(400, "invalid_request");
  const tenantId = gate.session.tenantId;

  let result: Awaited<ReturnType<AccountsDeps["disconnectAccount"]>>;
  try {
    // The canonical service: tenant-qualified read, cluster resolve, best-effort
    // provider revoke outside any transaction, atomic local credential removal.
    result = await deps.disconnectAccount({ tenantId, accountId });
  } catch {
    return err(500, "server_error");
  }
  if (!result.found) return err(404, "not_found");

  await deps.writeAudit({
    tenantId, userId: gate.session.userId,
    event: "connector.disconnected",
    targetId: accountId,
    metadata: {
      surface: "mobile",
      localCredentialsRemoved: true,
      providerRevoke: bounded(REVOKE_RESULTS, result.providerRevoke, "failed"),
      clusterCount: result.clusterCount,
      clusterPlatforms: result.clusterPlatforms.map(normalizePlatform),
      manualCleanupRecommended: result.manualCleanupRecommended,
      resultingStatus: "disconnected",
    },
  }).catch(() => {});

  const body: DisconnectResponse = {
    disconnected: true,
    clusterCount: result.clusterCount,
    // Platform LABELS by key — never the internal account ids in the cluster.
    clusterPlatforms: result.clusterPlatforms.map(normalizePlatform),
    providerRevoke: bounded(REVOKE_RESULTS, result.providerRevoke, "failed"),
    manualCleanupRecommended: result.manualCleanupRecommended === true,
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}
