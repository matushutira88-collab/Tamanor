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
  prisma,
  ActorKind,
  ConnectorHealth,
  Platform as DbPlatform,
  Priority,
  ReputationStatus,
  RiskLevel as DbRiskLevel,
  Sentiment as DbSentiment,
  SyncRunStatus,
  ConnectorStatus,
  ContentKind,
  decryptToken,
} from "@guardora/db";
import { classifyHybrid, buildIntelFromHybrid, evaluateAutoProtect, evaluateControl, type ClassifierRule } from "@guardora/ai";
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
  type FetchedContent,
} from "@guardora/connectors";
import { getMetaConfig, getTranslationConfig, getAiRiskConfig } from "@guardora/config";
import { mockMetaFetch } from "./mock-fetch";

export interface SyncOutcome {
  ok: boolean;
  mock: boolean;
  fetched: number;
  created: number;
  deduped: number;
  errors: number;
  durationMs: number;
  message: string;
  syncRunId?: string;
  /** True when the failure means the user must re-authorize. */
  needsReconnect?: boolean;
  /** True when the failure is a transient rate limit — retry later. */
  retryLater?: boolean;
}

/** A token/auth problem (expired/invalid) that requires the user to reconnect. */
class ReconnectRequiredError extends Error {}
/** A transient platform rate limit — retry after backoff, no user action. */
class RateLimitedError extends Error {}
/** A missing-permission problem — the user must re-grant scopes (reconnect). */
class PermissionRequiredError extends Error {}

interface FetchResult {
  items: FetchedContent[];
  cursor?: string;
}

