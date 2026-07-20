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

/** Steps that must be done before a manual "Finish" is offered. The trailing steps depend on provider
 *  data arriving, which a user cannot force, so they never block completion. */
export const REQUIRED_STEPS: readonly OnboardingStepKey[] = ["workspace", "connect_account", "enable_monitoring"];

/** Keys accepted inside `onboardingChecklist`. Anything else is dropped before persisting. */
export const ACK_KEYS = ["welcome_seen", "finish_ack"] as const;
export type AckKey = (typeof ACK_KEYS)[number];

export interface OnboardingChecklistItem {
  key: OnboardingStepKey;
  done: boolean;
  /** True when the step is one of REQUIRED_STEPS. */
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
  /** Number of derived steps done. */
  completedCount: number;
  totalCount: number;
  /** 0-100, rounded. */
  progressPct: number;
  /** The first not-done step, or null when everything is done. */
  nextStep: OnboardingStepKey | null;
  /** True when every REQUIRED_STEPS entry is done (a manual "Finish" may be offered). */
  canFinish: boolean;
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

/** PURE: progress + next recommended action from a checklist. */
export function summarize(checklist: OnboardingChecklistItem[]): {
  completedCount: number; totalCount: number; progressPct: number;
  nextStep: OnboardingStepKey | null; canFinish: boolean;
} {
  const completedCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;
  return {
    completedCount,
    totalCount,
    progressPct: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    nextStep: checklist.find((c) => !c.done)?.key ?? null,
    canFinish: checklist.filter((c) => c.required).every((c) => c.done),
  };
}

/** The allowed state machine. `completed` is TERMINAL except for an explicit restart. */
const TRANSITIONS: Record<OnboardingStatusValue, readonly OnboardingStatusValue[]> = {
  not_started: ["in_progress", "dismissed", "completed"],
  in_progress: ["in_progress", "dismissed", "completed"],
  dismissed: ["in_progress", "completed"],
  // Only `restartOnboarding` may leave `completed`, and it targets not_started explicitly.
  completed: ["not_started"],
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

/** Derive every checklist fact from live system state inside one tenant transaction. */
export async function deriveFacts(db: TenantTx, tenantId: string): Promise<DerivedFacts> {
  const [connected, brandsWithAccount, monitored, synced, reviewed] = await Promise.all([
    db.connectedAccount.count({ where: { tenantId, status: { not: "disconnected" } } }),
    db.brand.count({ where: { tenantId, connectedAccounts: { some: { status: { not: "disconnected" } } } } }),
    db.connectedAccount.count({ where: { tenantId, monitoringEnabled: true, status: { not: "disconnected" } } }),
    db.connectedAccount.count({ where: { tenantId, lastSuccessfulSyncAt: { not: null } } }),
    // A real human review: the item was opened (isRead) or moved out of the `new` workflow state.
    db.reputationItem.count({ where: { tenantId, OR: [{ isRead: true }, { inboxWorkflowStatus: { not: "new" } }] } }),
  ]);
  return {
    hasWorkspace: true, // a membership in this tenant is the workspace itself
    hasConnectedAccount: connected > 0,
    hasProtectedBrand: brandsWithAccount > 0,
    hasMonitoringEnabled: monitored > 0,
    hasFirstSync: synced > 0,
    hasFirstReview: reviewed > 0,
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
    return toState(row, await deriveFacts(db, tenantId));
  });
}

export type OnboardingAction = "start" | "dismiss" | "resume" | "complete" | "restart";

const TARGET: Record<OnboardingAction, OnboardingStatusValue> = {
  start: "in_progress",
  dismiss: "dismissed",
  resume: "in_progress",
  complete: "completed",
  restart: "not_started",
};

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
    if (!canTransition(from, to)) throw new OnboardingTransitionError(from, to);

    const now = new Date();
    const data: Record<string, unknown> = { onboardingStatus: to };
    if (typeof step === "string") data.onboardingStep = step.slice(0, 64);

    if (to === "in_progress" && !row.onboardingStartedAt) data.onboardingStartedAt = now;
    if (to === "completed") data.onboardingCompletedAt = now;
    if (to === "dismissed") data.onboardingDismissedAt = now;
    if (action === "restart") {
      // A restart clears the previous run's outcome and bumps the version so analytics can tell runs apart.
      data.onboardingStartedAt = now;
      data.onboardingCompletedAt = null;
      data.onboardingDismissedAt = null;
      data.onboardingStep = null;
      data.onboardingChecklist = null;
      data.onboardingVersion = row.onboardingVersion + 1;
    }

    await db.membership.updateMany({ where: { tenantId, userId }, data });
    const fresh = await readRow(db, tenantId, userId);
    return fresh ? toState(fresh, await deriveFacts(db, tenantId)) : null;
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
    return fresh ? toState(fresh, await deriveFacts(db, tenantId)) : null;
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
    const { canFinish } = summarize(buildChecklist(await deriveFacts(db, tenantId)));
    if (!canFinish) return false;
    const res = await db.membership.updateMany({
      where: { tenantId, userId, onboardingStatus: { in: ["not_started", "in_progress"] } },
      data: { onboardingStatus: "completed", onboardingCompletedAt: new Date() },
    });
    return res.count > 0;
  });
}
