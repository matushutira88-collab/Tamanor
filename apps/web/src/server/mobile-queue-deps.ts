import "server-only";
import { readUserSession, withTenant } from "@guardora/db";
import { ActorKind, Prisma } from "@prisma/client";
import { classifyWorkspaceRouting, emitOpsEvent, can, Permission } from "@guardora/core";
import { queueTabStates, NEVER_AUTONOMOUS, AUTONOMOUS_ELIGIBLE, type QueueTab } from "@guardora/ai";
import { projectStoredClassification } from "@guardora/ai";
import { getRealModeFilter } from "@/server/data-mode";
import {
  bounded, boundedReason, isKnownQueueAudit, previewOf,
  EXECUTION_STATUSES, EXECUTION_TRIGGERS, LIFECYCLE_STATES, POLICY_MODES,
  PROPOSED_ACTIONS, QUEUE_STATES, READINESS_STATES,
  type DecisionOutcome, type ExecutionStatusKey, type ExecutionTriggerKey,
  type LifecycleKey, type PolicyModeKey, type ProposedActionKey, type QueueCountsDto,
  type QueueDeps, type QueueDetailSource, type QueueExecutionDto, type QueueSourceRow,
  type QueueStateKey, type ReadinessKey,
} from "./mobile-queue";

/**
 * M5 — the ONE wiring of the mobile Action Queue to real server data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROVIDER-WRITE BOUNDARY.
 *
 * This module deliberately imports NOTHING from `@guardora/sync`'s execution
 * surface: no `attemptFacebookHide`, no `hideComment`, no transport, no
 * `resolveMetaAccessTokenSafe`. It reads persisted `PlatformActionExecution`
 * history instead of predicting or performing anything, so no mobile request can
 * reach Facebook, Instagram, Google or TikTok — not even a read.
 *
 * Readiness is therefore derived from PERSISTED state only, which also avoids the
 * per-row provider lifecycle HTTP the web detail page can perform.
 * ────────────────────────────────────────────────────────────────────────────
 */

const sessionDeps = {
  readUserSession,
  classifyWorkspace: (kind: unknown) => classifyWorkspaceRouting(kind),
  emitOpsEvent,
};

/** Page size for the queue. Keyset-paginated on (createdAt, id). */
export const QUEUE_PAGE_SIZE = 25;

/** Opaque cursor: the client never parses it, and a malformed one is ignored. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}.${id}`, "utf8").toString("base64url");
}
function decodeCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    const s = Buffer.from(raw, "base64url").toString("utf8");
    const dot = s.indexOf(".");
    if (dot <= 0) return null;
    const ms = Number(s.slice(0, dot));
    const id = s.slice(dot + 1);
    return Number.isFinite(ms) && id ? { at: new Date(ms), id } : null;
  } catch {
    return null;
  }
}

/** Map a persisted execution row to the bounded DTO. */
function toExecution(e: {
  status: string; trigger: string; reason: string | null; createdAt: Date; executedAt: Date | null;
}): QueueExecutionDto {
  return {
    status: bounded<ExecutionStatusKey>(EXECUTION_STATUSES, e.status, "blocked"),
    trigger: bounded<ExecutionTriggerKey>(EXECUTION_TRIGGERS, e.trigger, "approval"),
    reason: boundedReason(e.reason),
    at: (e.executedAt ?? e.createdAt).toISOString(),
  };
}

/**
 * Comment lifecycle from PERSISTED execution history only — never a provider call.
 *
 * The web detail page may hit Graph read-only for this; doing that per queue row on
 * mobile would be N+1 provider requests, so the mobile surface reports what the
 * server already recorded and says `unknown` when it genuinely does not know.
 */
function lifecycleFrom(executions: { status: string; reason: string | null }[]): LifecycleKey {
  for (const e of executions) {
    if (e.reason === "comment_deleted_or_unavailable") return "deleted";
    if (e.status === "executed") return "hidden";
    if (e.reason === "facebook_can_hide_false") return "cannot_hide";
  }
  return "unknown";
}

