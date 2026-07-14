/**
 * @guardora/sync — read-only sync pipeline.
 *
 * Fetches content for a connected account (MOCK fallback in placeholder mode,
 * live read-only Graph reads in read_only mode behind META_LIVE_SYNC), maps it
 * onto Guardora ReputationItems, deduplicates by (account, externalId), records
 * a SyncRun, and writes system audit events.
 *
 * It NEVER performs moderation actions and NEVER logs token material.
 */
import {
  withTenantDb,
  ActorKind,
  ConnectorHealth,
  Priority,
  ReputationStatus,
  RiskLevel as DbRiskLevel,
  Sentiment as DbSentiment,
  SyncRunStatus,
  ConnectorStatus,
  ContentKind,
  decryptToken,
  findMetaAccountsByExternalIds,
  listUnprocessedMetaWebhooks,
  markWebhookProcessed,
  acquireSyncLease,
  releaseSyncLease,
  type TenantTx,
  type ConnectedAccount,
} from "@guardora/db";
import { randomUUID } from "node:crypto";
import { buildIntelFromHybrid, evaluateAutoProtect, evaluateControl, type ClassifierRule } from "@guardora/ai";
import { classifyWithUsagePolicy } from "./metered-classify";
import { attemptFacebookHide } from "./live-actions";
import { loadProductionSafetyContext } from "./production-safety";
import {
  ConnectorMode as CoreMode,
  Platform as CorePlatform,
  isRealConnection,
  modeAllowsSync,
} from "@guardora/core";
import {
  createConnectorRuntime,
  MetaGraphError,
  GraphMetaContentTransport,
  type FetchedContent,
  type MetaContentTransport,
} from "@guardora/connectors";
import { getMetaConfig, getTranslationConfig, getAiRiskConfig } from "@guardora/config";
import { mockMetaFetch } from "./mock-fetch";
import {
  fetchInstagramContent,
  classifyIgPermissionState,
  type IgPermissionState,
} from "./instagram-content";

/** Truthful outcome of a whole sync run. */
export type SyncVerdict = "success" | "partial_success" | "failed" | "skipped_locked";

export interface SyncOutcome {
  ok: boolean;
  mock: boolean;
  fetched: number;
  created: number;
  /** V1.37.4 — existing items whose provider content changed. */
  updated: number;
  deduped: number;
  /** Per-item failures that did NOT abort the whole run. */
  errors: number;
  durationMs: number;
  message: string;
  syncRunId?: string;
  /** V1.37.4 — truthful run verdict. */
  verdict?: SyncVerdict;
  /** True when the failure means the user must re-authorize. */
  needsReconnect?: boolean;
  /** True when the failure is a transient rate limit — retry later. */
  retryLater?: boolean;
}

/** A token/auth problem (expired/invalid) that requires the user to reconnect. */
class ReconnectRequiredError extends Error {
  constructor(message: string, public readonly permissionState?: IgPermissionState) { super(message); }
}
/** A transient platform rate limit — retry after backoff, no user action. */
class RateLimitedError extends Error {
  constructor(message: string, public readonly permissionState?: IgPermissionState) { super(message); }
}
/** A missing-permission problem — the user must re-grant scopes (reconnect). */
class PermissionRequiredError extends Error {
  constructor(message: string, public readonly permissionState?: IgPermissionState) { super(message); }
}
/** V1.38.1 — the provider API was unreachable/5xx; transient, retry later (no reconnect). */
class ApiUnavailableError extends Error {
  constructor(message: string, public readonly permissionState?: IgPermissionState) { super(message); }
}
/** V1.37.4 — a single malformed provider item; isolated, never aborts the run. */
class IngestItemInvalidError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

/** V1.37.4 — Postgres unique-violation detector (benign duplicate race, not a failure). */
function isDuplicateRace(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const meta = (e as { meta?: { code?: string } })?.meta?.code;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return code === "P2002" || meta === "23505" || /23505|unique constraint|duplicate key/i.test(msg);
}

export type IngestOutcome = "created" | "updated" | "deduped";

interface FetchResult {
  items: FetchedContent[];
  cursor?: string;
  /** V1.38.1 — truthful IG permission/availability state ("healthy" on success). */
  permissionState?: IgPermissionState;
  /** V1.38.1 — true when a page cap was hit; more content remains (surfaced in audit). */
  truncated?: boolean;
}

/** Conservative backoff schedule (minutes) — NOT an aggressive retry loop. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];
function nextRetryFor(attempts: number): Date {
  const idx = Math.min(attempts, BACKOFF_MINUTES.length) - 1;
  const minutes = BACKOFF_MINUTES[Math.max(0, idx)] ?? 360;
  return new Date(Date.now() + minutes * 60_000);
}

type AccountRow = ConnectedAccount;

/**
 * V1.37.3B — read-only sync on the RLS runtime. The caller supplies a TRUSTED
 * tenantId (from system discovery or a validated session). Structure follows the
 * read → fetch → write pattern: short tenant transactions for DB work, provider
 * HTTP strictly BETWEEN transactions — never inside one.
 *
 * `hooks` is a test-only instrumentation seam (dependency injection) used to prove
 * the transaction/HTTP ordering. It never carries or logs sensitive data.
 */
