/**
 * M5 — native Action Queue: list, detail, and INTERNAL decision actions.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROVIDER-WRITE BOUNDARY — the defining property of this module.
 *
 * Nothing here can execute a provider action. Mobile Approve records a DECISION
 * only: it sets the queue state and writes the canonical audit event, and it never
 * reaches `runHideForQueueItem` / `attemptFacebookHide` / any connector. This is
 * the same semantic the web already ships as `approveWithoutHide`.
 *
 * That is deliberately STRICTER than the web `approveQueueItem`, which does call
 * the hide path — though even there a manual approval is hard-capped at `dry_run`
 * by `attemptFacebookHide` (`if (ctx.trigger !== "autonomous") → dry_run`). Mobile
 * does not rely on that cap; it simply never enters the path, so no provider module
 * is reachable from a mobile route at all.
 *
 * Live hide, retry and rollback are NOT exposed. Readiness is INFORMATION only.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything is injected and this module imports no runtime value (types only), so
 * the whole lifecycle is unit-testable without a database, a provider or Next.
 *
 * WIRE CONTRACT: bounded keys, never prose and never a raw stored value. Absent
 * from every response: tenant/brand ids, provider tokens, raw Graph errors, raw
 * audit metadata, AI diagnostics, and live-environment configuration.
 */

import type { OpsEvent } from "@guardora/core";
import type { SessionRejectReason } from "@guardora/db";
import type { ShellSessionDeps } from "./mobile-shell";

/* -------------------------------------------------------------------------- */
/* Bounded vocabularies — the canonical enums, nothing invented                */
/* -------------------------------------------------------------------------- */

/** Canonical queue tabs (`QUEUE_TABS` in @guardora/ai). */
export const QUEUE_TAB_KEYS = ["active", "approval", "blocked", "resolved", "all"] as const;
export type QueueTabKey = (typeof QUEUE_TAB_KEYS)[number];

/** Canonical `QueueState` union. */
export const QUEUE_STATES = [
  "suggested", "approval_required", "approved", "rejected", "blocked_by_safety",
  "dry_run", "executed", "failed", "rollback_needed", "monitor", "no_action",
] as const;
export type QueueStateKey = (typeof QUEUE_STATES)[number];

/** Canonical `ControlAction` union — what Tamanor proposes doing. */
export const PROPOSED_ACTIONS = [
  "notify", "create_inbox_item", "suggest_reply", "request_approval", "hide_comment",
  "report", "escalate", "assign_to_user", "create_incident", "no_action",
] as const;
export type ProposedActionKey = (typeof PROPOSED_ACTIONS)[number];

/** `PlatformActionExecution.status`. */
export const EXECUTION_STATUSES = [
  "blocked", "dry_run", "executed", "failed", "rollback_pending", "rolled_back",
] as const;
export type ExecutionStatusKey = (typeof EXECUTION_STATUSES)[number];

/** Execution trigger — an autonomous policy run reads very differently to an approval. */
export const EXECUTION_TRIGGERS = ["approval", "autonomous"] as const;
export type ExecutionTriggerKey = (typeof EXECUTION_TRIGGERS)[number];

/**
 * Bounded reason vocabulary. Every value is produced by the canonical `gate()` /
 * execution recorder; anything outside this set is mapped to `unavailable` so an
 * internal string can never reach a customer.
 */
export const QUEUE_REASONS = [
  "global_disabled", "facebook_hide_disabled", "unsupported_platform", "account_is_demo",
  "account_not_active", "reconnect_required", "token_not_healthy", "token_expired",
  "unhealthy_account", "missing_permission", "safety_never_autonomous",
  "category_not_eligible", "policy_not_autonomous", "low_confidence",
  "threat_requires_critical", "missing_comment_id",
  "dry_run_mode", "dry_run_still_enabled", "live_not_enabled", "live_confirm_required",
  "already_executed", "comment_deleted_or_unavailable", "provider_error", "unavailable",
] as const;
export type QueueReasonKey = (typeof QUEUE_REASONS)[number];