/**
 * Readiness from persisted state. `blocked` / `dry_run` / `executed` are facts the
 * server already wrote; anything else is `not_applicable` rather than a prediction,
 * because predicting would require the account token context this module refuses to
 * load. READINESS IS INFORMATION — no live action follows from it on mobile.
 */
function readinessFrom(
  proposedAction: string,
  executions: { status: string; reason: string | null }[],
): { state: ReadinessKey; reason: ReturnType<typeof boundedReason> } {
  if (proposedAction !== "hide_comment") return { state: "not_applicable", reason: null };
  const executed = executions.find((e) => e.status === "executed");
  if (executed) return { state: "already_executed", reason: boundedReason(executed.reason) };
  const latest = executions[0];
  if (!latest) return { state: bounded(READINESS_STATES, "not_applicable", "not_applicable"), reason: null };
  if (latest.status === "dry_run") return { state: "dry_run", reason: boundedReason(latest.reason) };
  if (latest.status === "blocked" || latest.status === "failed") {
    return { state: "blocked", reason: boundedReason(latest.reason) };
  }
  return { state: "not_applicable", reason: null };
}

/** Canonical select for a queue row — no tokens, no provider payloads. */
const QUEUE_SELECT = {
  id: true, itemId: true, category: true, confidence: true, proposedAction: true,
  queueState: true, reason: true, createdAt: true, policyId: true, brandId: true,
} as const;

const CONTENT_SELECT = {
  id: true, riskLevel: true, riskCategories: true, riskConfidence: true, aiDiagnostics: true,
  contentItem: {
    select: {
      text: true, kind: true, rating: true, authorDisplayName: true, platform: true,
      connectedAccount: { select: { externalName: true } },
    },
  },
} as const;

/** Reduce a queue row + its related content into the bounded source shape. */
function toSourceRow(
  q: { id: string; itemId: string; category: string; proposedAction: string; queueState: string; reason: string | null; createdAt: Date },
  content: {
    id: string; riskLevel: string; riskCategories: string[]; riskConfidence: number; aiDiagnostics: unknown;
    contentItem: {
      text: string | null; kind: string; rating: number | null; authorDisplayName: string | null;
      platform: string; connectedAccount: { externalName: string | null } | null;
    };
  } | undefined,
  executions: QueueExecutionDto[],
  lifecycle: LifecycleKey,
): QueueSourceRow {
  const ci = content?.contentItem;
  // Customer-visible severity via the canonical projection — never the raw verdict.
  const risk = content
    ? projectStoredClassification({
        riskLevel: content.riskLevel,
        riskCategories: content.riskCategories ?? [],
        riskConfidence: content.riskConfidence,
        aiDiagnostics: content.aiDiagnostics,
      } as never).riskLevel
    : null;

  return {
    id: q.id,
    // Null when the reputation item is gone, so the client hides the Inbox link.
    relatedInboxItemId: content ? content.id : null,
    proposedAction: bounded<ProposedActionKey>(PROPOSED_ACTIONS, q.proposedAction, "no_action"),
    queueState: bounded<QueueStateKey>(QUEUE_STATES, q.queueState, "suggested"),
    state: bounded<QueueStateKey>(QUEUE_STATES, q.queueState, "suggested"),
    category: q.category,
    reason: boundedReason(q.reason),
    createdAt: q.createdAt.toISOString(),

    contentPreview: previewOf(ci?.text),
    contentType: ci ? (ci.kind === "review" ? "review" : "comment") : null,
    author: ci?.authorDisplayName ?? null,
    platform: ci?.platform ?? null,
    account: ci?.connectedAccount?.externalName ?? null,
    rating: ci?.rating ?? null,
    risk,

    execution: executions[0] ?? null,
    lifecycle,
  };
}

