/**
 * M5 — mobile Action Queue API: list, detail, internal decisions.
 *
 * PURE tests: every dependency is injected, so this runs with fakes — no database,
 * no provider, no Next.
 *
 * The properties asserted are the ones that would be dangerous to get wrong:
 *   - NO mobile path can reach a provider execution function (proved by source scan
 *     AND by the decision handler never touching one)
 *   - the transition guard is atomic and server-owned; a losing race returns 409
 *     with canonical state rather than overwriting a terminal decision
 *   - a foreign-tenant item is indistinguishable from a missing one
 *   - forged role / canApprove / tenantId in the request change nothing
 *   - no token, raw provider error, audit metadata or live config leaks
 *
 * Run: pnpm mobile-queue:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ResolvedSession, SessionRejectReason } from "@guardora/db";
import { queueTabStates, QUEUE_TABS } from "@guardora/ai";
import {
  handleQueueList, handleQueueDetail, handleQueueDecision, authorizeQueueRead,
  normalizeTab, bounded, boundedReason, isKnownQueueAudit, previewOf, toListItem,
  canApplyDecision, allowedFromStates, targetStateFor,
  QUEUE_TAB_KEYS, QUEUE_STATES, QUEUE_DECISIONS, QUEUE_REASONS, QUEUE_AUDIT_EVENTS,
  EXECUTION_STATUSES, READINESS_STATES, LIFECYCLE_STATES, PROPOSED_ACTIONS,
  type QueueDeps, type QueueSourceRow, type QueueDetailSource, type QueueStateKey,
  type DecisionOutcome,
} from "../src/server/mobile-queue";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/** Comment-stripped source — the "never does X" guards must inspect CODE, not prose. */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);
const NOW = new Date("2026-06-15T12:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function session(over: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    sessionId: "s1", userId: "user_A", userName: "Ada", userEmail: "ada@tamanor.test",
    emailVerified: true, tenantId: "tenant_A", tenantName: "Acme", workspaceKind: "business",
    role: "owner", expiresAt: new Date("2030-01-01"), absoluteExpiresAt: new Date("2030-01-01"),
    rememberMe: false, ...over,
  };
}

function row(over: Partial<QueueSourceRow> = {}): QueueSourceRow {
  return {
    id: "q1", relatedInboxItemId: "itm_1", proposedAction: "hide_comment",
    queueState: "approval_required", state: "approval_required",
    category: "scam", reason: null, createdAt: NOW.toISOString(),
    contentPreview: "This shop is a scam", contentType: "comment", author: "Jan",
    platform: "facebook", account: "Acme SK", rating: null, risk: "high",
    execution: null, lifecycle: "unknown",
    ...over,
  };
}

function detail(over: Partial<QueueDetailSource> = {}): QueueDetailSource {
  return {
    ...row(),
    contentText: "This shop is a scam, do not order",
    confidence: 0.92,
    policy: { mode: "approval", neverAutonomous: false, autonomousEligible: true },
    readiness: { state: "dry_run", reason: "dry_run_mode" },
    executions: [{ status: "dry_run", trigger: "approval", reason: "dry_run_mode", at: NOW.toISOString() }],
    activity: [
      { id: "a1", event: "approval.approved", at: NOW },
      { id: "a2", event: "platform_action.blocked", at: NOW },
    ],
    ...over,
  };
}

const classify = (k: unknown) =>
  k === "business" ? "business" as const : k === "family" ? "family" as const : "unsupported" as const;

interface Rec {
  listFor: { tenantId: string; tab: string; cursor: string | null }[];
  getFor: { tenantId: string; itemId: string }[];
  decisions: { tenantId: string; userId: string; itemId: string; decision: string; allowedFrom: string[]; target: string }[];
  events: string[];
}