export interface SyncPhaseHooks {
  onPhase?: (phase: string) => void;
  /** Test-only: throw to simulate a ReputationItem write failure (atomicity proof). */
  beforeReputationCreate?: () => void | Promise<void>;
  /** Test-only: force the lease to appear held (skipped_locked path). */
  forceLeaseUnavailable?: boolean;
  /** Test-only: override the lease holder id (concurrency tests). */
  holderId?: string;
  /**
   * V1.38.1 — inject the Instagram CONTENT transport. Tests pass a MockMetaContentTransport
   * so the REAL runReadOnlySync (lease/RLS/idempotency/atomic/verdict/dedup) runs against a
   * real DB with no network. Live default (when omitted) is the Graph transport, gated by
   * META_LIVE_SYNC. It carries no sensitive data and is never logged.
   */
  contentTransport?: MetaContentTransport;
}

export async function runReadOnlySync(
  target: { accountId: string; tenantId: string },
  trigger: "manual" | "automatic" = "manual",
  hooks?: SyncPhaseHooks,
): Promise<SyncOutcome> {
  const { accountId, tenantId } = target;
  const phase = (p: string) => hooks?.onPhase?.(p);

  // --- Phase A: tenant read (short tx) — load the account under RLS. ---
  phase("tenant-read-start");
  const account = await withTenantDb(tenantId, (db) =>
    db.connectedAccount.findFirst({ where: { id: accountId } }),
  );
  phase("tenant-read-end");
  if (!account) {
    return zero(false, "Connected account not found.");
  }

  const mode = account.mode as unknown as CoreMode;
  if (!modeAllowsSync(mode)) {
    return zero(false, `Sync is not available in "${account.mode}" mode.`);
  }

  // --- V1.37.4 — acquire the account-level sync lease BEFORE any work. Guarantees
  // one active sync per account (manual + scheduled cannot collide). Released in
  // finally. Not a held DB transaction — a TTL row, so a crash can't block forever. ---
  const holderId = hooks?.holderId ?? `${trigger}_${randomUUID()}`;
  const lease = hooks?.forceLeaseUnavailable ? null : await acquireSyncLease(tenantId, account.id, holderId);
  if (!lease) {
    phase("lease-skipped");
    await withTenantDb(tenantId, (db) => db.syncRun.create({
      data: { tenantId: account.tenantId, brandId: account.brandId, connectedAccountId: account.id, status: SyncRunStatus.skipped_locked, mock: false, finishedAt: new Date() },
    }));
    return { ok: true, mock: false, fetched: 0, created: 0, updated: 0, deduped: 0, errors: 0, durationMs: 0, message: "Sync skipped — another sync is already running for this account.", verdict: "skipped_locked" };
  }
  phase("lease-acquired");

  // Everything past lease acquisition runs inside try/finally so the lease is ALWAYS
  // released (even on crash/throw) — a crashed holder would otherwise rely on TTL.
  try {
    // Mock fetch is ONLY for placeholder (demo) accounts. A real (read_only)
    // account is NEVER injected with mock data — if live sync isn't enabled it is
    // skipped cleanly. This keeps real testing free of mock content.
    const meta = getMetaConfig();
    const isReal = isRealConnection(mode);
    const useMock = !isReal;
    // Live network reads require META_LIVE_SYNC. An INJECTED content transport (tests)
    // performs NO network I/O, so it may run with live sync off — the placeholder-connector
    // invariant (no real API calls by default) still holds because production never injects one.
    if (isReal && !meta.liveSync && !hooks?.contentTransport) {
      return zero(false, "Live Meta sync is not enabled (META_LIVE_SYNC=false). No mock data is injected for a real account.");
    }

    // --- Phase A2: tenant write (short tx) — open the SyncRun + load rules + audit. ---
    const { run, rules } = await withTenantDb(tenantId, async (db) => {
      const run = await db.syncRun.create({
        data: {
          tenantId: account.tenantId,
          brandId: account.brandId,
          connectedAccountId: account.id,
          status: SyncRunStatus.running,
          mock: useMock,
        },
      });
      const rules = await loadRulesTx(db, account.brandId);
      await auditTx(db, account, "sync.started", { mock: useMock, trigger });
      return { run, rules };
    });
    const startedAt = Date.now();

    try {
      // --- Phase B: provider HTTP (NO open transaction). ---
      phase("provider-call-start");
      const { items: fetched, cursor, permissionState, truncated } = await fetchContent(account, mode, useMock, hooks);
      phase("provider-call-end");

      let created = 0;
      let updated = 0;
      let deduped = 0;
      let failed = 0;
      // --- Per-item isolation: one malformed item never aborts the whole run. ---
      for (const item of fetched) {
        try {
          const outcome = await ingestItem(tenantId, account, item, rules, hooks);
          if (outcome === "created") created++;
          else if (outcome === "updated") updated++;
          else deduped++;
        } catch (itemErr) {
          // A benign duplicate race is NOT a failure — the record already exists.
          if (isDuplicateRace(itemErr)) { deduped++; continue; }
          failed++;
          const reason = itemErr instanceof IngestItemInvalidError ? itemErr.reason : "ingest_item_invalid";
          await withTenantDb(tenantId, (db) => auditTx(db, account, "sync.item_failed", { reason })).catch(() => {});
        }
      }

      const durationMs = Date.now() - startedAt;
      const verdict: SyncVerdict = failed === 0 ? "success" : (created + updated + deduped > 0 ? "partial_success" : "failed");
      const status = verdict === "success" ? SyncRunStatus.completed
        : verdict === "partial_success" ? SyncRunStatus.partial_success
        : SyncRunStatus.failed;

      // --- Phase D: tenant write (short tx) — mark result + refresh account. ---
      phase("tenant-write-start");
      await withTenantDb(tenantId, async (db) => {
        await db.syncRun.update({
          where: { id: run.id },
          data: {
            status,
            fetched: fetched.length,
            created, updated, deduped, errors: failed,
            durationMs,
            cursor: cursor ?? null,
            finishedAt: new Date(),
          },
        });
        await db.connectedAccount.update({
          where: { id: account.id },
          data: {
            lastSyncedAt: new Date(),
            // V1.38.1 — a successful read is the truthful "healthy" permission state.
            ...(permissionState ? { contentPermissionState: permissionState } : {}),
            // Only a fully/partly successful run refreshes success markers.
            ...(verdict !== "failed" ? { lastSuccessfulSyncAt: new Date(), lastCursor: cursor ?? undefined, health: ConnectorHealth.healthy, lastError: null, lastErrorAt: null, syncAttempts: 0, nextRetryAt: null } : {}),
          },
        });
        await auditTx(db, account, verdict === "partial_success" ? "sync.partial" : "sync.completed", {
          mock: useMock, fetched: fetched.length, created, updated, deduped, failed, verdict, durationMs, trigger,
          ...(permissionState ? { permissionState } : {}),
          ...(truncated ? { truncated: true } : {}),
        });
      });
      phase("tenant-write-end");

      return {
        ok: verdict !== "failed",
        mock: useMock,
        fetched: fetched.length,
        created, updated, deduped,
        errors: failed,
        durationMs,
        message: verdict === "partial_success"
          ? `Sync completed with ${failed} item error(s) isolated; ${created} new, ${updated} updated, ${deduped} unchanged.`
          : useMock
            ? "Mock read-only sync completed (labelled MOCK data, no live API call)."
            : "Read-only sync completed.",
        syncRunId: run.id,
        verdict,
      };
    } catch (err) {
      // Account-level failure (token/permission/rate-limit/fetch) — aborts the run.
      const durationMs = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      const isTokenExpired = err instanceof ReconnectRequiredError;
      const isPermission = err instanceof PermissionRequiredError;
      const isRateLimited = err instanceof RateLimitedError;
      const isApiUnavailable = err instanceof ApiUnavailableError;
      const needsReconnect = isTokenExpired || isPermission;
      // V1.38.1 — transient (rate-limit / API-unavailable) never forces a reconnect.
      const retryLater = isRateLimited || isApiUnavailable;
      const permissionState = (err as { permissionState?: IgPermissionState })?.permissionState;
      const attempts = (account.syncAttempts ?? 0) + 1;
      const nextRetryAt = needsReconnect ? null : nextRetryFor(attempts);
      const event = isTokenExpired ? "sync.token_expired" : isPermission ? "sync.permission_error" : isRateLimited ? "sync.rate_limited" : isApiUnavailable ? "sync.api_unavailable" : "sync.failed";
      const status = isTokenExpired ? SyncRunStatus.permission_missing : isPermission ? SyncRunStatus.permission_missing : isRateLimited ? SyncRunStatus.rate_limited : isApiUnavailable ? SyncRunStatus.api_unavailable : SyncRunStatus.failed;

      phase("tenant-write-start");
      await withTenantDb(tenantId, async (db) => {
        await db.syncRun.update({
          where: { id: run.id },
          data: { status, error: msg, errors: 1, durationMs, finishedAt: new Date() },
        });
        await db.connectedAccount.update({
          where: { id: account.id },
          data: {
            lastSyncedAt: new Date(),
            status: needsReconnect ? ConnectorStatus.expired : undefined,
            health: needsReconnect ? ConnectorHealth.degraded : retryLater ? ConnectorHealth.degraded : ConnectorHealth.error,
            // V1.38.1 — persist the truthful IG permission/availability state.
            ...(permissionState ? { contentPermissionState: permissionState } : {}),
            lastError: msg, lastErrorAt: new Date(), syncAttempts: attempts, nextRetryAt,
          },
        });
        await auditTx(db, account, event, { error: msg, needsReconnect, retryLater, ...(permissionState ? { permissionState } : {}) });
      });
      phase("tenant-write-end");

      return { ok: false, mock: useMock, fetched: 0, created: 0, updated: 0, deduped: 0, errors: 1, durationMs, message: msg, syncRunId: run.id, verdict: "failed", needsReconnect, retryLater };
    }
  } finally {
    // ALWAYS release the lease (release-in-finally). Idempotent.
    await releaseSyncLease(tenantId, lease).catch(() => {});
    phase("lease-released");
  }
}