/** `predictHideOutcome` result — READINESS INFORMATION ONLY. No live button follows it. */
export const READINESS_STATES = ["blocked", "dry_run", "live_possible", "already_executed", "not_applicable"] as const;
export type ReadinessKey = (typeof READINESS_STATES)[number];

/** Read-only comment lifecycle, when the server already knows it. */
export const LIFECYCLE_STATES = ["visible", "hidden", "deleted", "cannot_hide", "unknown"] as const;
export type LifecycleKey = (typeof LIFECYCLE_STATES)[number];

/** Control-policy mode. */
export const POLICY_MODES = ["monitor", "assist", "approval", "autonomous"] as const;
export type PolicyModeKey = (typeof POLICY_MODES)[number];

/** Bounded audit vocabulary for the detail activity timeline. */
export const QUEUE_AUDIT_EVENTS = [
  "approval.approved", "approval.rejected", "approval.resolved", "approval.retried",
  "platform_action.live_requested", "platform_action.executed", "platform_action.blocked",
  "feedback.created", "incident.created",
] as const;
export type QueueAuditEvent = (typeof QUEUE_AUDIT_EVENTS)[number];

/** The INTERNAL decisions mobile may make. Provider actions are deliberately absent. */
export const QUEUE_DECISIONS = ["approve", "reject", "resolve"] as const;
export type QueueDecisionKey = (typeof QUEUE_DECISIONS)[number];

export type QueueError =
  | "unauthenticated" | "session_expired" | "session_revoked"
  | "verification_required" | "workspace_unsupported"
  | "permission_denied" | "read_only" | "conflict"
  | "invalid_request" | "not_found" | "server_error";

export interface QueueResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Transition rules — the server owns them                                     */
/* -------------------------------------------------------------------------- */

/**
 * States from which no decision may move an item. `executed` is terminal for
 * approve/reject (an execution cannot be un-run) but IS resolvable, matching the
 * web's "mark handled" usage after a hide completed.
 */
export const TERMINAL_STATES: QueueStateKey[] = ["rejected", "no_action"];

const APPROVE_FROM: QueueStateKey[] = ["suggested", "approval_required", "blocked_by_safety", "failed", "dry_run", "monitor"];
const REJECT_FROM: QueueStateKey[] = ["suggested", "approval_required", "blocked_by_safety", "failed", "dry_run", "monitor", "approved"];
const RESOLVE_FROM: QueueStateKey[] = ["suggested", "approval_required", "blocked_by_safety", "failed", "dry_run", "monitor", "approved", "executed", "rollback_needed"];

/** The states a decision may be applied FROM. Used as an ATOMIC guard, not just a check. */
export function allowedFromStates(decision: QueueDecisionKey): QueueStateKey[] {
  return decision === "approve" ? APPROVE_FROM : decision === "reject" ? REJECT_FROM : RESOLVE_FROM;
}

/** The state a decision moves the item TO. */
export function targetStateFor(decision: QueueDecisionKey): QueueStateKey {
  return decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "no_action";
}

export function canApplyDecision(decision: QueueDecisionKey, current: QueueStateKey | string): boolean {
  return (allowedFromStates(decision) as string[]).includes(current);
}

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

export interface QueueExecutionDto {
  status: ExecutionStatusKey;
  trigger: ExecutionTriggerKey;
  reason: QueueReasonKey | null;
  at: string;
}

export interface QueueListItem {
  id: string;
  /** For the "Open comment" link into the M4 Inbox. Null when the item is gone. */
  relatedInboxItemId: string | null;
  proposedAction: ProposedActionKey;
  queueState: QueueStateKey;
  category: string;
  reason: QueueReasonKey | null;
  createdAt: string;

  contentPreview: string | null;
  contentType: "comment" | "review" | null;
  author: string | null;
  platform: string | null;
  account: string | null;
  rating: number | null;
  /** Customer-visible severity, already safe-capped by the canonical projection. */
  risk: string | null;