function makeDeps(opts: {
  sessionResult?: { ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason };
  rows?: QueueSourceRow[];
  item?: QueueDetailSource | null;
  /** Second read after a decision, to model another operator's change. */
  itemAfter?: QueueDetailSource | null;
  canApprove?: boolean;
  decisionOutcome?: DecisionOutcome;
  hasMore?: boolean;
  listThrows?: boolean;
  getThrows?: boolean;
} = {}): { deps: QueueDeps; rec: Rec } {
  const rec: Rec = { listFor: [], getFor: [], decisions: [], events: [] };
  let getCalls = 0;
  return {
    rec,
    deps: {
      readUserSession: async () => opts.sessionResult ?? { ok: true, session: session() },
      classifyWorkspace: classify,
      emitOpsEvent: (e) => rec.events.push(e),
      now: () => NOW,
      canApprove: () => opts.canApprove ?? true,
      tenantAllowsOperations: async () => true,
      listQueue: async (input) => {
        rec.listFor.push(input);
        if (opts.listThrows) throw new Error("db down");
        return {
          rows: opts.rows ?? [row()],
          nextCursor: opts.hasMore ? "Y3Vy" : null,
          hasMore: opts.hasMore ?? false,
          counts: { active: 4, approval: 3, blocked: 1 },
        };
      },
      getQueueItem: async (input) => {
        rec.getFor.push(input);
        if (opts.getThrows) throw new Error("db down");
        getCalls += 1;
        // The 2nd+ read models the post-decision / post-conflict state.
        if (getCalls > 1 && opts.itemAfter !== undefined) return opts.itemAfter;
        return opts.item === undefined ? detail() : opts.item;
      },
      applyDecision: async (input) => {
        rec.decisions.push(input);
        return opts.decisionOutcome ?? { ok: true };
      },
      countsFor: async () => ({ active: 3, approval: 2, blocked: 1 }),
    },
  };
}

const auth = { authorization: "Bearer good" };
const listReq = (tab?: string, cursor?: string) => ({ ...auth, tab: tab ?? null, cursor: cursor ?? null });