async function fetchContent(
  account: AccountRow,
  mode: CoreMode,
  useMock: boolean,
  hooks?: SyncPhaseHooks,
): Promise<FetchResult> {
  if (useMock) {
    const items = mockMetaFetch(
      account.id,
      account.platform as unknown as CorePlatform,
    );
    return { items };
  }

  // Real (read_only) LIVE path — Graph GET reads only. Fails safely.
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
    throw new ReconnectRequiredError(
      "Access token has expired — reconnect required.",
      "token_expired",
    );
  }
  const token = decryptToken(account.longLivedToken ?? account.accessToken);
  if (!token) {
    throw new ReconnectRequiredError(
      "No usable access token is stored — reconnect required.",
      "token_expired",
    );
  }

  // V1.38.1 — Instagram content ingestion goes through the injectable CONTENT transport
  // (Mock in tests, Graph in production). This gives IG real media→comment pagination,
  // cursors, deleted-media isolation and truthful permission states, while reusing the
  // one idempotent ingest path in the caller. FB stays on the read-only connector below.
  if (String(account.platform) === "instagram_business") {
    return fetchInstagramViaTransport(account, token, hooks?.contentTransport);
  }

  const runtime = createConnectorRuntime(
    account.platform as unknown as CorePlatform,
    mode,
  );
  try {
    await runtime.connect({
      accessToken: token,
      externalId: account.pageId ?? account.externalId,
      scopes: account.scopes,
    });
    const res = await runtime.syncComments({ limit: 50 });
    // An empty result is a valid "0 comments" outcome, not a failure.
    return { items: res.items, cursor: res.nextCursor };
  } catch (err) {
    // Classify the Graph error so callers can emit the right audit + health.
    if (err instanceof MetaGraphError) {
      if (err.detail.kind === "token_expired") {
        throw new ReconnectRequiredError(
          "Meta access token expired or invalid — reconnect required.",
        );
      }
      if (err.detail.kind === "permission") {
        throw new PermissionRequiredError(
          "Missing Meta permissions for this read — reconnect and re-grant access.",
        );
      }
      if (err.detail.kind === "rate_limit") {
        throw new RateLimitedError(
          "Meta API rate limit reached — the sync will retry later.",
        );
      }
      throw new Error(`Live Meta sync failed (HTTP ${err.detail.status}).`);
    }
    // Non-Graph error (network etc.) — generic, no secrets.
    throw new Error("Live Meta sync failed due to an unexpected error.");
  }
}