  /** Latest execution, if any. Null means nothing has been attempted. */
  execution: QueueExecutionDto | null;
  lifecycle: LifecycleKey;

  /** UX affordances — the server re-checks all of them on every mutation. */
  canApprove: boolean;
  canReject: boolean;
  canResolve: boolean;
}

export interface QueueDetail extends QueueListItem {
  /** Full text. Null for a rating-only review or a removed item. */
  contentText: string | null;
  confidence: number | null;
  policy: { mode: PolicyModeKey | null; neverAutonomous: boolean; autonomousEligible: boolean };
  readiness: { state: ReadinessKey; reason: QueueReasonKey | null };
  /** Every execution for this item, newest first — the platform-action history. */
  executions: QueueExecutionDto[];
  activity: { id: string; event: QueueAuditEvent; at: string }[];
}

export interface QueueCountsDto {
  active: number;
  approval: number;
  blocked: number;
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

/** A row already reduced to bounded values by the deps layer. */
export interface QueueSourceRow extends Omit<QueueListItem, "canApprove" | "canReject" | "canResolve"> {
  /** Raw current state, used for the transition guard. */
  state: QueueStateKey;
}

export interface QueueDetailSource extends QueueSourceRow {
  contentText: string | null;
  confidence: number | null;
  policy: { mode: PolicyModeKey | null; neverAutonomous: boolean; autonomousEligible: boolean };
  readiness: { state: ReadinessKey; reason: QueueReasonKey | null };
  executions: QueueExecutionDto[];
  activity: { id: string; event: string; at: Date }[];
}

export interface QueueListResult {
  rows: QueueSourceRow[];
  nextCursor: string | null;
  hasMore: boolean;
  counts: QueueCountsDto;
}

/** The result of an ATOMIC conditional decision write. */
export type DecisionOutcome =
  | { ok: true }
  /** The guard matched nothing — someone else already decided this item. */
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "not_found" };

export interface QueueDeps extends ShellSessionDeps {
  /** `Permission.ProposalApprove` — the canonical decision gate. */
  canApprove: (role: string) => boolean;
  /**
   * Authoritative operations gate (`tenantAllowsOperations`).
   *
   * NOTE: this gates PROVIDER EXECUTION on web, not internal decisions — the web
   * approve/reject/markHandled Server Actions do not consult it. Mobile matches
   * that behaviour so the two surfaces agree; see `handleQueueDecision`.
   */
  tenantAllowsOperations: (tenantId: string) => Promise<boolean>;

  listQueue: (input: {
    tenantId: string;
    tab: QueueTabKey;
    cursor: string | null;
  }) => Promise<QueueListResult>;

  /** Resolves WITHIN the tenant. Null for a foreign or missing item alike. */
  getQueueItem: (input: { tenantId: string; itemId: string }) => Promise<QueueDetailSource | null>;

  /**
   * ATOMIC conditional decision. Must update ONLY when the current state is in
   * `allowedFrom`, and must write the canonical audit event. Never touches a provider.
   */
  applyDecision: (input: {
    tenantId: string;
    userId: string;
    itemId: string;
    decision: QueueDecisionKey;
    allowedFrom: QueueStateKey[];
    target: QueueStateKey;
  }) => Promise<DecisionOutcome>;

  countsFor: (tenantId: string) => Promise<QueueCountsDto>;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const err = (status: number, error: QueueError): QueueResponse => ({ status, body: { error } });

export function normalizeTab(raw: string | null | undefined): QueueTabKey {
  return (QUEUE_TAB_KEYS as readonly string[]).includes(raw ?? "") ? (raw as QueueTabKey) : "active";
}

/** Narrow an arbitrary stored string to a bounded key, or fall back safely. */
export function bounded<T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** A stored reason that is not in the bounded vocabulary becomes `unavailable`. */
export function boundedReason(raw: unknown): QueueReasonKey | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return bounded(QUEUE_REASONS, raw, "unavailable");
}

