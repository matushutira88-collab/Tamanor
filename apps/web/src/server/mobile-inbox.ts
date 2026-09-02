/**
 * M4 — native Inbox: list, detail and safe INTERNAL write actions.
 *
 * Mirrors the web Inbox's server truth rather than re-deriving it. The filter model,
 * keyset pagination, counts and every mutation come from the canonical
 * `@guardora/db` inbox repo; the customer-visible classification comes from
 * `@guardora/ai`'s projection. Nothing about risk, sentiment or processing state is
 * reinterpreted here or on the device.
 *
 * Everything is injected and this module imports no runtime value (types only), so
 * the whole request lifecycle is unit-testable without a database or network.
 *
 * WIRE CONTRACT: the client receives BOUNDED KEYS, never prose and never a raw
 * stored value. Specifically absent from every response: tenant/user ids, raw DB
 * rows, provider tokens, session tokens, AI prompts/outputs, model/cost/token
 * diagnostics, raw audit metadata, and the admin-only `stored` block of the
 * classification projection.
 *
 * AUTHORIZATION: every endpoint re-runs the full gate (session → verified email →
 * BUSINESS workspace) and every MUTATION additionally re-checks `Permission.InboxAct`
 * and the billing write state server-side. The client's `canWrite` is UX only and is
 * never read here.
 */

import type { OpsEvent } from "@guardora/core";
import type { SessionRejectReason } from "@guardora/db";
import type { ShellSessionDeps } from "./mobile-shell";

/* -------------------------------------------------------------------------- */
/* Bounded vocabularies — exactly the canonical enums, nothing invented        */
/* -------------------------------------------------------------------------- */

export const INBOX_VIEWS = ["default", "unread", "archived", "assigned_me", "unassigned"] as const;
export type InboxViewKey = (typeof INBOX_VIEWS)[number];

/** Date narrowing. `all` means no lower bound — the inbox stays fully paginated. */
export const INBOX_RANGES = { all: null, today: 1, "7d": 7, "30d": 30 } as const;
export type InboxRangeKey = keyof typeof INBOX_RANGES;

export const INBOX_TYPES = ["comment", "review"] as const;
export type InboxTypeKey = (typeof INBOX_TYPES)[number];

export const INBOX_SENTIMENTS = ["positive", "neutral", "negative", "risky"] as const;
export type InboxSentimentKey = (typeof INBOX_SENTIMENTS)[number];

export const INBOX_WORKFLOWS = ["new", "in_review", "action_required", "resolved"] as const;
export type InboxWorkflowKey = (typeof INBOX_WORKFLOWS)[number];

export const INBOX_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type InboxPriorityKey = (typeof INBOX_PRIORITIES)[number];

export const INBOX_RISKS = ["none", "low", "medium", "high", "critical"] as const;
export type InboxRiskKey = (typeof INBOX_RISKS)[number];

/**
 * Public/action state, mirroring the web `statusKey` cascade. `st_hidden` covers the
 * per-platform hidden wording the web resolves via the connector; mobile localizes
 * one key rather than three near-identical ones.
 */
export const INBOX_ACTION_STATES = [
  "deleted", "hidden", "cannot_hide", "pending", "monitored", "no_action", "kept", "captured",
] as const;
export type InboxActionState = (typeof INBOX_ACTION_STATES)[number];

/** Truthful per-item processing state. A limit/disabled/failed state NEVER reads as analysed. */
export const INBOX_PROCESSING_STATES = [
  "pending", "processed_rules", "processed_local", "processed_paid", "cached",
  "basic_limit_reached", "premium_limit_reached", "paid_ai_disabled", "failed",
] as const;
export type InboxProcessingState = (typeof INBOX_PROCESSING_STATES)[number];

export const CONNECTOR_HEALTH_STATES = [
  "healthy", "verification_pending", "rate_limited", "permission_missing",
  "disconnected", "api_unavailable", "error",
] as const;
export type ConnectorHealthKey = (typeof CONNECTOR_HEALTH_STATES)[number];

/** Customer-visible classification state from the canonical projection. */
export const CLASSIFICATION_STATES = ["confirmed", "review_required", "no_issue"] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