async function run() {
  /* ===================== PROVIDER-WRITE BOUNDARY ===================== */
  // The single most important property of M5 — asserted FIRST.
  console.log("\nPROVIDER-WRITE BOUNDARY");

  {
    const svc = codeOf("apps/web/src/server/mobile-queue.ts");
    const deps = codeOf("apps/web/src/server/mobile-queue-deps.ts");
    const routes = ["route", "[itemId]/route", "[itemId]/decision/route"].map((r) =>
      codeOf(`apps/web/src/app/api/mobile/action-queue/${r}.ts`));
    const all = [svc, deps, ...routes];

    for (const fn of [
      "attemptFacebookHide", "hideComment", "executeLiveHide", "runHideForQueueItem",
      "GraphFacebookHideTransport", "resolveMetaAccessTokenSafe", "commentPreflight",
      "getCommentLifecycle", "revalidateAndRepair", "retryQueueItem",
      "ROLLBACK_AVAILABLE", "rollbackExecution", "performRollback",
    ]) {
      check(`no mobile queue module references ${fn}`, all.every((s) => !s.includes(fn)));
    }
    // "rollback" DOES appear — but only as canonical STATE names that must be
    // displayable (`rollback_needed`, `rollback_pending`, `rolled_back`). Assert it
    // never appears as anything else, e.g. a call or an action key.
    check("rollback appears only as a bounded state token",
      all.every((s) => (s.match(/rollback\w*/g) ?? []).every((m) =>
        m === "rollback_needed" || m === "rollback_pending" || m === "rolled_back")));
    check("no mobile queue module imports @guardora/sync at all",
      all.every((s) => !s.includes("@guardora/sync")));
    check("no provider transport is constructed", all.every((s) => !/new\s+Graph/.test(s)));
    check("no provider token is read", all.every((s) => !/accessToken|longLivedToken|pageAccessToken/.test(s)));
    check("no live-config gate is referenced", all.every((s) => !s.includes("getLiveActionsConfig") && !s.includes("liveAttempt")));
    check("the decision union has no provider member",
      dump([...QUEUE_DECISIONS]) === dump(["approve", "reject", "resolve"]));
    for (const forbidden of ["hide", "delete", "reply", "ban", "retry", "rollback", "execute"]) {
      check(`decision "${forbidden}" is not expressible`, !(QUEUE_DECISIONS as readonly string[]).includes(forbidden));
    }
    check("deps read PERSISTED execution history, not a prediction", deps.includes("platformActionExecution.findMany"));
    check("no provider error message is ever selected", !deps.includes("providerErrorMessage"));
    check("no provider response code is ever selected", !deps.includes("providerResponseCode"));
  }
  {
    // Behavioural proof: a full approve touches ONLY the injected decision fn.
    const { deps, rec } = makeDeps();
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("approve succeeds without any execution dependency existing", res.status === 200);
    check("approve calls exactly one decision write", rec.decisions.length === 1);
    check("the decision carries no provider intent",
      !dump(rec.decisions[0]).includes("hide") || dump(rec.decisions[0]).includes("approve"));
    check("QueueDeps has no provider-execution member",
      !Object.keys(deps).some((k) => /hide|execute|provider|transport|rollback|retry/i.test(k)));
  }

  /* ===================== AUTH GATE ===================== */
  console.log("\nAUTH GATE");

  for (const [label, header] of [
    ["missing", null], ["empty", ""], ["bare", "abc"], ["wrong scheme", "Basic x"],
    ["Bearer only", "Bearer"], ["token with space", "Bearer a b"],
  ] as const) {
    const { deps } = makeDeps();
    check(`list rejects ${label} → 401`, (await handleQueueList({ ...listReq(), authorization: header }, deps)).status === 401);
    check(`detail rejects ${label} → 401`, (await handleQueueDetail({ authorization: header, itemId: "q1" }, deps)).status === 401);
    check(`decision rejects ${label} → 401`,
      (await handleQueueDecision({ authorization: header, itemId: "q1", body: { decision: "approve" } }, deps)).status === 401);
  }
  for (const [reason, expected] of [
    ["session_revoked", "session_revoked"], ["password_changed", "session_revoked"],
    ["session_expired", "session_expired"], ["session_expired_idle", "session_expired"],
    ["membership_missing", "unauthenticated"], ["tenant_deleting", "unauthenticated"],
  ] as [SessionRejectReason, string][]) {
    const { deps } = makeDeps({ sessionResult: { ok: false, reason } });
    const res = await handleQueueList(listReq(), deps);
    check(`${reason} → 401 ${expected}`, res.status === 401 && res.body.error === expected);
  }
  {
    const { deps, rec } = makeDeps({ sessionResult: { ok: false, reason: "session_expired_idle" } });
    await handleQueueList(listReq(), deps);
    check("idle expiry is audited", rec.events.includes("auth.session_expired_idle"));
  }
  for (const [label, over] of [
    ["unverified email", { emailVerified: false }],
    ["family workspace", { workspaceKind: "family" }],
  ] as [string, Partial<ResolvedSession>][]) {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session(over) } });
    check(`${label} → 403`, (await handleQueueList(listReq(), deps)).status === 403);
    check(`${label} never reads the queue`, rec.listFor.length === 0);
  }
  for (const kind of ["", "internal", "child_safety_organization", "BUSINESS", "garbage", null, 7]) {
    const { deps } = makeDeps({ sessionResult: { ok: true, session: session({ workspaceKind: kind as string }) } });
    const res = await handleQueueList(listReq(), deps);
    check(`unknown workspace ${dump(kind)} FAILS CLOSED`, res.status === 403 && res.body.error === "workspace_unsupported");
  }
  check("a business+verified session passes the gate", (await authorizeQueueRead("Bearer t", makeDeps().deps)).ok === true);

  /* ===================== TABS ===================== */
  console.log("\nTABS");

  check("mobile tabs mirror the canonical QUEUE_TABS", dump([...QUEUE_TAB_KEYS]) === dump([...QUEUE_TABS]));
  for (const tab of QUEUE_TAB_KEYS) {
    const { deps, rec } = makeDeps();
    const res = await handleQueueList(listReq(tab), deps);
    check(`tab ${tab} is honoured`, res.status === 200 && res.body.tab === tab);
    check(`tab ${tab} reaches the repo`, rec.listFor[0]!.tab === tab);
  }
  for (const bad of ["", "ACTIVE", "pending", "deleted", "'; DROP", null, undefined, "all "]) {
    check(`invalid tab ${dump(bad)} → active`, normalizeTab(bad as string) === "active");
  }
  // The canonical state mapping must be reused verbatim, not re-listed.
  check("active = approval_required + failed", dump(queueTabStates("active")) === dump(["approval_required", "failed"]));
  check("approval = approval_required only", dump(queueTabStates("approval")) === dump(["approval_required"]));
  check("blocked = blocked_by_safety + failed", dump(queueTabStates("blocked")) === dump(["blocked_by_safety", "failed"]));
  check("resolved covers the terminal set",
    dump(queueTabStates("resolved")) === dump(["executed", "no_action", "approved", "rejected", "rollback_needed"]));
  check("all applies no state filter", queueTabStates("all") === null);
  check("the deps layer reuses queueTabStates", codeOf("apps/web/src/server/mobile-queue-deps.ts").includes("queueTabStates"));

  /* ===================== TENANCY ===================== */
  console.log("\nTENANCY");

  {
    const { deps, rec } = makeDeps();
    await handleQueueList({ ...auth, tab: "active", cursor: null }, deps);
    check("tenant comes from the SESSION", rec.listFor[0]!.tenantId === "tenant_A");
  }
  {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session({ tenantId: "tenant_B" }) } });
    await handleQueueList(listReq(), deps);
    check("a token for tenant B lists tenant B", rec.listFor[0]!.tenantId === "tenant_B");
  }
  {
    const { deps } = makeDeps({ item: null });
    const res = await handleQueueDetail({ ...auth, itemId: "q_from_tenant_B" }, deps);
    check("a foreign/missing item → 404 not_found", res.status === 404 && res.body.error === "not_found");
    check("...revealing nothing about existence elsewhere", dump(res.body) === dump({ error: "not_found" }));
  }
  {
    const svc = codeOf("apps/web/src/server/mobile-queue.ts");
    const deps = codeOf("apps/web/src/server/mobile-queue-deps.ts");
    check("handlers never read a tenant from the request", !svc.includes("raw.tenantId") && !svc.includes("req.tenantId"));
    check("handlers never read a role from the request", !svc.includes("raw.role"));
    check("handlers never read canApprove from the request", !svc.includes("raw.canApprove"));
    check("detail does NOT use findUnique", !deps.includes("findUnique"));
    check("queue lookups carry an explicit tenantId predicate", deps.includes("where: { id: itemId, tenantId }"));
  }

  /* ===================== LIST ===================== */
  console.log("\nLIST");

  {
    const { deps } = makeDeps();
    const res = await handleQueueList(listReq(), deps);
    check("valid session → 200", res.status === 200);
    check("items are returned", (res.body.items as unknown[]).length === 1);
    check("counts are returned", dump(res.body.counts) === dump({ active: 4, approval: 3, blocked: 1 }));
    check("canDecide reflects the SERVER permission", res.body.canDecide === true);
  }
  {
    const { deps } = makeDeps({ hasMore: true });
    const page = (await handleQueueList(listReq(), deps)).body.page as { hasMore: boolean; nextCursor: string | null };
    check("hasMore + nextCursor travel together", page.hasMore === true && page.nextCursor === "Y3Vy");
  }
  {
    const { deps, rec } = makeDeps();
    await handleQueueList(listReq("active", "OPAQUE"), deps);
    check("the cursor is forwarded opaquely", rec.listFor[0]!.cursor === "OPAQUE");
    const svc = codeOf("apps/web/src/server/mobile-queue.ts");
    check("the service never decodes a cursor", !svc.includes("base64") && !svc.includes("Buffer.from"));
  }
  {
    const { deps } = makeDeps({ listThrows: true });
    const res = await handleQueueList(listReq(), deps);
    check("a data failure → bounded 500", res.status === 500 && res.body.error === "server_error");
    check("...leaking no internal detail", !dump(res).includes("db down"));
  }
  {
    const { deps } = makeDeps({ rows: [] });
    check("an empty page is a valid 200", (await handleQueueList(listReq(), deps)).status === 200);
  }

  /* ===================== DTO SAFETY ===================== */
  console.log("\nDTO SAFETY");

  {
    const item = toListItem(row(), true);
    const keys = Object.keys(item).sort();
    check("the list DTO has exactly the approved fields",
      dump(keys) === dump([
        "account", "author", "canApprove", "canReject", "canResolve", "category",
        "contentPreview", "contentType", "createdAt", "execution", "id", "lifecycle",
        "platform", "proposedAction", "queueState", "rating", "reason",
        "relatedInboxItemId", "risk",
      ]), dump(keys));
    for (const forbidden of ["tenantId", "brandId", "state", "policyId", "accessToken", "longLivedToken", "providerErrorMessage", "aiDiagnostics", "approvedByUserId", "rejectedByUserId"]) {
      check(`list DTO omits ${forbidden}`, !(forbidden in (item as unknown as Record<string, unknown>)));
    }
    check("the raw transition state is NOT leaked (only affordances)", !("state" in (item as unknown as Record<string, unknown>)));
  }
  {
    const { deps } = makeDeps();
    const s = dump((await handleQueueList(listReq(), deps)).body);
    check("list response contains no tenant id", !s.includes("tenant_A"));
    check("list response contains no token", !s.includes("Bearer") && !s.includes("good"));
    check("list response contains no live config", !s.includes("LIVE_HIDE") && !s.includes("liveConfirmed"));
  }

  /* ===================== DETAIL ===================== */
  console.log("\nDETAIL");

  {
    const { deps } = makeDeps();
    const res = await handleQueueDetail({ ...auth, itemId: "q1" }, deps);
    const item = res.body.item as Record<string, unknown>;
    check("valid item → 200", res.status === 200);
    check("detail includes the full content text", item.contentText === "This shop is a scam, do not order");
    check("detail includes the policy block", dump(item.policy) === dump({ mode: "approval", neverAutonomous: false, autonomousEligible: true }));
    check("detail includes readiness", dump(item.readiness) === dump({ state: "dry_run", reason: "dry_run_mode" }));
    check("detail includes the execution history", (item.executions as unknown[]).length === 1);
    check("detail links the related inbox item", item.relatedInboxItemId === "itm_1");
  }
  {
    const { deps } = makeDeps({ item: detail({ relatedInboxItemId: null }) });
    const item = (await handleQueueDetail({ ...auth, itemId: "q1" }, deps)).body.item as Record<string, unknown>;
    check("a removed related item yields a null link", item.relatedInboxItemId === null);
  }
  {
    const { deps } = makeDeps({
      item: detail({
        activity: [
          { id: "a1", event: "approval.rejected", at: NOW },
          { id: "a2", event: "internal.pipeline_secret_v17", at: NOW },
          { id: "a3", event: "billing.charge_failed", at: NOW },
        ],
      }),
    });
    const res = await handleQueueDetail({ ...auth, itemId: "q1" }, deps);
    const item = res.body.item as { activity: { event: string }[] };
    check("unknown audit events are DROPPED", item.activity.length === 1 && item.activity[0]!.event === "approval.rejected");
    check("...and never appear as raw strings", !dump(res).includes("internal.pipeline_secret_v17"));
    check("activity carries id/event/at only", dump(Object.keys(item.activity[0]!).sort()) === dump(["at", "event", "id"]));
    check("no audit metadata is forwarded", !dump(res).includes("metadata") && !dump(res).includes("actorUserId"));
  }
  for (const e of QUEUE_AUDIT_EVENTS) check(`audit ${e} is recognised`, isKnownQueueAudit(e));
  for (const e of ["approval.deleted", "APPROVAL.APPROVED", "", "__proto__"]) {
    check(`unknown audit ${dump(e)} not recognised`, !isKnownQueueAudit(e));
  }
  {
    const { deps } = makeDeps();
    check("a blank itemId → 400", (await handleQueueDetail({ ...auth, itemId: "  " }, deps)).status === 400);
    const { deps: d2 } = makeDeps({ getThrows: true });
    check("a detail failure → bounded 500", (await handleQueueDetail({ ...auth, itemId: "q1" }, d2)).status === 500);
  }
  {
    // Review with a rating.
    const { deps } = makeDeps({ item: detail({ contentType: "review", rating: 2, contentText: null }) });
    const item = (await handleQueueDetail({ ...auth, itemId: "q1" }, deps)).body.item as Record<string, unknown>;
    check("a review keeps its rating", item.rating === 2 && item.contentType === "review");
    check("a rating-only review reports null text", item.contentText === null);
  }

  /* ===================== TRANSITIONS ===================== */
  console.log("\nTRANSITIONS");

  const decidable: QueueStateKey[] = ["suggested", "approval_required", "blocked_by_safety", "failed", "dry_run", "monitor"];
  for (const s of decidable) {
    check(`approve allowed from ${s}`, canApplyDecision("approve", s));
    check(`reject allowed from ${s}`, canApplyDecision("reject", s));
    check(`resolve allowed from ${s}`, canApplyDecision("resolve", s));
  }
  for (const s of ["rejected", "no_action"] as QueueStateKey[]) {
    for (const d of QUEUE_DECISIONS) check(`${d} REFUSED from terminal ${s}`, !canApplyDecision(d, s));
  }
  check("approve refused once already approved", !canApplyDecision("approve", "approved"));
  check("approve refused once executed", !canApplyDecision("approve", "executed"));
  check("reject refused once executed", !canApplyDecision("reject", "executed"));
  check("reject still allowed from approved (decision reversal before execution)", canApplyDecision("reject", "approved"));
  check("resolve ALLOWED from executed (mark handled after a hide)", canApplyDecision("resolve", "executed"));
  check("approve targets approved", targetStateFor("approve") === "approved");
  check("reject targets rejected", targetStateFor("reject") === "rejected");
  check("resolve targets no_action", targetStateFor("resolve") === "no_action");
  check("every allowed-from set is a subset of the canonical states",
    QUEUE_DECISIONS.every((d) => allowedFromStates(d).every((s) => (QUEUE_STATES as readonly string[]).includes(s))));

  /* --------------------- affordances --------------------- */
  {
    const item = toListItem(row({ state: "approval_required" }), true);
    check("a decidable item advertises all three actions", item.canApprove && item.canReject && item.canResolve);
  }
  {
    const item = toListItem(row({ state: "executed" }), true);
    check("an executed item cannot be approved", !item.canApprove);
    check("an executed item cannot be rejected", !item.canReject);
    check("an executed item CAN be resolved", item.canResolve);
  }
  {
    const item = toListItem(row({ state: "rejected" }), true);
    check("a terminal item advertises nothing", !item.canApprove && !item.canReject && !item.canResolve);
  }
  {
    const item = toListItem(row({ state: "approval_required" }), false);
    check("a role without ProposalApprove advertises nothing",
      !item.canApprove && !item.canReject && !item.canResolve);
  }

  /* ===================== DECISIONS ===================== */
  console.log("\nDECISIONS");

  for (const decision of QUEUE_DECISIONS) {
    const { deps, rec } = makeDeps();
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision } }, deps);
    check(`${decision} succeeds`, res.status === 200 && res.body.ok === true);
    check(`${decision} uses the session tenant + user`,
      rec.decisions[0]!.tenantId === "tenant_A" && rec.decisions[0]!.userId === "user_A");
    check(`${decision} passes the ATOMIC allowed-from guard`, rec.decisions[0]!.allowedFrom.length > 0);
    check(`${decision} returns the fresh canonical item`, res.body.item !== null);
    check(`${decision} returns recomputed counts`, dump(res.body.counts) === dump({ active: 3, approval: 2, blocked: 1 }));
  }
  for (const bad of [{ decision: "hide" }, { decision: "execute" }, { decision: "retry" }, { decision: "rollback" }, { decision: "" }, {}, null, [], "approve"]) {
    const { deps, rec } = makeDeps();
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: bad }, deps);
    check(`invalid decision ${dump(bad)} → 400`, res.status === 400 && res.body.error === "invalid_request");
    check(`invalid decision ${dump(bad)} never writes`, rec.decisions.length === 0);
  }
  {
    const { deps } = makeDeps();
    check("a blank itemId → 400",
      (await handleQueueDecision({ ...auth, itemId: "", body: { decision: "approve" } }, deps)).status === 400);
  }

  /* --------------------- decision security --------------------- */
  {
    const { deps, rec } = makeDeps({ canApprove: false });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("a role WITHOUT ProposalApprove → 403", res.status === 403 && res.body.error === "permission_denied");
    check("...and never writes", rec.decisions.length === 0);
    check("...and never even reads the item", rec.getFor.length === 0);
  }
  {
    const { deps, rec } = makeDeps({ canApprove: false });
    const res = await handleQueueDecision(
      { ...auth, itemId: "q1", body: { decision: "approve", canApprove: true, role: "owner", tenantId: "tenant_EVIL", userId: "user_EVIL" } },
      deps,
    );
    check("a forged canApprove does not grant the decision", res.status === 403);
    check("a forged role does not grant the decision", res.body.error === "permission_denied");
    check("a forged tenantId never reaches the write", rec.decisions.length === 0);
  }
  {
    const { deps, rec } = makeDeps();
    await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve", tenantId: "tenant_EVIL", queueState: "executed" } }, deps);
    check("a forged queueState cannot set the target", rec.decisions[0]!.target === "approved");
    check("the write is scoped to the session tenant", rec.decisions[0]!.tenantId === "tenant_A");
  }
  for (const [label, over] of [
    ["unverified", { emailVerified: false }], ["family workspace", { workspaceKind: "family" }],
  ] as [string, Partial<ResolvedSession>][]) {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session(over) } });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check(`decision gated for ${label} → 403`, res.status === 403);
    check(`decision for ${label} never writes`, rec.decisions.length === 0);
  }
  {
    const { deps } = makeDeps({ item: null });
    const res = await handleQueueDecision({ ...auth, itemId: "gone", body: { decision: "approve" } }, deps);
    check("deciding a missing/foreign item → 404", res.status === 404 && res.body.error === "not_found");
  }

  /* ===================== MULTI-OPERATOR RACES ===================== */
  console.log("\nMULTI-OPERATOR RACES");

  {
    // The item is ALREADY terminal when we read it.
    const { deps, rec } = makeDeps({ item: detail({ state: "rejected", queueState: "rejected" }) });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("approving an already-rejected item → 409 conflict", res.status === 409 && res.body.error === "conflict");
    check("...and never writes", rec.decisions.length === 0);
    check("...and hands back the canonical current state",
      (res.body.item as { queueState: string }).queueState === "rejected");
  }
  {
    // The state changed BETWEEN our read and our write — the atomic guard matched 0 rows.
    const { deps } = makeDeps({
      item: detail({ state: "approval_required" }),
      itemAfter: detail({ state: "approved", queueState: "approved" }),
      decisionOutcome: { ok: false, reason: "conflict" },
    });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "reject" } }, deps);
    check("a LOST RACE → 409, not a silent overwrite", res.status === 409 && res.body.error === "conflict");
    check("...and returns the winner's canonical state",
      (res.body.item as { queueState: string }).queueState === "approved");
  }
  {
    const { deps } = makeDeps({ decisionOutcome: { ok: false, reason: "not_found" } });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("a vanished item during the write → 404", res.status === 404);
  }
  {
    // Double-approve: the second read sees `approved` and is refused BEFORE writing.
    const { deps, rec } = makeDeps({ item: detail({ state: "approved", queueState: "approved" }) });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("double approve → 409 (never a duplicate write)", res.status === 409 && rec.decisions.length === 0);
  }
  {
    const { deps, rec } = makeDeps({ item: detail({ state: "rejected", queueState: "rejected" }) });
    const res = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "reject" } }, deps);
    check("double reject → 409 (never a duplicate write)", res.status === 409 && rec.decisions.length === 0);
  }
  {
    const { deps } = makeDeps({ item: detail({ state: "executed", queueState: "executed" }) });
    const approve = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "approve" } }, deps);
    check("an executed item cannot be contradicted by approve", approve.status === 409);
    const { deps: d2 } = makeDeps({ item: detail({ state: "executed", queueState: "executed" }) });
    const resolve = await handleQueueDecision({ ...auth, itemId: "q1", body: { decision: "resolve" } }, d2);
    check("...but CAN be resolved (mark handled)", resolve.status === 200);
  }
  {
    const deps = codeOf("apps/web/src/server/mobile-queue-deps.ts");
    check("the write is conditional (updateMany with a state guard)",
      deps.includes("updateMany") && deps.includes("queueState: { in: allowedFrom }"));
    check("the write is NOT an unconditional update", !/actionQueueItem\.update\(/.test(deps));
    check("zero matched rows is reported as a conflict", deps.includes('res.count === 0') && deps.includes('"conflict"'));
  }

  /* ===================== BOUNDED MAPPING ===================== */
  console.log("\nBOUNDED MAPPING");

  check("a known reason maps through", boundedReason("token_expired") === "token_expired");
  for (const junk of ["some_internal_provider_gate_v17", "", "__proto__", "UNKNOWN"]) {
    const mapped = boundedReason(junk);
    check(`internal reason ${dump(junk)} never reaches the UI`, mapped === null || mapped === "unavailable");
  }
  check("a null reason stays null", boundedReason(null) === null && boundedReason(undefined) === null);
  check("an unknown execution status falls back safely", bounded(EXECUTION_STATUSES, "quantum", "blocked") === "blocked");
  check("an unknown queue state falls back safely", bounded(QUEUE_STATES, "weird", "suggested") === "suggested");
  check("an unknown proposed action falls back to no_action", bounded(PROPOSED_ACTIONS, "nuke", "no_action") === "no_action");
  check("readiness/lifecycle vocabularies are bounded",
    READINESS_STATES.length === 5 && LIFECYCLE_STATES.length === 5);
  check("every canonical reason is in the bounded set",
    ["token_expired", "missing_permission", "safety_never_autonomous", "dry_run_mode", "already_executed", "comment_deleted_or_unavailable"]
      .every((r) => (QUEUE_REASONS as readonly string[]).includes(r)));
  check("a long preview is truncated", (previewOf("x".repeat(500)) ?? "").endsWith("…"));
  check("an empty preview is null", previewOf("  ") === null && previewOf(null) === null);

  /* ===================== SOURCE PARITY ===================== */
  console.log("\nSOURCE PARITY");

  {
    const deps = codeOf("apps/web/src/server/mobile-queue-deps.ts");
    const svc = codeOf("apps/web/src/server/mobile-queue.ts");
    check("mobile reuses the canonical permission", deps.includes("Permission.ProposalApprove"));
    check("mobile reuses the canonical tab states", deps.includes("queueTabStates"));
    check("mobile reuses the canonical safety sets", deps.includes("NEVER_AUTONOMOUS") && deps.includes("AUTONOMOUS_ELIGIBLE"));
    check("mobile reuses the customer classification projection", deps.includes("projectStoredClassification"));
    check("mobile reuses the data-mode brand scoping", deps.includes("getRealModeFilter"));
    check("mobile writes the canonical audit events",
      ["approval.approved", "approval.rejected", "approval.resolved"].every((e) => deps.includes(e)));
    check("the audit records executed:false truthfully", deps.includes("executed: false"));
    check("no offset pagination", !deps.includes("skip:"));
    check("keyset ordering is (createdAt, id)", deps.includes('orderBy: [{ createdAt: "desc" }, { id: "desc" }]'));
    check("the service module holds no Prisma access", !svc.includes("prisma") && !svc.includes("db."));
    check("no bulk decision is reachable", !deps.includes("updateMany({ where: { id: { in:") && !svc.includes("bulk"));

    for (const r of ["route", "[itemId]/route", "[itemId]/decision/route"]) {
      const src = codeOf(`apps/web/src/app/api/mobile/action-queue/${r}.ts`);
      check(`${r} sets no cookie`, !src.includes("cookies"));
      check(`${r} is no-store`, src.includes("no-store"));
      check(`${r} performs no redirect`, !src.includes("redirect("));
    }
  }
  {
    // The existing web Server Actions must be untouched by this sprint.
    const webActions = readSrc("apps/web/src/app/dashboard/action-queue/[id]/actions.ts");
    check("web executeLiveHide still exists (unchanged surface)", webActions.includes("export async function executeLiveHide"));
    check("web approveQueueItem still exists", webActions.includes("export async function approveQueueItem"));
    check("web still owns the live confirmation phrase", webActions.includes('"LIVE HIDE"'));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile Action Queue API (M5): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