/** Conservative backoff schedule (minutes) — NOT an aggressive retry loop. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];
function nextRetryFor(attempts: number): Date {
  const idx = Math.min(attempts, BACKOFF_MINUTES.length) - 1;
  const minutes = BACKOFF_MINUTES[Math.max(0, idx)] ?? 360;
  return new Date(Date.now() + minutes * 60_000);
}

type AccountRow = NonNullable<
  Awaited<ReturnType<typeof prisma.connectedAccount.findUnique>>
>;

export async function runReadOnlySync(
  accountId: string,
  trigger: "manual" | "automatic" = "manual",
): Promise<SyncOutcome> {
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) {
    return zero(false, "Connected account not found.");
  }

  const mode = account.mode as unknown as CoreMode;
  if (!modeAllowsSync(mode)) {
    return zero(false, `Sync is not available in "${account.mode}" mode.`);
  }

  // Mock fetch is ONLY for placeholder (demo) accounts. A real (read_only)
  // account is NEVER injected with mock data — if live sync isn't enabled it is
  // skipped cleanly. This keeps real testing free of mock content.
  const meta = getMetaConfig();
  const isReal = isRealConnection(mode);
  const useMock = !isReal;
  if (isReal && !meta.liveSync) {
    return zero(false, "Live Meta sync is not enabled (META_LIVE_SYNC=false). No mock data is injected for a real account.");
  }

  const run = await prisma.syncRun.create({
    data: {
      tenantId: account.tenantId,
      brandId: account.brandId,
      connectedAccountId: account.id,
      status: SyncRunStatus.running,
      mock: useMock,
    },
  });
  await audit(account, "sync.started", { mock: useMock, trigger });
  const startedAt = Date.now();

  try {
    const { items: fetched, cursor } = await fetchContent(account, mode, useMock);
    const rules = await loadRules(account.brandId);

    let created = 0;
    let deduped = 0;
    for (const item of fetched) {
      const existing = await prisma.contentItem.findUnique({
        where: {
          connectedAccountId_externalId: {
            connectedAccountId: account.id,
            externalId: item.externalId,
          },
        },
        select: { id: true },
      });
      if (existing) {
        deduped++;
        continue;
      }
      await persistItem(account, item, rules);
      created++;
    }

    const durationMs = Date.now() - startedAt;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.completed,
        fetched: fetched.length,
        created,
        deduped,
        durationMs,
        cursor: cursor ?? null,
        finishedAt: new Date(),
      },
    });
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastCursor: cursor ?? undefined,
        health: ConnectorHealth.healthy,
        lastError: null,
        lastErrorAt: null,
        // Success clears any backoff state.
        syncAttempts: 0,
        nextRetryAt: null,
      },
    });
    await audit(account, "sync.completed", {
      mock: useMock,
      fetched: fetched.length,
      created,
      deduped,
      durationMs,
      trigger,
    });

    return {
      ok: true,
      mock: useMock,
      fetched: fetched.length,
      created,
      deduped,
      errors: 0,
      durationMs,
      message: useMock
        ? "Mock read-only sync completed (labelled MOCK data, no live API call)."
        : "Read-only sync completed.",
      syncRunId: run.id,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    const isTokenExpired = err instanceof ReconnectRequiredError;
    const isPermission = err instanceof PermissionRequiredError;
    const isRateLimited = err instanceof RateLimitedError;
    const needsReconnect = isTokenExpired || isPermission;

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncRunStatus.failed,
        error: msg,
        errors: 1,
        durationMs,
        finishedAt: new Date(),
      },
    });
    // Backoff: reconnect-class failures won't be helped by a retry until the
    // user acts, so we schedule none. Transient failures (incl. rate limits) get
    // a conservative backoff so the worker skips the account until nextRetryAt.
    const attempts = (account.syncAttempts ?? 0) + 1;
    const nextRetryAt = needsReconnect ? null : nextRetryFor(attempts);

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        // Auth/expiry/permission problems flip the account to expired so the UI
        // prompts a reconnect. Rate limits are transient → degraded, keep active.
        status: needsReconnect ? ConnectorStatus.expired : undefined,
        health: needsReconnect
          ? ConnectorHealth.degraded
          : isRateLimited
            ? ConnectorHealth.degraded
            : ConnectorHealth.error,
        lastError: msg,
        lastErrorAt: new Date(),
        syncAttempts: attempts,
        nextRetryAt,
      },
    });

    // Distinct audit events per failure class.
    const event = isTokenExpired
      ? "sync.token_expired"
      : isPermission
        ? "sync.permission_error"
        : isRateLimited
          ? "sync.rate_limited"
          : "sync.failed";
    await audit(account, event, { error: msg, needsReconnect, retryLater: isRateLimited });

    return {
      ok: false,
      mock: useMock,
      fetched: 0,
      created: 0,
      deduped: 0,
      errors: 1,
      durationMs,
      message: msg,
      syncRunId: run.id,
      needsReconnect,
      retryLater: isRateLimited,
    };
  }
}

async function fetchContent(
  account: AccountRow,
  mode: CoreMode,
  useMock: boolean,
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
    );
  }
  const token = decryptToken(account.longLivedToken ?? account.accessToken);
  if (!token) {
    throw new ReconnectRequiredError(
      "No usable access token is stored — reconnect required.",
    );
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

async function loadRules(brandId: string): Promise<ClassifierRule[]> {
  const rules = await prisma.brandRule.findMany({
    where: { brandId, enabled: true },
  });
  return rules.map((r) => ({
    category: r.category as unknown as ClassifierRule["category"],
    phrases: r.phrases,
    enabled: r.enabled,
  }));
}

async function persistItem(
  account: AccountRow,
  item: FetchedContent,
  rules: ClassifierRule[],
): Promise<void> {
  const brand = await prisma.brand.findUnique({
    where: { id: account.brandId },
    select: { defaultLocale: true },
  });

  // Brand-scoped active memory rules (never cross-brand).
  const memoryRules = await prisma.brandRiskMemoryRule.findMany({
    where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
    select: { type: true, normalizedPhrase: true, language: true, severity: true, isActive: true },
  });

  const hybrid = await classifyHybrid(
    { text: item.text, platform: item.platform, locale: item.author.locale, rating: item.rating, rules },
    {
      workspaceLocale: brand?.defaultLocale ?? "en",
      translation: getTranslationConfig(),
      aiRisk: getAiRiskConfig(),
      memoryRules,
    },
  );

  // Auto-Protect evaluation (shadow only — never executes a platform action).
  const policies = await prisma.brandAutoProtectPolicy.findMany({
    where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
    select: { category: true, mode: true, minConfidence: true, isActive: true },
  });
  const autoProtect = evaluateAutoProtect(
    { text: item.text, riskLevel: hybrid.level, categories: hybrid.categories, riskSignals: hybrid.explanation.riskSignals, matchedTerms: hybrid.explanation.matchedTerms, sentiment: hybrid.sentiment, confidence: hybrid.confidence },
    policies,
  );
  const requiresApproval = hybrid.approvalRequired || autoProtect.decision === "requires_approval";

  const content = await prisma.contentItem.create({
    data: {
      tenantId: account.tenantId,
      brandId: account.brandId,
      connectedAccountId: account.id,
      platform: account.platform,
      kind: (item.kind as unknown as ContentKind) ?? ContentKind.comment,
      externalId: item.externalId,
      externalParentId: item.externalParentId ?? null,
      text: item.text,
      authorExternalId: item.author.externalId ?? null,
      authorDisplayName: item.author.displayName ?? null,
      authorLocale: item.author.locale ?? null,
      rating: item.rating ?? null,
      permalink: item.permalink ?? null,
      publishedAt: new Date(item.publishedAt),
    },
  });

  const repItem = await prisma.reputationItem.create({
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
    },
  });

  await logProviderCalls(hybrid.providerCalls, {
    itemId: repItem.id,
    tenantId: account.tenantId,
    brandId: account.brandId,
  });

  // Audit when brand memory influenced the classification (no secrets/tokens).
  if (hybrid.memoryMatched.length > 0) {
    await audit(account, "classifier.brand_memory_used", {
      itemId: repItem.id,
      matched: hybrid.memoryMatched.map((m) => ({ type: m.type, effect: m.effect })),
    });
  }

  // Record the Auto-Protect decision (shadow only — no platform action taken).
  await prisma.autoProtectDecision.upsert({
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
    await audit(account, "auto_protect.would_auto_hide", {
      itemId: repItem.id, category: autoProtect.matchedCategory, mode: autoProtect.policyMode, executed: false,
    });
  }

  // Control Center — the SINGLE source of truth. Evaluate the item against Control
  // Policies → Action Queue + incidents, and (only when the policy is autonomous)
  // attempt a gated hide (dry-run/blocked by default; never live unless env gates).
  const controlPolicies = await prisma.controlPolicy.findMany({
    where: { brandId: account.brandId, tenantId: account.tenantId, isActive: true },
    select: { id: true, category: true, mode: true, minConfidence: true, isActive: true },
  });
  if (controlPolicies.length > 0) {
    const decision = evaluateControl(
      { text: item.text, riskSignals: hybrid.explanation.riskSignals, categories: hybrid.categories, sentiment: hybrid.sentiment, riskLevel: hybrid.level, confidence: hybrid.confidence },
      controlPolicies,
    );
    const queued = await prisma.actionQueueItem.upsert({
      where: { itemId: repItem.id },
      create: { tenantId: account.tenantId, brandId: account.brandId, itemId: repItem.id, category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
      update: { category: decision.matchedCategory, confidence: decision.confidence, proposedAction: decision.proposedAction, queueState: decision.queueState, reason: decision.reason, safetyBlocked: decision.safetyBlocked, wouldExecute: decision.wouldExecute },
    });

    // Autonomous execution attempt — gated + fail-closed (default: dry_run/blocked, 0 live).
    // V1.27: also passes the Production Safe Mode envelope (kill switches, limits,
    // first-time category, crisis lock). A safety block/downgrade routes to approval.
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
      // Safety blocked/downgraded an autonomous hide → keep the item in approval, not live.
      if (res.status === "blocked") {
        await prisma.actionQueueItem.update({ where: { id: queued.id }, data: { queueState: "approval_required", safetyBlocked: true } });
      }
    }

    if (decision.raisesIncident && (hybrid.level === "high" || hybrid.level === "critical")) {
      const open = await prisma.incident.findFirst({ where: { brandId: account.brandId, category: decision.matchedCategory, status: "open" } });
      if (open) {
        if (!open.relatedItemIds.includes(repItem.id)) await prisma.incident.update({ where: { id: open.id }, data: { relatedItemIds: { push: repItem.id } } });
      } else {
        const inc = await prisma.incident.create({ data: { tenantId: account.tenantId, brandId: account.brandId, title: `${decision.matchedCategory.replace(/_/g, " ")} detected`, category: decision.matchedCategory, severity: hybrid.level === "critical" ? "critical" : "high", status: "open", sourcePlatform: account.platform, relatedItemIds: [repItem.id] } });
        await audit(account, "incident.created", { incidentId: inc.id, category: decision.matchedCategory });
      }
    }
  }
}

/** Persist provider-call observability rows. No tokens/secrets/text are stored. */
async function logProviderCalls(
  calls: { type: string; provider: string; status: string; latencyMs: number; errorCode?: string }[],
  ctx: { itemId: string; tenantId: string; brandId: string },
): Promise<void> {
  if (calls.length === 0) return;
  await prisma.providerCall.createMany({
    data: calls.map((c) => ({
      type: c.type,
      provider: c.provider,
      status: c.status,
      latencyMs: c.latencyMs,
      errorCode: c.errorCode ?? null,
      itemId: ctx.itemId,
      tenantId: ctx.tenantId,
      brandId: ctx.brandId,
    })),
  });
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

/** Tenant-scoped system audit entry. Never includes token material. */
async function audit(
  account: AccountRow,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
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
    deduped: 0,
    errors: 0,
    durationMs: 0,
    message,
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

  const events = await prisma.webhookEvent.findMany({
    where: { processed: false, platform: DbPlatform.facebook_page },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });

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

      const accounts = pageIds.size
        ? await prisma.connectedAccount.findMany({
            where: {
              externalId: { in: [...pageIds] },
              platform: DbPlatform.facebook_page,
              status: ConnectorStatus.active,
            },
            select: { id: true, tenantId: true, brandId: true },
          })
        : [];

      if (accounts.length === 0) {
        // Unmatched → ignored. Recorded on the event (no tenant to audit under).
        await prisma.webhookEvent.update({
          where: { id: ev.id },
          data: { processed: true, matched: false },
        });
        ignored++;
        continue;
      }

      for (const a of accounts) {
        if (syncedAccounts.has(a.id)) continue;
        syncedAccounts.add(a.id);
        await runReadOnlySync(a.id); // read-only; NEVER a moderation action
      }

      const first = accounts[0]!;
      await prisma.auditLog.create({
        data: {
          tenantId: first.tenantId,
          brandId: first.brandId,
          event: "webhook.processed",
          actorKind: ActorKind.system,
          targetType: "webhook_event",
          targetId: ev.id,
          metadata: { platform: "facebook_page", accounts: accounts.length },
        },
      });
      await prisma.webhookEvent.update({
        where: { id: ev.id },
        data: { processed: true, matched: true },
      });
      matched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mark processed to avoid tight retry loops; record the error on the event.
      await prisma.webhookEvent.update({
        where: { id: ev.id },
        data: { processed: true, matched: false, error: msg },
      });
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
export * from "./live-actions";
export * from "./production-safety";
export * from "./connection-manager";