/** Bounded audit vocabulary. Anything outside this set is dropped, never rendered raw. */
export const INBOX_AUDIT_EVENTS = [
  "inbox.mark_read", "inbox.mark_unread", "inbox.archive", "inbox.unarchive",
  "inbox.set_priority", "inbox.set_workflow_status", "inbox.assign", "inbox.unassign",
  "inbox.label_assign", "inbox.label_remove", "inbox.note_add",
] as const;
export type InboxAuditEvent = (typeof INBOX_AUDIT_EVENTS)[number];

/** The internal actions mobile may perform. Provider writes are deliberately absent. */
export const INBOX_ACTIONS = ["read", "unread", "archive", "unarchive", "priority", "workflow"] as const;
export type InboxActionKey = (typeof INBOX_ACTIONS)[number];

export type InboxError =
  | "unauthenticated" | "session_expired" | "session_revoked"
  | "verification_required" | "workspace_unsupported"
  | "permission_denied" | "read_only"
  | "invalid_request" | "not_found" | "server_error";

export interface InboxResponse {
  status: number;
  body: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

export interface InboxLabelDto {
  id: string;
  name: string;
  colorKey: string;
}

export interface InboxListItem {
  id: string;
  type: InboxTypeKey;
  /** Truncated preview. Reviews may legitimately have none. */
  preview: string | null;
  author: string | null;
  platform: string;
  account: string | null;
  createdAt: string;
  /** Present only when the platform gave us a safe http(s) link. */
  permalink: string | null;
  rating: number | null;

  sentiment: InboxSentimentKey;
  /** Customer-visible severity — safe-capped for anything unconfirmed. */
  risk: InboxRiskKey;
  classification: ClassificationState;
  /** Confirmed categories only. Empty when nothing is confirmed. */
  categories: string[];
  requiresReanalysis: boolean;

  isRead: boolean;
  archived: boolean;
  priority: InboxPriorityKey;
  workflow: InboxWorkflowKey;
  assignee: { id: string; name: string } | null;
  labels: InboxLabelDto[];
  noteCount: number;

