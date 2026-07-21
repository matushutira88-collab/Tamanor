/**
 * V1.66 — PER-USER onboarding state and setup checklist.
 *
 * State lives on `Membership` (user × tenant), never on `User`: a user may belong to several tenants and
 * every step is tenant-scoped. Every read/write is scoped to BOTH tenantId and userId, so one member can
 * never observe or mutate another member's onboarding — enforced in the WHERE clause AND by the
 * `memberships` RLS policy (`tenantId = current_app_tenant_id()` with a symmetric WITH CHECK).
 *
 * Checklist steps are DERIVED from live system state (connected accounts, monitoring flags, sync
 * timestamps, real inbox activity) — never from client-side clicks and never persisted, so they cannot
 * drift from reality. Only manual acknowledgements are stored, under a strict key allow-list; no PII,
 * no tokens, no message content ever enters `onboardingChecklist`.
 */
import type { TenantTx } from "./tenant-db";
import { withTenant } from "./repositories";

export type OnboardingStatusValue = "not_started" | "in_progress" | "completed" | "dismissed";

/** The six derivable setup steps, in the order they are presented. Keys are stable identifiers. */
export const ONBOARDING_STEPS = [
  "workspace",
  "connect_account",
  "protect_brand",
  "enable_monitoring",
  "first_sync",
  "first_review",
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

/**
 * COMPLETION MODEL — steps 1..5 are REQUIRED; `first_review` is a RECOMMENDED follow-up.
 *
 * Reviewing a risk item cannot be forced by the user: a healthy, well-behaved audience may simply never
 * produce one. Making it required would leave such a workspace permanently "setting up". So the five
 * technical steps gate completion, and `first_review` stays visible as a follow-up until it happens.
 */
export const REQUIRED_STEPS: readonly OnboardingStepKey[] = [
  "workspace", "connect_account", "protect_brand", "enable_monitoring", "first_sync",
];
/** Shown and tracked, but never blocks completion. */
export const RECOMMENDED_STEPS: readonly OnboardingStepKey[] = ["first_review"];

/**
 * AuditLog events that prove THIS user actually opened or acted on a risk item. Existing server-written
 * evidence (`actorUserId` + `targetType:"reputation_item"`) — no new marker column is needed, and a bare
 * client click can never satisfy it.
 */
export const REVIEW_AUDIT_EVENTS = [
  "inbox.mark_read", "inbox.set_workflow_status", "inbox.set_priority",
  "inbox.assign", "inbox.archive", "inbox.note_add",
] as const;

/** Keys accepted inside `onboardingChecklist`. Anything else is dropped before persisting. */
export const ACK_KEYS = ["welcome_seen", "finish_ack"] as const;
export type AckKey = (typeof ACK_KEYS)[number];

export interface OnboardingChecklistItem {
  key: OnboardingStepKey;
  done: boolean;
  /** True when the step is one of REQUIRED_STEPS (i.e. it gates completion). */
  required: boolean;
}

export interface OnboardingState {
  status: OnboardingStatusValue;
  version: number;
  step: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  acknowledgements: Record<string, boolean>;
  checklist: OnboardingChecklistItem[];
  /** REQUIRED steps done (progress is measured over the required set, not all six). */
  completedCount: number;
  totalCount: number;
  /** 0-100, rounded, over the REQUIRED steps. */
  progressPct: number;
  /** The next action to recommend: first unfinished required step, else the pending follow-up. */
  nextStep: OnboardingStepKey | null;
  /** True when every REQUIRED_STEPS entry is done (completion is allowed). */
  canFinish: boolean;
  /** Recommended-but-unfinished steps (currently: first_review) — never blocks completion. */
  recommendedPending: OnboardingStepKey[];
  /** True when the checklist surface should render for this member. */
  shouldShow: boolean;
}

/** Raw derived facts — the ONLY input the checklist is computed from. */
export interface DerivedFacts {
  hasWorkspace: boolean;
  hasConnectedAccount: boolean;
  hasProtectedBrand: boolean;
  hasMonitoringEnabled: boolean;
  hasFirstSync: boolean;
  hasFirstReview: boolean;
}

// ---------------------------------------------------------------------------------------------------
// PURE logic (no DB) — unit-testable in isolation.
// ---------------------------------------------------------------------------------------------------

/** PURE: turn derived facts into the ordered checklist. */
export function buildChecklist(f: DerivedFacts): OnboardingChecklistItem[] {
  const done: Record<OnboardingStepKey, boolean> = {
    workspace: f.hasWorkspace,
    connect_account: f.hasConnectedAccount,
    protect_brand: f.hasProtectedBrand,
    enable_monitoring: f.hasMonitoringEnabled,
    first_sync: f.hasFirstSync,
    first_review: f.hasFirstReview,
  };
  return ONBOARDING_STEPS.map((key) => ({ key, done: done[key], required: REQUIRED_STEPS.includes(key) }));
}

/**
 * PURE: progress + next recommended action. Progress is measured over the REQUIRED steps (so a workspace
 * with no risk item yet can still reach 100%); the recommended follow-up is reported separately.
 */
export function summarize(checklist: OnboardingChecklistItem[]): {
  completedCount: number; totalCount: number; progressPct: number;
  nextStep: OnboardingStepKey | null; canFinish: boolean;
  recommendedPending: OnboardingStepKey[];
} {
  const required = checklist.filter((c) => c.required);
  const completedCount = required.filter((c) => c.done).length;
  const totalCount = required.length;
  return {
    completedCount,
    totalCount,
    progressPct: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    // Recommend the first unfinished REQUIRED step; once those are done, point at the follow-up.
    nextStep: required.find((c) => !c.done)?.key ?? checklist.find((c) => !c.done)?.key ?? null,
    canFinish: required.every((c) => c.done),
    recommendedPending: checklist.filter((c) => !c.required && !c.done).map((c) => c.key),
  };
}

/**
 * The allowed state machine. `completed` is TERMINAL except for an explicit restart (which targets
 * `in_progress`). `dismissed -> completed` is additionally gated on the required steps actually being
 * satisfied — enforced in `applyOnboardingAction`, since a pure transition table cannot see live state.
 */
const TRANSITIONS: Record<OnboardingStatusValue, readonly OnboardingStatusValue[]> = {
  not_started: ["in_progress", "dismissed", "completed"],
  in_progress: ["in_progress", "dismissed", "completed"],
  dismissed: ["in_progress", "completed"],
  completed: ["in_progress"],
};

/** PURE: is this transition allowed? Used to reject invalid/forged state changes server-side. */
export function canTransition(from: OnboardingStatusValue, to: OnboardingStatusValue): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export class OnboardingTransitionError extends Error {
  constructor(from: OnboardingStatusValue, to: OnboardingStatusValue) {
    super(`invalid_onboarding_transition:${from}->${to}`);
    this.name = "OnboardingTransitionError";
  }
}

/** PURE: keep only allow-listed boolean acknowledgement keys (defence against arbitrary JSON writes). */
export function sanitizeAcks(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of ACK_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** PURE: should the onboarding surface render? Completed and dismissed both stay hidden until resumed. */
export function shouldShowOnboarding(status: OnboardingStatusValue): boolean {
  return status === "not_started" || status === "in_progress";
}

// ---------------------------------------------------------------------------------------------------
// DB access — always tenant-scoped, always ALSO user-scoped.
// ---------------------------------------------------------------------------------------------------

/**
 * Derive every checklist fact from live system state inside one tenant transaction.
 *
 * `userId` matters for the review step only: onboarding is per-member, so "I reviewed a risk item" must be
 * evidence that THIS member did so — not that a colleague did.
 */
export async function deriveFacts(db: TenantTx, tenantId: string, userId: string): Promise<DerivedFacts> {
  const live = { tenantId, status: { not: "disconnected" as const } };
  const [connected, brandsWithAccount, monitored, syncedOk, reviewAudits, reviewDecisions] = await Promise.all([
    db.connectedAccount.count({ where: live }),
    db.brand.count({ where: { tenantId, connectedAccounts: { some: { status: { not: "disconnected" } } } } }),
    db.connectedAccount.count({ where: { ...live, monitoringEnabled: true } }),
    // "first sync completed" == syncStateOf(...) === "ok" (see dashboard-metrics): a real (non-test)
    // account that has a successful sync AND is not currently in a failed-attempt state.
    db.connectedAccount.count({
      where: {
        tenantId,
        status: { notIn: ["disconnected", "mock_connected"] },
        mode: { not: "placeholder" },
        lastSuccessfulSyncAt: { not: null },
        NOT: { AND: [{ health: "error" }, { lastSyncedAt: { not: null } }] },
      },
    }),
    // Server-written proof that this member opened/acted on a risk item. A client click alone cannot
    // create these rows — they are written inside the tenant transaction by the inbox mutations.
    db.auditLog.count({
      where: { tenantId, actorUserId: userId, targetType: "reputation_item", event: { in: [...REVIEW_AUDIT_EVENTS] } },
    }),
    db.moderationDecision.count({ where: { tenantId, reviewerUserId: userId, reviewedAt: { not: null } } }),
  ]);
  return {
    hasWorkspace: true, // a membership in this tenant is the workspace itself
    hasConnectedAccount: connected > 0,
    hasProtectedBrand: brandsWithAccount > 0,
    hasMonitoringEnabled: monitored > 0,
    hasFirstSync: syncedOk > 0,
    hasFirstReview: reviewAudits > 0 || reviewDecisions > 0,
  };
}

interface MembershipRow {
  onboardingStatus: string;
  onboardingVersion: number;
  onboardingStep: string | null;
  onboardingStartedAt: Date | null;
  onboardingCompletedAt: Date | null;
  onboardingDismissedAt: Date | null;
  onboardingChecklist: unknown;
}

const SELECT = {
  onboardingStatus: true, onboardingVersion: true, onboardingStep: true,
  onboardingStartedAt: true, onboardingCompletedAt: true, onboardingDismissedAt: true,
  onboardingChecklist: true,
} as const;

async function readRow(db: TenantTx, tenantId: string, userId: string): Promise<MembershipRow | null> {
  return (await db.membership.findFirst({ where: { tenantId, userId }, select: SELECT })) as MembershipRow | null;
}

function toState(row: MembershipRow, facts: DerivedFacts): OnboardingState {
  const checklist = buildChecklist(facts);
  const status = row.onboardingStatus as OnboardingStatusValue;
  return {
    status,
    version: row.onboardingVersion,
    step: row.onboardingStep,
    startedAt: row.onboardingStartedAt,
    completedAt: row.onboardingCompletedAt,
    dismissedAt: row.onboardingDismissedAt,
    acknowledgements: sanitizeAcks(row.onboardingChecklist),
    checklist,
    ...summarize(checklist),
    shouldShow: shouldShowOnboarding(status),
  };
}

/** Read the CURRENT user's onboarding state in this tenant, with the checklist derived from live state. */
export async function getOnboardingState(tenantId: string, userId: string): Promise<OnboardingState | null> {
  return withTenant(tenantId, async (db) => {
    const row = await readRow(db, tenantId, userId);
    if (!row) return null; // not a member of this tenant
    return toState(row, await deriveFacts(db, tenantId, userId));
  });
}

/**
 * V1.67.1 — single-transaction "load onboarding for the dashboard": read the member row, derive the
 * checklist facts ONCE, auto-complete if eligible, and return the resulting state + whether it auto-
 * completed. This is behaviourally identical to `maybeAutoComplete()` THEN `getOnboardingState()` (the old
 * loadOnboarding pattern) but does it in ONE withTenant round trip instead of two, and derives the facts
 * once instead of twice for a mid-onboarding member. Auto-complete uses the SAME guard: only from
 * not_started/in_progress when every required step is real; `updateMany` pins tenantId+userId (never another
 * member) and re-checks status, so a concurrent completion is a safe no-op.
 */
export async function resolveOnboarding(
  tenantId: string, userId: string,
): Promise<{ state: OnboardingState | null; autoCompleted: boolean }> {
  return withTenant(tenantId, async (db) => {
    const row = await readRow(db, tenantId, userId);
    if (!row) return { state: null, autoCompleted: false };
    const facts = await deriveFacts(db, tenantId, userId);

    const status = row.onboardingStatus as OnboardingStatusValue;
    if (status === "in_progress" || status === "not_started") {
      const { canFinish } = summarize(buildChecklist(facts));
      if (canFinish) {
        const res = await db.membership.updateMany({
          where: { tenantId, userId, onboardingStatus: { in: ["not_started", "in_progress"] } },
          data: { onboardingStatus: "completed", onboardingCompletedAt: new Date() },
        });
        if (res.count > 0) {
          // Re-read so the returned state reflects the persisted completed status/timestamp (facts are
          // unchanged by a membership-status write, so they are reused — never re-derived).
          const fresh = await readRow(db, tenantId, userId);
          return { state: fresh ? toState(fresh, facts) : null, autoCompleted: true };
        }
      }
    }
    return { state: toState(row, facts), autoCompleted: false };
  });
}

export type OnboardingAction = "start" | "dismiss" | "resume" | "complete" | "restart";

const TARGET: Record<OnboardingAction, OnboardingStatusValue> = {
  start: "in_progress",
  dismiss: "dismissed",
  resume: "in_progress",
  complete: "completed",
  // A restart drops the member back INTO the flow (not to not_started), so the checklist is immediately
  // visible again rather than waiting for another welcome screen.
  restart: "in_progress",
};

export class OnboardingRequirementsError extends Error {
  constructor() {
    super("onboarding_requirements_not_met");
    this.name = "OnboardingRequirementsError";
  }
}

/**
 * Apply an onboarding action for EXACTLY ONE member (tenantId + userId). Rejects invalid transitions.
 * Returns the fresh state. Never touches another member's row: the WHERE clause pins userId, and
 * `updateMany` is used so a mismatched scope simply affects 0 rows instead of throwing on a foreign id.
 */
export async function applyOnboardingAction(
  tenantId: string, userId: string, action: OnboardingAction, step?: string | null,
): Promise<OnboardingState | null> {
  return withTenant(tenantId, async (db) => {
    const row = await readRow(db, tenantId, userId);
    if (!row) return null;

    const from = row.onboardingStatus as OnboardingStatusValue;
    const to = TARGET[action];
    // `restart` is the ONLY sanctioned way to leave `completed`; a plain resume must not reopen it.
    if (from === "completed" && action !== "restart") throw new OnboardingTransitionError(from, to);
    if (!canTransition(from, to)) throw new OnboardingTransitionError(from, to);

    const facts = await deriveFacts(db, tenantId, userId);
    const summary = summarize(buildChecklist(facts));
    // Completing from `dismissed` (or explicitly finishing at all) requires the REQUIRED steps to be real.
    if (to === "completed" && !summary.canFinish) throw new OnboardingRequirementsError();

    const now = new Date();
    const data: Record<string, unknown> = { onboardingStatus: to };
    if (typeof step === "string") data.onboardingStep = step.slice(0, 64);

    if (to === "in_progress" && !row.onboardingStartedAt) data.onboardingStartedAt = now;
    // completedAt is written ONCE — a later re-complete must not move the original timestamp.
    if (to === "completed" && !row.onboardingCompletedAt) data.onboardingCompletedAt = now;
    if (to === "dismissed") data.onboardingDismissedAt = now;
    if (action === "restart") {
      // Clear the previous run's outcome and bump the version so analytics can tell runs apart. This
      // touches ONLY onboarding columns — accounts, monitoring, sync and inbox data are never altered.
      data.onboardingStartedAt = now;
      data.onboardingCompletedAt = null;
      data.onboardingDismissedAt = null;
      data.onboardingStep = summary.nextStep ?? ONBOARDING_STEPS[0];
      data.onboardingChecklist = null;
      data.onboardingVersion = row.onboardingVersion + 1;
    }

    await db.membership.updateMany({ where: { tenantId, userId }, data });
    const fresh = await readRow(db, tenantId, userId);
    return fresh ? toState(fresh, await deriveFacts(db, tenantId, userId)) : null;
  });
}

/** Record an allow-listed manual acknowledgement (e.g. the welcome screen was seen) for THIS member. */
export async function acknowledgeOnboarding(
  tenantId: string, userId: string, key: AckKey, value = true,
): Promise<OnboardingState | null> {
  if (!ACK_KEYS.includes(key)) throw new Error(`unknown_onboarding_ack:${key}`);
  return withTenant(tenantId, async (db) => {
    const row = await readRow(db, tenantId, userId);
    if (!row) return null;
    const acks = { ...sanitizeAcks(row.onboardingChecklist), [key]: value };
    await db.membership.updateMany({ where: { tenantId, userId }, data: { onboardingChecklist: acks } });
    const fresh = await readRow(db, tenantId, userId);
    return fresh ? toState(fresh, await deriveFacts(db, tenantId, userId)) : null;
  });
}

/**
 * Auto-complete: when every REQUIRED step is satisfied and the member is still mid-flow, mark completed.
 * Idempotent and safe to call on every dashboard render. Returns true when it actually completed.
 */
export async function maybeAutoComplete(tenantId: string, userId: string): Promise<boolean> {
  return withTenant(tenantId, async (db) => {
    const row = await readRow(db, tenantId, userId);
    if (!row) return false;
    const status = row.onboardingStatus as OnboardingStatusValue;
    if (status !== "in_progress" && status !== "not_started") return false;
    const { canFinish } = summarize(buildChecklist(await deriveFacts(db, tenantId, userId)));
    if (!canFinish) return false;
    const res = await db.membership.updateMany({
      where: { tenantId, userId, onboardingStatus: { in: ["not_started", "in_progress"] } },
      data: { onboardingStatus: "completed", onboardingCompletedAt: new Date() },
    });
    return res.count > 0;
  });
}