/**
 * V1.38.1 — Instagram content read through the injectable transport. Provider HTTP only
 * (never inside a tenant tx). Classifies any Graph failure into a truthful permission
 * state AND the run-control error the outer handler already understands.
 */
async function fetchInstagramViaTransport(
  account: AccountRow,
  token: string,
  injected?: MetaContentTransport,
): Promise<FetchResult> {
  const igBusinessId = account.igBusinessId ?? account.externalId;
  if (!igBusinessId) {
    // No canonical IG id on the account — the asset is not linked (real signal, not a guess).
    throw new PermissionRequiredError(
      "This account has no linked Instagram Professional account — reconnect required.",
      "instagram_not_linked",
    );
  }
  const transport = injected ?? new GraphMetaContentTransport();
  try {
    const res = await fetchInstagramContent(igBusinessId, token, transport, {
      after: account.lastCursor ?? undefined,
    });
    return { items: res.items, cursor: res.cursor, permissionState: "healthy", truncated: res.truncated };
  } catch (err) {
    const state = classifyIgPermissionState(err);
    switch (state) {
      case "token_expired":
        throw new ReconnectRequiredError("Instagram access token expired or invalid — reconnect required.", state);
      case "rate_limited":
        throw new RateLimitedError("Instagram API rate limit reached — the sync will retry later.", state);
      case "api_unavailable":
        throw new ApiUnavailableError("Instagram API is temporarily unavailable — the sync will retry later.", state);
      case "account_not_discoverable":
        throw new PermissionRequiredError("The Instagram account is no longer discoverable — reconnect required.", state);
      default:
        // permission_missing / business_verification_required / etc. → re-grant/reconnect.
        throw new PermissionRequiredError("Missing Instagram permissions for this read — reconnect and re-grant access.", state);
    }
  }
}