  actionState: InboxActionState;
  processing: InboxProcessingState;
  connectorHealth: ConnectorHealthKey;
}

export interface InboxDetail extends InboxListItem {
  /** Full text. Still null for a rating-only review. */
  text: string | null;
  notes: { id: string; body: string; authorName: string | null; createdAt: string }[];
  activity: { id: string; event: InboxAuditEvent; at: string }[];
}

export interface InboxCountsDto {
  total: number;
  unread: number;
  archived: number;
  assigned: number;
  unassigned: number;
}

export interface InboxPageDto {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InboxOptionsDto {
  platforms: string[];
  labels: InboxLabelDto[];
  members: { id: string; name: string }[];
}

/* -------------------------------------------------------------------------- */
/* Query parsing                                                               */
/* -------------------------------------------------------------------------- */

/** Longest accepted search term — bounds the work an authenticated caller can cause. */
export const MAX_QUERY_LENGTH = 200;

export interface InboxQuery {
  view: InboxViewKey;
  range: InboxRangeKey;
  type: InboxTypeKey | null;
  sentiment: InboxSentimentKey | null;
  workflow: InboxWorkflowKey | null;
  priority: InboxPriorityKey | null;
  risk: InboxRiskKey | null;
  provider: string | null;
  label: string | null;
  assignee: string | null;
  q: string | null;
  cursor: string | null;
}

const oneOf = <T extends string>(allowed: readonly T[], raw: string | null | undefined): T | null =>
  raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/**
 * Parse and validate EVERY client input. Unknown keys are ignored entirely, and an
 * out-of-range enum becomes `null` (filter not applied) rather than an error — the
 * same forgiving normalization the web page performs on its search params, so a
 * stale deep link degrades to a wider list instead of a failure.
 *
 * `provider`, `label` and `assignee` are opaque identifiers validated by shape only;
 * the repo scopes them to the tenant, so an id from another tenant simply matches
 * nothing.
 */
export function parseInboxQuery(get: (key: string) => string | null | undefined): InboxQuery {
  const id = (raw: string | null | undefined): string | null => {
    const v = raw?.trim();
    return v && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
  };
  const q = get("q")?.trim() ?? "";

  return {
    view: oneOf(INBOX_VIEWS, get("view")) ?? "default",
    range: oneOf(Object.keys(INBOX_RANGES) as InboxRangeKey[], get("range")) ?? "all",
    type: oneOf(INBOX_TYPES, get("type")),
    sentiment: oneOf(INBOX_SENTIMENTS, get("sentiment")),
    workflow: oneOf(INBOX_WORKFLOWS, get("workflow")),
    priority: oneOf(INBOX_PRIORITIES, get("priority")),
    risk: oneOf(INBOX_RISKS, get("risk")),
    provider: id(get("provider")),
    label: id(get("label")),
    assignee: id(get("assignee")),
    // Over-long input is TRUNCATED, not rejected: a long paste should search, not fail.
    q: q ? q.slice(0, MAX_QUERY_LENGTH) : null,
    // The cursor is opaque here and is handed to the repo verbatim; a malformed one
    // is treated as "no cursor" by `decodeCursor`, which is fail-safe.
    cursor: get("cursor")?.trim() || null,
  };
}

/**
 * Lower bound for a date range, matching the web page: UTC day start minus (days-1),
 * so "today" is the current UTC day and "7d" is a full seven-day window inclusive.
 */
export function sinceFor(range: InboxRangeKey, now: Date): Date | undefined {
  const days = INBOX_RANGES[range];
  if (days === null) return undefined;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Preview length for a list row. Full text is served only by the detail endpoint. */
export const PREVIEW_LENGTH = 220;

export function previewOf(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.length <= PREVIEW_LENGTH ? t : `${t.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

/**
 * Only an http(s) permalink is forwarded. Anything else — a `javascript:` URL, a
 * custom scheme, or an unparseable value from provider data — becomes null so the
 * device never receives a link it should not open.
 */
export function safePermalink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Narrow an arbitrary stored string to a bounded key, or fall back safely. */
export const boundedKey = <T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T =>
  typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;

export function isKnownAuditEvent(event: string): event is InboxAuditEvent {
  return (INBOX_AUDIT_EVENTS as readonly string[]).includes(event);
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A row already reduced to bounded values by the deps layer. Keeping the raw Prisma
 * row out of this module is what guarantees no stored field can leak by accident:
 * anything not named here cannot reach a response.
 */
export interface InboxSourceRow {
  id: string;
  type: InboxTypeKey;
  text: string | null;
  author: string | null;
  platform: string;
  account: string | null;
  createdAt: Date;
  permalink: string | null;
  rating: number | null;
  sentiment: InboxSentimentKey;
  risk: InboxRiskKey;
  classification: ClassificationState;
  categories: string[];
  requiresReanalysis: boolean;
  isRead: boolean;
  archived: boolean;
  priority: InboxPriorityKey;
  workflow: InboxWorkflowKey;
  assignee: { id: string; name: string } | null;
  labels: InboxLabelDto[];
  noteCount: number;
  actionState: InboxActionState;
  processing: InboxProcessingState;
  connectorHealth: ConnectorHealthKey;
}

export interface InboxListResult {
  rows: InboxSourceRow[];
  nextCursor: string | null;
  hasMore: boolean;
  counts: InboxCountsDto;
}

export interface InboxDetailSource extends InboxSourceRow {
  notes: { id: string; body: string; authorName: string | null; createdAt: Date }[];
  activity: { id: string; event: string; at: Date }[];
}

export interface InboxDeps extends ShellSessionDeps {
  /** `Permission.InboxAct` for this role — the canonical gate, not a mobile copy. */
  canAct: (role: string) => boolean;
  /** Authoritative billing write state. Never the client's `canWrite`. */
  hasWriteAccess: (tenantId: string) => Promise<boolean>;

  listInbox: (input: {
    tenantId: string;
    userId: string;
    query: InboxQuery;
    since: Date | undefined;
  }) => Promise<InboxListResult>;

  /** Resolves WITHIN the tenant. Returns null for a foreign or missing item alike. */
  getInboxItem: (input: { tenantId: string; itemId: string }) => Promise<InboxDetailSource | null>;

  /** Delegates to the canonical repo mutations; returns the repo's own result. */
  mutateInbox: (input: {
    tenantId: string;
    userId: string;
    itemId: string;
    action: InboxActionKey;
    priority?: InboxPriorityKey;
    workflow?: InboxWorkflowKey;
  }) => Promise<{ ok: boolean; reason?: string }>;

  getInboxOptions: (input: { tenantId: string }) => Promise<InboxOptionsDto>;
}

/* -------------------------------------------------------------------------- */
/* Gate                                                                        */
/* -------------------------------------------------------------------------- */

const err = (status: number, error: InboxError): InboxResponse => ({ status, body: { error } });

/**
 * The read gate: valid session → verified email → BUSINESS workspace. Identical to
 * the M3 shell gate; re-implemented here only so this module stays import-free of
 * runtime values (the shell's own gate is reused at the deps layer).
 */
export async function authorizeInboxRead(
  authorization: string | null | undefined,
  deps: ShellSessionDeps,
): Promise<
  | { ok: true; session: { userId: string; tenantId: string; role: string } }
  | { ok: false; response: InboxResponse }
> {
  const token = /^Bearer[ ]+(\S+)$/.exec((authorization ?? "").trim())?.[1] ?? null;
  if (!token) return { ok: false, response: err(401, "unauthenticated") };

  const result = await deps.readUserSession(token);
  if (!result.ok || !result.session) {
    const reason: SessionRejectReason | undefined = result.reason;
    if (reason === "session_expired_idle") deps.emitOpsEvent("auth.session_expired_idle", { reason });
    else if (reason === "session_expired_absolute") deps.emitOpsEvent("auth.session_expired_absolute", { reason });

    const mapped: InboxError =
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
/* GET /api/mobile/inbox                                                       */
/* -------------------------------------------------------------------------- */

export function toListItem(row: InboxSourceRow): InboxListItem {
  return {
    id: row.id,
    type: row.type,
    preview: previewOf(row.text),
    author: row.author,
    platform: row.platform,
    account: row.account,
    createdAt: row.createdAt.toISOString(),
    permalink: safePermalink(row.permalink),
    rating: row.rating,
    sentiment: row.sentiment,
    risk: row.risk,
    classification: row.classification,
    categories: row.categories,
    requiresReanalysis: row.requiresReanalysis,
    isRead: row.isRead,
    archived: row.archived,
    priority: row.priority,
    workflow: row.workflow,
    assignee: row.assignee,
    labels: row.labels,
    noteCount: row.noteCount,
    actionState: row.actionState,
    processing: row.processing,
    connectorHealth: row.connectorHealth,
  };
}

export async function handleInboxList(
  req: { authorization: string | null | undefined; get: (key: string) => string | null | undefined },
  deps: InboxDeps,
): Promise<InboxResponse> {
  const gate = await authorizeInboxRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const query = parseInboxQuery(req.get);
  const now = deps.now?.() ?? new Date();

  let result: InboxListResult;
  try {
    result = await deps.listInbox({
      // Tenant AND user come from the validated session. `assigned_me` resolves from
      // this userId — a client-supplied one is never consulted.
      tenantId: gate.session.tenantId,
      userId: gate.session.userId,
      query,
      since: sinceFor(query.range, now),
    });
  } catch {
    return err(500, "server_error");
  }

  return {
    status: 200,
    body: {
      items: result.rows.map(toListItem),
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
      counts: result.counts,
      // Echoed back so the client can prove which filters the SERVER actually applied
      // (a normalized-away value is visible rather than silently assumed).
      applied: query,
      // Writes are advertised only when the server would truly permit them.
      canAct: deps.canAct(gate.session.role),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/inbox/:itemId                                               */
/* -------------------------------------------------------------------------- */

export async function handleInboxDetail(
  req: { authorization: string | null | undefined; itemId: string | null | undefined },
  deps: InboxDeps,
): Promise<InboxResponse> {
  const gate = await authorizeInboxRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  const itemId = req.itemId?.trim();
  if (!itemId) return err(400, "invalid_request");

  let row: InboxDetailSource | null;
  try {
    // Scoped to the session tenant. An item belonging to another tenant resolves to
    // null exactly as a non-existent one does — the response cannot distinguish them.
    row = await deps.getInboxItem({ tenantId: gate.session.tenantId, itemId });
  } catch {
    return err(500, "server_error");
  }
  if (!row) return err(404, "not_found");

  const detail: InboxDetail = {
    ...toListItem(row),
    text: row.text?.trim() ? row.text : null,
    notes: row.notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
    })),
    // Unknown audit events are DROPPED — an internal event name never reaches the UI,
    // and no audit metadata is forwarded at all.
    activity: row.activity
      .filter((a) => isKnownAuditEvent(a.event))
      .map((a) => ({ id: a.id, event: a.event as InboxAuditEvent, at: a.at.toISOString() })),
  };

  return { status: 200, body: { item: detail, canAct: deps.canAct(gate.session.role) } };
}

/* -------------------------------------------------------------------------- */
/* POST /api/mobile/inbox/:itemId/action                                       */
/* -------------------------------------------------------------------------- */

/**
 * One internal-action endpoint rather than four near-identical routes: the actions
 * share an identical gate, an identical tenant scope and an identical result shape,
 * so a single validated `action` keeps the security surface in one place.
 *
 * Provider write actions (hide / delete / reply / ban) are deliberately NOT
 * reachable here. They remain behind the approval + execution engine.
 */
export async function handleInboxAction(
  req: { authorization: string | null | undefined; itemId: string | null | undefined; body: unknown },
  deps: InboxDeps,
): Promise<InboxResponse> {
  const gate = await authorizeInboxRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  // 1) Canonical RBAC — the same permission the web Server Actions require.
  if (!deps.canAct(gate.session.role)) return err(403, "permission_denied");

  // 2) Authoritative billing write state, resolved server-side. The client's
  //    `canWrite` is a UX hint and is never read.
  let writable: boolean;
  try {
    writable = await deps.hasWriteAccess(gate.session.tenantId);
  } catch {
    return err(500, "server_error");
  }
  if (!writable) return err(403, "read_only");

  const itemId = req.itemId?.trim();
  if (!itemId) return err(400, "invalid_request");

  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return err(400, "invalid_request");
  const raw = body as Record<string, unknown>;

  const action = oneOf(INBOX_ACTIONS, typeof raw.action === "string" ? raw.action : null);
  if (!action) return err(400, "invalid_request");

  // 3) Enum validation for the value-carrying actions. An arbitrary string never
  //    reaches the repo.
  let priority: InboxPriorityKey | undefined;
  let workflow: InboxWorkflowKey | undefined;
  if (action === "priority") {
    const value = oneOf(INBOX_PRIORITIES, typeof raw.value === "string" ? raw.value : null);
    if (!value) return err(400, "invalid_request");
    priority = value;
  }
  if (action === "workflow") {
    const value = oneOf(INBOX_WORKFLOWS, typeof raw.value === "string" ? raw.value : null);
    if (!value) return err(400, "invalid_request");
    workflow = value;
  }

  let result: { ok: boolean; reason?: string };
  try {
    result = await deps.mutateInbox({
      tenantId: gate.session.tenantId,
      userId: gate.session.userId,
      itemId,
      action,
      priority,
      workflow,
    });
  } catch {
    return err(500, "server_error");
  }

  if (!result.ok) {
    // The repo's own reason is a bounded internal code; map it rather than echo it.
    return result.reason === "not_found" ? err(404, "not_found") : err(400, "invalid_request");
  }

  // Return the item's fresh canonical state so the client patches one row instead of
  // refetching the list. A read failure here is not a mutation failure.
  let item: InboxListItem | null = null;
  try {
    const fresh = await deps.getInboxItem({ tenantId: gate.session.tenantId, itemId });
    item = fresh ? toListItem(fresh) : null;
  } catch {
    item = null;
  }

  return { status: 200, body: { ok: true, item } };
}

/* -------------------------------------------------------------------------- */
/* GET /api/mobile/inbox/options                                               */
/* -------------------------------------------------------------------------- */

/**
 * Filter option data, served separately so it is fetched once rather than riding on
 * every page of the list. Members carry id + display name only — no email.
 */
export async function handleInboxOptions(
  req: { authorization: string | null | undefined },
  deps: InboxDeps,
): Promise<InboxResponse> {
  const gate = await authorizeInboxRead(req.authorization, deps);
  if (!gate.ok) return gate.response;

  try {
    const options = await deps.getInboxOptions({ tenantId: gate.session.tenantId });
    return { status: 200, body: { options } };
  } catch {
    return err(500, "server_error");
  }
}

export type { OpsEvent };