export function realQueueDeps(): QueueDeps {
  return {
    ...sessionDeps,

    // The canonical decision permission — not a mobile RBAC copy.
    canApprove: (role) => can(role as Parameters<typeof can>[0], Permission.ProposalApprove),

    // Present for completeness/telemetry. NOT used to gate an internal decision:
    // the web approve/reject/markHandled actions do not consult it either, and this
    // module never performs provider execution (which is where the gate belongs).
    tenantAllowsOperations: async () => true,

    listQueue: async ({ tenantId, tab, cursor }) => {
      const realMode = await getRealModeFilter(tenantId);
      const states = queueTabStates(tab as QueueTab);
      const cur = decodeCursor(cursor);

      // Keyset on (createdAt, id) — deterministic, no OFFSET, stable under inserts.
      const keyset: Prisma.ActionQueueItemWhereInput | null = cur
        ? {
            AND: [
              { createdAt: { lte: cur.at } },
              { OR: [{ createdAt: { lt: cur.at } }, { id: { lt: cur.id } }] },
            ],
          }
        : null;

      const base: Prisma.ActionQueueItemWhereInput = {
        tenantId,
        ...realMode.brandWhere,
        ...(states ? { queueState: { in: states } } : {}),
      };

      const rows = await withTenant(tenantId, (db) =>
        db.actionQueueItem.findMany({
          where: keyset ? { AND: [base, keyset] } : base,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: QUEUE_PAGE_SIZE + 1,
          select: QUEUE_SELECT,
        }),
      );

      const hasMore = rows.length > QUEUE_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, QUEUE_PAGE_SIZE) : rows;
      const last = page[page.length - 1];

      // Page-bounded enrichment: ONE query for the related content, ONE for the
      // executions. Never per-row, never a provider call.
      const itemIds = page.map((q) => q.itemId);
      const queueIds = page.map((q) => q.id);
      const [contents, executions, counts] = await Promise.all([
        itemIds.length
          ? withTenant(tenantId, (db) =>
              db.reputationItem.findMany({ where: { id: { in: itemIds }, tenantId }, select: CONTENT_SELECT }),
            )
          : Promise.resolve([]),
        queueIds.length
          ? withTenant(tenantId, (db) =>
              db.platformActionExecution.findMany({
                where: { tenantId, queueItemId: { in: queueIds } },
                orderBy: { createdAt: "desc" },
                select: { queueItemId: true, status: true, trigger: true, reason: true, createdAt: true, executedAt: true },
              }),
            )
          : Promise.resolve([]),
        countsForTenant(tenantId, realMode.brandWhere),
      ]);

      const byItem = new Map(contents.map((c) => [c.id, c as never]));
      const byQueue = new Map<string, typeof executions>();
      for (const e of executions) {
        if (!e.queueItemId) continue;
        (byQueue.get(e.queueItemId) ?? byQueue.set(e.queueItemId, []).get(e.queueItemId)!).push(e);
      }

      return {
        rows: page.map((q) => {
          const execs = byQueue.get(q.id) ?? [];
          return toSourceRow(q, byItem.get(q.itemId), execs.map(toExecution), lifecycleFrom(execs));
        }),
        nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        hasMore,
        counts,
      };
    },

    getQueueItem: async ({ tenantId, itemId }): Promise<QueueDetailSource | null> => {
      // NOT `findUnique({ id })`. tenantId is in the predicate AND enforced by RLS,
      // so a foreign item matches nothing and is indistinguishable from missing.
      const q = await withTenant(tenantId, (db) =>
        db.actionQueueItem.findFirst({ where: { id: itemId, tenantId }, select: QUEUE_SELECT }),
      );
      if (!q) return null;

      const [content, executions, policy, activity] = await withTenant(tenantId, (db) =>
        Promise.all([
          db.reputationItem.findFirst({ where: { id: q.itemId, tenantId }, select: CONTENT_SELECT }),
          db.platformActionExecution.findMany({
            where: { tenantId, queueItemId: q.id },
            orderBy: { createdAt: "desc" },
            take: 20,
            // No providerErrorMessage, no response codes — bounded fields only.
            select: { status: true, trigger: true, reason: true, createdAt: true, executedAt: true },
          }),
          db.controlPolicy.findFirst({
            where: { brandId: q.brandId, category: q.category, isActive: true },
            select: { mode: true },
          }),
          db.auditLog.findMany({
            where: { tenantId, targetType: "action_queue_item", targetId: q.id },
            orderBy: { createdAt: "desc" },
            take: 20,
            // id/event/createdAt ONLY — no actor, no ip, no metadata payload.
            select: { id: true, event: true, createdAt: true },
          }),
        ]),
      );

      const execDtos = executions.map(toExecution);
      const base = toSourceRow(q, (content ?? undefined) as never, execDtos, lifecycleFrom(executions));

      return {
        ...base,
        contentText: content?.contentItem.text?.trim() ? content.contentItem.text : null,
        confidence: typeof q.confidence === "number" ? q.confidence : null,
        policy: {
          mode: policy ? bounded<PolicyModeKey>(POLICY_MODES, policy.mode, "approval") : null,
          // Safety semantics the customer can read, straight from the canonical sets.
          neverAutonomous: NEVER_AUTONOMOUS.has(q.category as never),
          autonomousEligible: AUTONOMOUS_ELIGIBLE.has(q.category as never),
        },
        readiness: readinessFrom(q.proposedAction, executions),
        executions: execDtos,
        activity: activity
          .filter((a) => isKnownQueueAudit(a.event))
          .map((a) => ({ id: a.id, event: a.event, at: a.createdAt })),
      };
    },

    /**
     * ATOMIC conditional decision.
     *
     * `updateMany` with a `queueState: { in: allowedFrom }` guard means the write
     * lands only if the item is STILL in a decidable state. Two operators deciding
     * at once cannot overwrite one another's terminal decision — the loser's update
     * matches zero rows and surfaces as a conflict.
     *
     * (The existing web Server Actions use an unconditional `update`, i.e.
     * last-write-wins. That weakness is deliberately NOT carried over here; web is
     * left unchanged and the issue is reported.)
     *
     * NO PROVIDER CALL happens anywhere in this function.
     */
    applyDecision: async ({ tenantId, userId, itemId, decision, allowedFrom, target }): Promise<DecisionOutcome> => {
      return withTenant(tenantId, async (db) => {
        const existing = await db.actionQueueItem.findFirst({
          where: { id: itemId, tenantId },
          select: { id: true, brandId: true, category: true, proposedAction: true },
        });
        if (!existing) return { ok: false, reason: "not_found" };

        const data =
          decision === "approve"
            ? { queueState: target, approvedByUserId: userId }
            : decision === "reject"
              ? { queueState: target, rejectedByUserId: userId }
              : { queueState: target };

        const res = await db.actionQueueItem.updateMany({
          where: { id: itemId, tenantId, queueState: { in: allowedFrom } },
          data,
        });
        if (res.count === 0) return { ok: false, reason: "conflict" };

        // Same canonical audit events the web Server Actions write. `executed:false`
        // is the literal truth here: mobile never runs a provider action.
        const event =
          decision === "approve" ? "approval.approved"
            : decision === "reject" ? "approval.rejected"
              : "approval.resolved";
        await db.auditLog.create({
          data: {
            tenantId, brandId: existing.brandId, event,
            actorKind: ActorKind.human, actorUserId: userId,
            targetType: "action_queue_item", targetId: itemId,
            metadata: {
              category: existing.category,
              proposedAction: existing.proposedAction,
              executed: false,
              surface: "mobile",
              ...(decision === "resolve" ? { resolved: true } : null),
              ...(decision === "approve" ? { hidden: false } : null),
            } as Prisma.InputJsonValue,
          },
        });
        return { ok: true };
      });
    },

    countsFor: async (tenantId) => {
      const realMode = await getRealModeFilter(tenantId);
      return countsForTenant(tenantId, realMode.brandWhere);
    },
  };
}

/** The three badge counts, computed in one tenant transaction. */
async function countsForTenant(
  tenantId: string,
  brandWhere: Prisma.ActionQueueItemWhereInput,
): Promise<QueueCountsDto> {
  // Named rather than destructured from a map, so each count is provably present
  // (an indexed element would be `number | undefined`).
  const countFor = (db: Parameters<Parameters<typeof withTenant>[1]>[0], tab: QueueTab) =>
    db.actionQueueItem.count({
      where: { tenantId, ...brandWhere, queueState: { in: queueTabStates(tab)! } },
    });

  return withTenant(tenantId, async (db) => {
    const [active, approval, blocked] = await Promise.all([
      countFor(db, "active"),
      countFor(db, "approval"),
      countFor(db, "blocked"),
    ] as const);
    return { active, approval, blocked };
  });
}