/** Load brand rules inside an existing tenant transaction. */
async function loadRulesTx(db: TenantTx, brandId: string): Promise<ClassifierRule[]> {
  const rules = await db.brandRule.findMany({ where: { brandId, enabled: true } });
  return rules.map((r) => ({
    category: r.category as unknown as ClassifierRule["category"],
    phrases: r.phrases,
    enabled: r.enabled,
  }));
}

/** Mutable provider CONTENT fields (safe to overwrite on resync). Immutable identity
 * fields (kind, platform, externalId, connectedAccountId, tenant/brand) are NEVER here. */
function mutableContentFields(item: FetchedContent) {
  return {
    text: item.text,
    externalParentId: item.externalParentId ?? null,
    authorDisplayName: item.author.displayName ?? null,
    authorLocale: item.author.locale ?? null,
    rating: item.rating ?? null,
    permalink: item.permalink ?? null,
    publishedAt: new Date(item.publishedAt),
  };
}

function contentChanged(
  existing: { text: string; rating: number | null; authorDisplayName: string | null; permalink: string | null; externalParentId: string | null; authorLocale: string | null; publishedAt: Date },
  item: FetchedContent,
): boolean {
  return existing.text !== item.text
    || (existing.rating ?? null) !== (item.rating ?? null)
    || (existing.authorDisplayName ?? null) !== (item.author.displayName ?? null)
    || (existing.permalink ?? null) !== (item.permalink ?? null)
    || (existing.externalParentId ?? null) !== (item.externalParentId ?? null)
    || (existing.authorLocale ?? null) !== (item.author.locale ?? null)
    || existing.publishedAt.getTime() !== new Date(item.publishedAt).getTime();
}

/**
 * V1.37.4 — idempotent ingest of ONE provider item. Fast-path: an already-seen item
 * (unique connectedAccountId+externalId) only propagates MUTABLE content changes and
 * NEVER touches ReputationItem workflow state (status/priority/approval). A new item
 * is classified + persisted; the create is race-safe (upsert + reputation guard), so
 * a concurrent duplicate resolves to one logical record instead of a P2002 abort.
 */
export async function ingestItem(
  tenantId: string,
  account: AccountRow,
  item: FetchedContent,
  rules: ClassifierRule[],
  hooks?: SyncPhaseHooks,
): Promise<IngestOutcome> {
  if (!item.externalId) throw new IngestItemInvalidError("ingest_item_invalid"); // never invent an externalId

  const existing = await withTenantDb(tenantId, (db) => db.contentItem.findFirst({
    where: { connectedAccountId: account.id, externalId: item.externalId },
    select: { id: true, text: true, rating: true, authorDisplayName: true, permalink: true, externalParentId: true, authorLocale: true, publishedAt: true },
  }));
  if (existing) {
    if (!contentChanged(existing, item)) return "deduped";
    // Propagate provider content changes; workflow fields are preserved.
    await withTenantDb(tenantId, (db) => db.contentItem.update({
      where: { connectedAccountId_externalId: { connectedAccountId: account.id, externalId: item.externalId } },
      data: mutableContentFields(item),
    }));
    return "updated";
  }
  return persistNewItem(tenantId, account, item, rules, hooks);
}