export function isKnownQueueAudit(event: string): event is QueueAuditEvent {
  return (QUEUE_AUDIT_EVENTS as readonly string[]).includes(event);
}

/** Preview length for a queue row. */
export const PREVIEW_LENGTH = 200;
export function previewOf(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.length <= PREVIEW_LENGTH ? t : `${t.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

/** Project a source row into the client DTO, applying the transition affordances. */
export function toListItem(row: QueueSourceRow, mayDecide: boolean): QueueListItem {
  const { state, ...rest } = row;
  return {
    ...rest,
    // Affordances are the server's own transition rules AND the role gate — the
    // client cannot widen them, and the server re-checks on every mutation.
    canApprove: mayDecide && canApplyDecision("approve", state),
    canReject: mayDecide && canApplyDecision("reject", state),
    canResolve: mayDecide && canApplyDecision("resolve", state),
  };
}

/* -------------------------------------------------------------------------- */
/* Gate                                                                        */
/* -------------------------------------------------------------------------- */

export type QueueGate =
  | { ok: true; session: { userId: string; tenantId: string; role: string } }
  | { ok: false; response: QueueResponse };

/**
 * The read gate: valid session → verified email → BUSINESS workspace. Identical to
 * M3/M4; re-stated here so this module holds no runtime imports.
 */
export async function authorizeQueueRead(
  authorization: string | null | undefined,
  deps: ShellSessionDeps,
): Promise<QueueGate> {
  const token = /^Bearer[ ]+(\S+)$/.exec((authorization ?? "").trim())?.[1] ?? null;
  if (!token) return { ok: false, response: err(401, "unauthenticated") };

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const reason: SessionRejectReason | undefined = result.reason;
    if (reason === "session_expired_idle") deps.emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") deps.emitOpsEvent("auth.session_expired_absolute", { reason });

    const mapped: QueueError =
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

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/action-queue                                                */
/* -------------------------------------------------------------------------- */

export async function handleQueueList(
  req: { authorization: string | null | undefined; tab: string | null | undefined; cursor: string | null | undefined },
  deps: QueueDeps,
): Promise<QueueResponse> {
  const gate = await authorizeQueueRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const tab = normalizeTab(req.tab);
  const mayDecide = deps.canApprove(gate.session.role);

  let result: QueueListResult;
  try {
    result = await deps.listQueue({
      // Tenant from the validated session — never from the request.
      tenantId: gate.session.tenantId,
      tab,
      cursor: req.cursor?.trim() || null,
    });
  } catch {
    return err(500, "server_error");
  }

  return {
    status: 200,
    body: {
      items: result.rows.map((row) => toListItem(row, mayDecide)),
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
      counts: result.counts,
      tab,
      canDecide: mayDecide,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/action-queue/:id                                            */
/* -------------------------------------------------------------------------- */

export async function handleQueueDetail(
  req: { authorization: string | null | undefined; itemId: string | null | undefined },
  deps: QueueDeps,
): Promise<QueueResponse> {
  const gate = await authorizeQueueRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const itemId = req.itemId?.trim();
  if (!itemId) return err(400, "invalid_request");

  let row: QueueDetailSource | null;
  try {
    // Tenant-scoped. A foreign item resolves to null exactly as a missing one does.
    row = await deps.getQueueItem({ tenantId: gate.session.tenantId, itemId });
  } catch {
    return err(500, "server_error");
  }
  if (!row) return err(404, "not_found");

  const mayDecide = deps.canApprove(gate.session.role);
  const detail: QueueDetail = {
    ...toListItem(row, mayDecide),
    contentText: row.contentText,
    confidence: row.confidence,
    policy: row.policy,
    readiness: row.readiness,
    executions: row.executions,
    // Unknown audit events are DROPPED — an internal event name never reaches the UI,
    // and no audit metadata is forwarded at all.
    activity: row.activity
      .filter((a) => isKnownQueueAudit(a.event))
      .map((a) => ({ id: a.id, event: a.event as QueueAuditEvent, at: a.at.toISOString() })),
  };

  return { status: 200, body: { item: detail, canDecide: mayDecide } };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/action-queue/:id/decision                                  */
/* -------------------------------------------------------------------------- */

/**
 * One INTERNAL decision endpoint: approve, reject or resolve.
 *
 * NO PROVIDER PATH. Approve records the decision and its audit event; it does not
 * call `runHideForQueueItem`, `attemptFacebookHide`, or any connector. Live hide,
 * retry and rollback are not expressible here — `QueueDecisionKey` has no member
 * for them.
 *
 * The write is ATOMIC and CONDITIONAL: the update matches only when the item is
 * still in an allowed state, so two operators deciding at once cannot silently
 * overwrite each other's terminal decision. A losing race returns 409 with the
 * canonical current state rather than rewriting history.
 */
export async function handleQueueDecision(
  req: { authorization: string | null | undefined; itemId: string | null | undefined; body: unknown },
  deps: QueueDeps,
): Promise<QueueResponse> {
  const gate = await authorizeQueueRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  // 1) Canonical RBAC — the same permission the web Server Actions assert.
  if (!deps.canApprove(gate.session.role)) return err(403, "permission_denied");

  const itemId = req.itemId?.trim();
  if (!itemId) return err(400, "invalid_request");

  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return err(400, "invalid_request");
  const raw = body as Record<string, unknown>;

  const decision = (QUEUE_DECISIONS as readonly string[]).includes(
    typeof raw.decision === "string" ? raw.decision : "",
  )
    ? (raw.decision as QueueDecisionKey)
    : null;
  if (!decision) return err(400, "invalid_request");

  // 2) Confirm the item exists inside THIS tenant before deciding anything.
  let current: QueueDetailSource | null;
  try {
    current = await deps.getQueueItem({ tenantId: gate.session.tenantId, itemId });
  } catch {
    return err(500, "server_error");
  }
  if (!current) return err(404, "not_found");

  // 3) Transition guard, re-evaluated server-side. The client's `canApprove` hint is
  //    never consulted.
  if (!canApplyDecision(decision, current.state)) {
    return {
      status: 409,
      body: {
        error: "conflict" satisfies QueueError,
        // Hand back the canonical current state so the client can resync truthfully.
        item: toListItem(current, true),
      },
    };
  }

  let outcome: DecisionOutcome;
  try {
    outcome = await deps.applyDecision({
      tenantId: gate.session.tenantId,
      userId: gate.session.userId,
      itemId,
      decision,
      allowedFrom: allowedFromStates(decision),
      target: targetStateFor(decision),
    });
  } catch {
    return err(500, "server_error");
  }

  if (!outcome.ok) {
    if (outcome.reason === "not_found") return err(404, "not_found");
    // Lost the race: another operator decided between our read and our write.
    let fresh: QueueDetailSource | null = null;
    try {
      fresh = await deps.getQueueItem({ tenantId: gate.session.tenantId, itemId });
    } catch {
      fresh = null;
    }
    return {
      status: 409,
      body: {
        error: "conflict" satisfies QueueError,
        item: fresh ? toListItem(fresh, true) : null,
      },
    };
  }

  // 4) Return the fresh canonical state plus recomputed counts, so the client
  //    patches one row and reconciles the badge without refetching the dashboard.
  let item: QueueListItem | null = null;
  let counts: QueueCountsDto | null = null;
  try {
    const updated = await deps.getQueueItem({ tenantId: gate.session.tenantId, itemId });
    item = updated ? toListItem(updated, true) : null;
    counts = await deps.countsFor(gate.session.tenantId);
  } catch {
    item = null;
    counts = null;
  }

  return { status: 200, body: { ok: true, item, counts } };
}

export type { OpsEvent };