async function persistNewItem(
  tenantId: string,
  account: AccountRow,
  item: FetchedContent,
  rules: ClassifierRule[],
  hooks?: SyncPhaseHooks,
): Promise<IngestOutcome> {
  // Phase P1 — tenant reads (short tx): plan + brand locale + brand memory rules.
  const { plan, brand, memoryRules } = await withTenantDb(tenantId, async (db) => {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    const brand = await db.brand.findFirst({ where: { id: account.brandId }, select: { defaultLocale: true } });
    const memoryRules = await db.brandRiskMemoryRule.findMany({
      where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
      select: { type: true, normalizedPhrase: true, language: true, severity: true, isActive: true },
    });
    return { plan: tenant?.plan ?? "free", brand, memoryRules };
  });

  // Classification via the METERED policy service (cache → rules → paid, cost-protected) — OUTSIDE
  // any transaction. A paid provider is NEVER reached without a prior atomic reservation.
  const hybrid = await classifyWithUsagePolicy(
    { tenantId, plan },
    { text: item.text, platform: item.platform, locale: item.author.locale, rating: item.rating, rules },
    {
      workspaceLocale: brand?.defaultLocale ?? "en",
      translation: getTranslationConfig(),
      aiRisk: getAiRiskConfig(),
      memoryRules,
    },
  );

  // Phase P2 — tenant read (short tx): Auto-Protect policies (evaluation is pure).
  const policies = await withTenantDb(tenantId, (db) => db.brandAutoProtectPolicy.findMany({
    where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
    select: { category: true, mode: true, minConfidence: true, isActive: true },
  }));
  const autoProtect = evaluateAutoProtect(
    { text: item.text, riskLevel: hybrid.level, categories: hybrid.categories, riskSignals: hybrid.explanation.riskSignals, matchedTerms: hybrid.explanation.matchedTerms, sentiment: hybrid.sentiment, confidence: hybrid.confidence },
    policies,
  );
  const requiresApproval = hybrid.approvalRequired || autoProtect.decision === "requires_approval";

  // Phase P3 — tenant writes (ONE short tx): ContentItem + ReputationItem are created
  // ATOMICALLY (both commit or neither). No provider HTTP here. The ContentItem is an
  // idempotent UPSERT on (connectedAccountId, externalId) — a concurrent duplicate
  // resolves to the existing row (native ON CONFLICT) instead of aborting the tx; a
  // pre-existing ReputationItem then short-circuits to "updated" (no double side-effects).
  const p3 = await withTenantDb(tenantId, async (db): Promise<{ repItem: { id: string } | null; outcome: IngestOutcome }> => {
    const content = await db.contentItem.upsert({
      where: { connectedAccountId_externalId: { connectedAccountId: account.id, externalId: item.externalId } },
      create: {
        tenantId: account.tenantId,
        brandId: account.brandId,
        connectedAccountId: account.id,
        platform: account.platform,
        kind: (item.kind as unknown as ContentKind) ?? ContentKind.comment,
        externalId: item.externalId,
        authorExternalId: item.author.externalId ?? null,
        ...mutableContentFields(item),
      },
      update: mutableContentFields(item),
    });

    // 1:1 guard — if a ReputationItem already exists for this content, another sync
    // beat us to it: propagate content (done by upsert) and skip create + side-effects.
    const existingRep = await db.reputationItem.findUnique({ where: { contentItemId: content.id }, select: { id: true } });
    if (existingRep) return { repItem: null, outcome: "updated" };

    // Failure-injection seam (test-only) — proves atomicity: if this throws, the
    // ContentItem create above is rolled back with the transaction (no orphan).
    if (hooks?.beforeReputationCreate) await hooks.beforeReputationCreate();

    const repItem = await db.reputationItem.create({
      data: {
        tenantId: account.tenantId,
        brandId: account.brandId,
        platform: account.platform,
        contentItemId: content.id,
        status: ReputationStatus.classified,
        priority: priorityFor(hybrid.level),
        requiresApproval,
        riskLevel: hybrid.level as unknown as DbRiskLevel,
        riskConfidence: hybrid.confidence,
        riskCategories: hybrid.categories,
        sentiment: hybrid.sentiment as unknown as DbSentiment,
        riskRationale: hybrid.explanation.shortReason || hybrid.engine,
        riskEngine: hybrid.engine,
        assessedAt: new Date(),
        ...buildIntelFromHybrid(hybrid),
        // V1.44B — truthful per-item processing state (from the metering service; normalized reason).
        processingTier: hybrid.processingTier,
        processingStatus: hybrid.processingStatus,
        processingReason: hybrid.processingReason ?? null,
        lastProcessedAt: new Date(),
        classifierVersion: "risk-rules-v1",
        contentHash: hybrid.contentHash,
      },
    });

    if (hybrid.providerCalls.length > 0) {
      await db.providerCall.createMany({
        data: hybrid.providerCalls.map((c) => ({
          type: c.type, provider: c.provider, status: c.status, latencyMs: c.latencyMs,
          errorCode: c.errorCode ?? null, itemId: repItem.id, tenantId: account.tenantId, brandId: account.brandId,
        })),
      });
    }

    // Audit when brand memory influenced the classification (no secrets/tokens).
    if (hybrid.memoryMatched.length > 0) {
      await auditTx(db, account, "classifier.brand_memory_used", {
        itemId: repItem.id,
        matched: hybrid.memoryMatched.map((m) => ({ type: m.type, effect: m.effect })),
      });
    }

    // Record the Auto-Protect decision (shadow only — no platform action taken).
    await db.autoProtectDecision.upsert({
      where: { itemId: repItem.id },
      create: {
        tenantId: account.tenantId, brandId: account.brandId, itemId: repItem.id,
        matchedCategory: autoProtect.matchedCategory, policyMode: autoProtect.policyMode,
        confidence: autoProtect.confidence, decision: autoProtect.decision, reason: autoProtect.reason,
      },
      update: {
        matchedCategory: autoProtect.matchedCategory, policyMode: autoProtect.policyMode,
        confidence: autoProtect.confidence, decision: autoProtect.decision, reason: autoProtect.reason,
      },
    });
    if (autoProtect.decision === "would_auto_hide") {
      await auditTx(db, account, "auto_protect.would_auto_hide", {
        itemId: repItem.id, category: autoProtect.matchedCategory, mode: autoProtect.policyMode, executed: false,
      });
    }
    return { repItem: { id: repItem.id }, outcome: "created" as IngestOutcome };
  });

  // A concurrent duplicate created the ReputationItem first — no side-effects to run.
  if (p3.outcome === "updated" || !p3.repItem) return "updated";
  const repItem = p3.repItem;

  // Phase P4 — Control Center. Read policies, evaluate (pure), upsert the queue item.
  const controlPolicies = await withTenantDb(tenantId, (db) => db.controlPolicy.findMany({
    where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
    select: { id: true, category: true, mode: true, minConfidence: true, isActive: true },
  }));
  if (controlPolicies.length > 0) {
    const decision = evaluateControl(
      { text: item.text, riskSignals: hybrid.explanation.riskSignals, categories: hybrid.categories, sentiment: hybrid.sentiment, riskLevel: hybrid.level, confidence: hybrid.confidence },
      controlPolicies,
    );
    const queued = await withTenantDb(tenantId, (db) => db.actionQueueItem.upsert({
      where: { itemId: repItem.id },
      create: { tenantId: account.tenantId, brandId: account.brandId, itemId: repItem.id, category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
      update: { category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
    }));

    // Autonomous execution attempt — gated + fail-closed (default: dry_run/blocked, 0 live).
    // loadProductionSafetyContext + attemptFacebookHide manage their OWN short tenant
    // transactions and provider HTTP; they are called OUTSIDE any open transaction here.
    const matchedPolicy = controlPolicies.find((p) => p.category === decision.matchedCategory);
    if (matchedPolicy?.mode === "autonomous" && decision.wouldExecute) {
      const safety = await loadProductionSafetyContext({
        tenantId: account.tenantId, brandId: account.brandId, connectedAccountId: account.id, category: decision.matchedCategory,
      });
      const res = await attemptFacebookHide({
        tenantId: account.tenantId, brandId: account.brandId, itemId: repItem.id,
        queueItemId: queued.id, policyId: matchedPolicy.id,
        connectedAccountId: account.id, platform: account.platform,
        externalCommentId: item.externalId, externalPostId: item.externalParentId ?? null,
        matchedCategory: decision.matchedCategory, confidence: decision.confidence, riskLevel: hybrid.level,
        mode: matchedPolicy.mode, trigger: "autonomous",
        account: {
          status: account.status as unknown as string, health: account.health as unknown as string,
          grantedPermissions: account.grantedPermissions, accessToken: decryptToken(account.longLivedToken ?? account.accessToken) ?? null,
          pageId: account.pageId, externalId: account.externalId,
          tokenExpiresAt: account.tokenExpiresAt, needsReconnect: account.connectionStatus === "needs_reconnect" || account.tokenHealth === "expired" || account.tokenHealth === "invalid" || account.tokenHealth === "revoked" || account.lastError === "token_expired",
          connectionStatus: account.connectionStatus, tokenHealth: account.tokenHealth,
        },
        requestedBy: "system",
      }, { safety });
      // V1.28A queue routing: TERMINAL blocks (comment gone / Facebook refuses the
      // hide) are resolved — no human can act on them. Everything else that blocked
      // an autonomous hide routes to human approval (safety gates, limits, token).
      if (res.status === "blocked") {
        const terminal = res.reason === "comment_deleted_or_unavailable" || res.reason === "facebook_can_hide_false";
        if (!terminal) {
          await withTenantDb(tenantId, (db) => db.actionQueueItem.update({ where: { id: queued.id }, data: { queueState: "approval_required", safetyBlocked: true } }));
        }
      }
    }

    // Phase P5 — incident escalation (short tenant tx). V1.37.4/5: the related item is
    // recorded BOTH in the denormalized `relatedItemIds` cache and, referentially-integral,
    // in the `incidentRelatedItem` join table (real composite FKs, cross-tenant impossible).
    if (decision.raisesIncident && (hybrid.level === "high" || hybrid.level === "critical")) {
      await withTenantDb(tenantId, async (db) => {
        const open = await db.incident.findFirst({ where: { brandId: account.brandId, category: decision.matchedCategory, status: "open" } });
        let incidentId: string;
        if (open) {
          incidentId = open.id;
          if (!open.relatedItemIds.includes(repItem.id)) await db.incident.update({ where: { id: open.id }, data: { relatedItemIds: { push: repItem.id } } });
        } else {
          const inc = await db.incident.create({ data: { tenantId: account.tenantId, brandId: account.brandId, title: `${decision.matchedCategory.replace(/_/g, " ")} detected`, category: decision.matchedCategory, severity: hybrid.level === "critical" ? "critical" : "high", status: "open", sourcePlatform: account.platform, relatedItemIds: [repItem.id] } });
          incidentId = inc.id;
          await auditTx(db, account, "incident.created", { incidentId: inc.id, category: decision.matchedCategory });
        }
        await db.incidentRelatedItem.createMany({ data: [{ tenantId: account.tenantId, incidentId, reputationItemId: repItem.id }], skipDuplicates: true });
      });
    }
  }
  return "created";
}

function priorityFor(level: string): Priority {
  switch (level) {
    case DbRiskLevel.critical:
      return Priority.urgent;
    case DbRiskLevel.high:
      return Priority.high;
    case DbRiskLevel.medium:
      return Priority.normal;
    default:
      return Priority.low;
  }
}

/** Tenant-scoped system audit entry inside an existing tenant tx. Never includes token material. */
async function auditTx(
  db: TenantTx,
  account: Pick<AccountRow, "tenantId" | "brandId" | "id" | "platform">,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: account.tenantId,
      brandId: account.brandId,
      event,
      actorKind: ActorKind.system,
      targetType: "connected_account",
      targetId: account.id,
      metadata: { platform: account.platform, ...metadata },
    },
  });
}

function zero(ok: boolean, message: string): SyncOutcome {
  return {
    ok,
    mock: false,
    fetched: 0,
    created: 0,
    updated: 0,
    deduped: 0,
    errors: 0,
    durationMs: 0,
    message,
    verdict: ok ? "success" : "failed",
  };
}

/**
 * Follow-up job: turn stored webhook events into TARGETED read-only syncs.
 *
 * Gated by META_WEBHOOK_SYNC (default OFF). When off this is a no-op. When on it
 * only ever runs read-only sync (dedup-safe) for the affected accounts and marks
 * events processed — it NEVER takes a moderation action.
 */
export interface WebhookProcessResult {
  enabled: boolean;
  processed: number;
  matched: number;
  ignored: number;
  failed: number;
  synced: number;
}

export async function processPendingWebhookEvents(): Promise<WebhookProcessResult> {
  const cfg = getMetaConfig();
  if (!cfg.webhookSync) {
    return { enabled: false, processed: 0, matched: 0, ignored: 0, failed: 0, synced: 0 };
  }

  // webhook_events is a GLOBAL table (no tenant RLS by design — provider webhooks
  // arrive before tenant resolution). It is read/updated with the system client via
  // the narrow discovery/system layer; tenant is resolved from the matched account.
  // V1.38.1 — reads BOTH Meta platforms and only SIGNATURE-VALID events (forged/unsigned
  // events are stored for audit but never processed). Replay is already rejected at
  // ingest by the unique dedupeKey, so each logical delivery is processed at most once.
  const events = await listUnprocessedMetaWebhooks(50);

  let matched = 0;
  let ignored = 0;
  let failed = 0;
  const syncedAccounts = new Set<string>();

  for (const ev of events) {
    try {
      const payload = ev.payload as { entry?: Array<{ id?: string }> } | null;
      const pageIds = new Set<string>();
      for (const entry of payload?.entry ?? []) {
        if (entry?.id) pageIds.add(String(entry.id));
      }

      // SYSTEM discovery — resolves the TRUSTED tenantId from the matched account
      // (never from the webhook payload itself). V1.38: a webhook entry id may be a
      // Facebook Page id OR an Instagram Business account id — the unified connector
      // resolves BOTH platforms and syncs each via the same tenant-scoped runtime path.
      const accounts = pageIds.size ? await findMetaAccountsByExternalIds([...pageIds]) : [];

      if (accounts.length === 0) {
        await markWebhookProcessed(ev.id, false);
        ignored++;
        continue;
      }

      for (const a of accounts) {
        if (syncedAccounts.has(a.id)) continue;
        syncedAccounts.add(a.id);
        // Same runtime path as the auto-sync worker, under the trusted tenant context.
        await runReadOnlySync({ accountId: a.id, tenantId: a.tenantId });
      }

      const first = accounts[0]!;
      await withTenantDb(first.tenantId, (db) => db.auditLog.create({
        data: {
          tenantId: first.tenantId,
          brandId: first.brandId,
          event: "webhook.processed",
          actorKind: ActorKind.system,
          targetType: "webhook_event",
          targetId: ev.id,
          metadata: { accounts: accounts.length, platforms: [...new Set(accounts.map((a) => a.platform))] },
        },
      }));
      await markWebhookProcessed(ev.id, true);
      matched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mark processed to avoid tight retry loops; record the error on the event.
      await markWebhookProcessed(ev.id, false, msg);
      failed++;
    }
  }

  return {
    enabled: true,
    processed: events.length,
    matched,
    ignored,
    failed,
    synced: syncedAccounts.size,
  };
}

export { mockMetaFetch } from "./mock-fetch";
export {
  fetchInstagramContent,
  classifyIgPermissionState,
  IG_MAX_MEDIA_PAGES,
  IG_MAX_COMMENT_PAGES_PER_MEDIA,
  type IgPermissionState,
  type IgIngestResult,
} from "./instagram-content";
export * from "./live-actions";
export * from "./facebook-connector";
export * from "./instagram-connector";
export * from "./instagram-moderation";
export * from "./google-business-connector";
export * from "./production-safety";
export * from "./connection-manager";
export * from "./provider-revoke";
export * from "./disconnect";
export * from "./meta-connector";
export * from "./metered-classify";
export * from "./paid-ai-guard";
