/**
 * M4 — mobile Inbox API: list, detail, internal actions, options.
 *
 * PURE tests: the service takes every dependency by injection, so this runs with
 * fakes — no database, no Next, no network.
 *
 * The properties asserted are the ones that would be dangerous to get wrong:
 *   - the read gate runs on EVERY endpoint and fails closed on an unknown workspace
 *   - a foreign-tenant item is indistinguishable from a missing one
 *   - mutations re-check RBAC and the billing write state SERVER-side; a forged
 *     role / canWrite / tenantId in the request changes nothing
 *   - provider write actions are unreachable
 *   - no admin AI diagnostics, raw audit metadata, token, tenant id or DB row leaks
 *
 * Run: pnpm mobile-inbox:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { ResolvedSession, SessionRejectReason } from "@guardora/db";
import {
  handleInboxList, handleInboxDetail, handleInboxAction, handleInboxOptions,
  parseInboxQuery, sinceFor, previewOf, safePermalink, boundedKey, isKnownAuditEvent, toListItem,
  INBOX_VIEWS, INBOX_TYPES, INBOX_SENTIMENTS, INBOX_WORKFLOWS, INBOX_PRIORITIES, INBOX_RISKS,
  INBOX_ACTIONS, INBOX_AUDIT_EVENTS, INBOX_PROCESSING_STATES, MAX_QUERY_LENGTH, PREVIEW_LENGTH,
  type InboxDeps, type InboxSourceRow, type InboxDetailSource, type InboxQuery,
} from "../src/server/mobile-inbox";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");
/**
 * Source with comments removed. The "never does X" guards must inspect CODE — these
 * modules deliberately NAME the things they avoid (findUnique, decodeCursor, bulk),
 * so matching prose would make the guards pass or fail on documentation.
 */
const codeOf = (rel: string) =>
  readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dump = (o: unknown) => JSON.stringify(o);
const NOW = new Date("2026-06-15T12:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function session(over: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    sessionId: "sess_1", userId: "user_A", userName: "Ada", userEmail: "ada@tamanor.test",
    emailVerified: true, tenantId: "tenant_A", tenantName: "Acme", workspaceKind: "business",
    role: "owner", expiresAt: new Date("2030-01-01"), absoluteExpiresAt: new Date("2030-01-01"),
    rememberMe: false, ...over,
  };
}

function row(over: Partial<InboxSourceRow> = {}): InboxSourceRow {
  return {
    id: "item_1", type: "comment", text: "This shop is a scam, do not order",
    author: "Jan Novak", platform: "facebook", account: "Acme Slovakia",
    createdAt: new Date("2026-06-14T10:00:00.000Z"),
    permalink: "https://facebook.com/c/1", rating: null,
    sentiment: "risky", risk: "high", classification: "confirmed", categories: ["scam"],
    requiresReanalysis: false, isRead: false, archived: false, priority: "normal", workflow: "new",
    assignee: null, labels: [], noteCount: 0,
    actionState: "captured", processing: "processed_paid", connectorHealth: "healthy",
    ...over,
  };
}

function detail(over: Partial<InboxDetailSource> = {}): InboxDetailSource {
  return {
    ...row(),
    notes: [{ id: "n1", body: "Escalated to legal", authorName: "Ada", createdAt: NOW }],
    activity: [
      { id: "a1", event: "inbox.mark_read", at: NOW },
      { id: "a2", event: "inbox.set_priority", at: NOW },
    ],
    ...over,
  };
}

const classify = (k: unknown) =>
  k === "business" ? "business" as const : k === "family" ? "family" as const : "unsupported" as const;

interface Rec {
  listFor: { tenantId: string; userId: string; query: InboxQuery; since: Date | undefined }[];
  getFor: { tenantId: string; itemId: string }[];
  mutateFor: unknown[];
  writeChecks: string[];
  events: string[];
}

function makeDeps(opts: {
  sessionResult?: { ok: boolean; session?: ResolvedSession; reason?: SessionRejectReason };
  rows?: InboxSourceRow[];
  item?: InboxDetailSource | null;
  canAct?: boolean;
  writable?: boolean;
  mutateResult?: { ok: boolean; reason?: string };
  hasMore?: boolean;
  listThrows?: boolean;
  getThrows?: boolean;
} = {}): { deps: InboxDeps; rec: Rec } {
  const rec: Rec = { listFor: [], getFor: [], mutateFor: [], writeChecks: [], events: [] };
  return {
    rec,
    deps: {
      readUserSession: async () => opts.sessionResult ?? { ok: true, session: session() },
      classifyWorkspace: classify,
      emitOpsEvent: (e) => rec.events.push(e),
      now: () => NOW,
      canAct: () => opts.canAct ?? true,
      hasWriteAccess: async (t) => { rec.writeChecks.push(t); return opts.writable ?? true; },
      listInbox: async (input) => {
        rec.listFor.push(input);
        if (opts.listThrows) throw new Error("db down");
        const rows = opts.rows ?? [row()];
        return {
          rows,
          nextCursor: opts.hasMore ? "Y3Vyc29y" : null,
          hasMore: opts.hasMore ?? false,
          counts: { total: 12, unread: 5, archived: 3, assigned: 2, unassigned: 7 },
        };
      },
      getInboxItem: async (input) => {
        rec.getFor.push(input);
        if (opts.getThrows) throw new Error("db down");
        return opts.item === undefined ? detail() : opts.item;
      },
      mutateInbox: async (input) => { rec.mutateFor.push(input); return opts.mutateResult ?? { ok: true }; },
      getInboxOptions: async () => ({
        platforms: ["facebook", "instagram"],
        labels: [{ id: "l1", name: "Legal", colorKey: "danger" }],
        members: [{ id: "u1", name: "Ada" }],
      }),
    },
  };
}

const auth = { authorization: "Bearer good" };
const q = (params: Record<string, string> = {}) => (key: string) => params[key] ?? null;
const listReq = (params: Record<string, string> = {}) => ({ ...auth, get: q(params) });

async function run() {
  /* ===================== AUTH GATE ===================== */
  console.log("\nAUTH GATE");

  for (const [label, header] of [
    ["missing", null], ["empty", ""], ["bare token", "abc"], ["wrong scheme", "Basic abc"],
    ["Bearer only", "Bearer"], ["Bearer + space", "Bearer "], ["token with space", "Bearer a b"],
  ] as const) {
    const { deps } = makeDeps();
    check(`list rejects ${label} bearer → 401`,
      (await handleInboxList({ authorization: header, get: q() }, deps)).status === 401);
    check(`detail rejects ${label} bearer → 401`,
      (await handleInboxDetail({ authorization: header, itemId: "i" }, deps)).status === 401);
    check(`action rejects ${label} bearer → 401`,
      (await handleInboxAction({ authorization: header, itemId: "i", body: { action: "read" } }, deps)).status === 401);
  }

  for (const [reason, expected] of [
    ["session_revoked", "session_revoked"], ["password_changed", "session_revoked"],
    ["session_expired", "session_expired"], ["session_expired_idle", "session_expired"],
    ["session_expired_absolute", "session_expired"], ["membership_missing", "unauthenticated"],
    ["tenant_deleting", "unauthenticated"],
  ] as [SessionRejectReason, string][]) {
    const { deps } = makeDeps({ sessionResult: { ok: false, reason } });
    const res = await handleInboxList(listReq(), deps);
    check(`${reason} → 401 ${expected}`, res.status === 401 && res.body.error === expected);
    check(`${reason} returns no items`, !("items" in res.body));
  }
  {
    const { deps, rec } = makeDeps({ sessionResult: { ok: false, reason: "session_expired_idle" } });
    await handleInboxList(listReq(), deps);
    check("idle expiry is audited", rec.events.includes("auth.session_expired_idle"));
  }

  for (const [label, over] of [
    ["unverified email", { emailVerified: false }],
    ["family workspace", { workspaceKind: "family" }],
  ] as [string, Partial<ResolvedSession>][]) {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session(over) } });
    const res = await handleInboxList(listReq(), deps);
    check(`${label} → 403`, res.status === 403);
    check(`${label} never queries the inbox`, rec.listFor.length === 0);
  }
  for (const kind of ["", "internal", "child_safety_organization", "BUSINESS", "garbage", null, 42]) {
    const { deps } = makeDeps({ sessionResult: { ok: true, session: session({ workspaceKind: kind as string }) } });
    const res = await handleInboxList(listReq(), deps);
    check(`unknown workspace ${dump(kind)} FAILS CLOSED`, res.status === 403 && res.body.error === "workspace_unsupported");
  }

  /* ===================== TENANCY ===================== */
  console.log("\nTENANCY");

  {
    const { deps, rec } = makeDeps();
    await handleInboxList(listReq({ tenantId: "tenant_EVIL", userId: "user_EVIL", role: "owner" }), deps);
    check("tenant comes from the SESSION", rec.listFor[0]!.tenantId === "tenant_A");
    check("user comes from the SESSION (drives assigned_me)", rec.listFor[0]!.userId === "user_A");
    check("a client tenantId parameter is never read", !dump(rec.listFor[0]!.query).includes("tenant_EVIL"));
  }
  {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session({ tenantId: "tenant_B", userId: "user_B" }) } });
    await handleInboxList(listReq(), deps);
    check("a token for tenant B lists tenant B", rec.listFor[0]!.tenantId === "tenant_B");
  }
  {
    const src = codeOf("apps/web/src/server/mobile-inbox.ts");
    check("the query parser has no tenantId field", !/tenantId/.test(src.split("export function parseInboxQuery")[1]!.slice(0, 1200)));
    check("handlers never read a tenant from the request", !src.includes("req.tenantId") && !src.includes("raw.tenantId"));
    check("handlers never read a role from the request", !src.includes("raw.role"));
    check("handlers never read canWrite from the request", !src.includes("raw.canWrite") && !src.includes("body.canWrite"));
  }

  /* ===================== QUERY PARSING ===================== */
  console.log("\nQUERY PARSING");

  {
    const parsed = parseInboxQuery(q());
    check("defaults: view=default", parsed.view === "default");
    check("defaults: range=all", parsed.range === "all");
    check("defaults: every optional filter null",
      [parsed.type, parsed.sentiment, parsed.workflow, parsed.priority, parsed.risk, parsed.q, parsed.cursor].every((v) => v === null));
  }
  for (const v of INBOX_VIEWS) check(`view ${v} accepted`, parseInboxQuery(q({ view: v })).view === v);
  for (const t of INBOX_TYPES) check(`type ${t} accepted`, parseInboxQuery(q({ type: t })).type === t);
  for (const s of INBOX_SENTIMENTS) check(`sentiment ${s} accepted`, parseInboxQuery(q({ sentiment: s })).sentiment === s);
  for (const w of INBOX_WORKFLOWS) check(`workflow ${w} accepted`, parseInboxQuery(q({ workflow: w })).workflow === w);
  for (const p of INBOX_PRIORITIES) check(`priority ${p} accepted`, parseInboxQuery(q({ priority: p })).priority === p);
  for (const r of INBOX_RISKS) check(`risk ${r} accepted`, parseInboxQuery(q({ risk: r })).risk === r);
  for (const r of ["all", "today", "7d", "30d"]) check(`range ${r} accepted`, parseInboxQuery(q({ range: r })).range === r);

  for (const bad of ["", "INBOX", "deleted", "'; DROP TABLE--", "assigned_me ", "0"]) {
    check(`invalid view ${dump(bad)} → default`, parseInboxQuery(q({ view: bad })).view === "default");
  }
  for (const bad of ["urgent!", "HIGH", "critical", "1"]) {
    check(`invalid priority ${dump(bad)} → not applied`, parseInboxQuery(q({ priority: bad })).priority === null);
  }
  check("invalid range → all", parseInboxQuery(q({ range: "1y" })).range === "all");
  check("invalid risk → not applied", parseInboxQuery(q({ risk: "extreme" })).risk === null);
  check("unknown query keys are ignored entirely",
    !dump(parseInboxQuery(q({ evil: "x", tenantId: "t", role: "owner" }))).includes("evil"));
  {
    const long = "a".repeat(500);
    const parsed = parseInboxQuery(q({ q: long }));
    check("an over-long search is TRUNCATED, not rejected", parsed.q!.length === MAX_QUERY_LENGTH);
  }
  check("a whitespace-only search is dropped", parseInboxQuery(q({ q: "   " })).q === null);
  check("a search term is trimmed", parseInboxQuery(q({ q: "  scam  " })).q === "scam");
  for (const bad of ["../../etc", "a b", "id;drop", "<script>", "a".repeat(80)]) {
    check(`malformed id ${dump(bad.slice(0, 12))} rejected`, parseInboxQuery(q({ label: bad })).label === null);
  }
  check("a well-formed id is accepted", parseInboxQuery(q({ label: "cl_abc-123" })).label === "cl_abc-123");
  check("the cursor is passed through opaquely", parseInboxQuery(q({ cursor: "Y3Vyc29y" })).cursor === "Y3Vyc29y");
  {
    const src = codeOf("apps/web/src/server/mobile-inbox.ts");
    check("the cursor is never decoded or interpreted here",
      !src.includes("atob") && !src.includes("from(cursor") && !src.includes("decodeCursor"));
  }

  /* ===================== DATE RANGE ===================== */
  console.log("\nDATE RANGE");

  check("range=all has no lower bound", sinceFor("all", NOW) === undefined);
  check("today starts at the UTC day start", sinceFor("today", NOW)!.toISOString() === "2026-06-15T00:00:00.000Z");
  check("7d is a full inclusive week", sinceFor("7d", NOW)!.toISOString() === "2026-06-09T00:00:00.000Z");
  check("30d is a full inclusive month", sinceFor("30d", NOW)!.toISOString() === "2026-05-17T00:00:00.000Z");
  {
    const { deps, rec } = makeDeps();
    await handleInboxList(listReq({ range: "7d" }), deps);
    check("the range reaches the repo as a `since` bound", rec.listFor[0]!.since?.toISOString() === "2026-06-09T00:00:00.000Z");
  }

  /* ===================== LIST ===================== */
  console.log("\nLIST");

  {
    const { deps } = makeDeps();
    const res = await handleInboxList(listReq(), deps);
    check("valid session → 200", res.status === 200);
    check("items are returned", Array.isArray(res.body.items) && (res.body.items as unknown[]).length === 1);
    check("page carries cursor + hasMore", dump(res.body.page) === dump({ nextCursor: null, hasMore: false }));
    check("server-computed counts are returned",
      dump(res.body.counts) === dump({ total: 12, unread: 5, archived: 3, assigned: 2, unassigned: 7 }));
    check("the applied filters are echoed back", typeof res.body.applied === "object");
    check("canAct reflects the SERVER permission", res.body.canAct === true);
  }
  {
    const { deps } = makeDeps({ hasMore: true });
    const res = await handleInboxList(listReq(), deps);
    check("hasMore + nextCursor are surfaced together",
      (res.body.page as { hasMore: boolean; nextCursor: string | null }).hasMore === true &&
      (res.body.page as { nextCursor: string | null }).nextCursor === "Y3Vyc29y");
  }
  {
    const { deps } = makeDeps({ canAct: false });
    check("a role without InboxAct is told canAct:false",
      (await handleInboxList(listReq(), deps)).body.canAct === false);
  }
  {
    const { deps } = makeDeps({ listThrows: true });
    const res = await handleInboxList(listReq(), deps);
    check("a data failure → bounded 500", res.status === 500 && res.body.error === "server_error");
    check("...leaking no internal detail", !dump(res).includes("db down"));
  }
  {
    const { deps } = makeDeps({ rows: [] });
    const res = await handleInboxList(listReq(), deps);
    check("an empty page is a valid 200 with no items", res.status === 200 && (res.body.items as unknown[]).length === 0);
  }

  /* ===================== DTO SAFETY ===================== */
  console.log("\nDTO SAFETY");

  {
    const item = toListItem(row());
    const keys = Object.keys(item as unknown as Record<string, unknown>).sort();
    check("the list DTO has exactly the approved fields",
      dump(keys) === dump([
        "account", "actionState", "archived", "assignee", "author", "categories", "classification",
        "connectorHealth", "createdAt", "id", "isRead", "labels", "noteCount", "permalink", "platform",
        "preview", "priority", "processing", "rating", "requiresReanalysis", "risk", "sentiment",
        "type", "workflow",
      ]), dump(keys));
    for (const forbidden of ["tenantId", "userId", "aiDiagnostics", "riskConfidence", "modelKey", "costMicros", "inputTokens", "outputTokens", "aiProvider", "classifierVersion", "processingReason", "stored", "email"]) {
      check(`list DTO omits ${forbidden}`, !(forbidden in (item as unknown as Record<string, unknown>)));
    }
  }
  {
    const { deps } = makeDeps();
    const s = dump((await handleInboxList(listReq(), deps)).body);
    check("list response contains no tenant id", !s.includes("tenant_A"));
    check("list response contains no session token", !s.includes("good") || !s.includes("Bearer"));
    check("list response contains no AI diagnostics", !s.includes("aiDiagnostics") && !s.includes("modelKey"));
    check("list response contains no cost/token fields", !s.includes("costMicros") && !s.includes("Tokens"));
  }
  {
    // An assignee is display-name only.
    const item = toListItem(row({ assignee: { id: "u1", name: "Ada" } }));
    check("assignee carries id + name only", dump(Object.keys(item.assignee!).sort()) === dump(["id", "name"]));
    check("assignee carries no email", !dump(item).includes("@"));
  }

  /* --------------------- preview + permalink --------------------- */
  check("a short text is previewed whole", previewOf("hi") === "hi");
  check("an empty text previews as null", previewOf("") === null && previewOf("   ") === null && previewOf(null) === null);
  {
    const long = "x".repeat(PREVIEW_LENGTH + 50);
    const p = previewOf(long)!;
    check("a long text is truncated with an ellipsis", p.length <= PREVIEW_LENGTH + 1 && p.endsWith("…"));
  }
  check("https permalink is kept", safePermalink("https://facebook.com/c/1") === "https://facebook.com/c/1");
  check("http permalink is kept", safePermalink("http://example.com/x")?.startsWith("http://") === true);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "tamanor://x", "not a url", "", null]) {
    check(`unsafe permalink ${dump(bad)} → null`, safePermalink(bad) === null);
  }

  /* ===================== DETAIL ===================== */
  console.log("\nDETAIL");

  {
    const { deps, rec } = makeDeps();
    const res = await handleInboxDetail({ ...auth, itemId: "item_1" }, deps);
    const item = res.body.item as Record<string, unknown>;
    check("valid item → 200", res.status === 200);
    check("detail is scoped to the SESSION tenant", rec.getFor[0]!.tenantId === "tenant_A");
    check("detail includes the full text", item.text === "This shop is a scam, do not order");
    check("detail includes notes", Array.isArray(item.notes) && (item.notes as unknown[]).length === 1);
    check("detail includes bounded activity", Array.isArray(item.activity) && (item.activity as unknown[]).length === 2);
  }
  {
    const { deps } = makeDeps({ item: null });
    const res = await handleInboxDetail({ ...auth, itemId: "item_from_tenant_B" }, deps);
    check("a foreign/missing item → 404 not_found", res.status === 404 && res.body.error === "not_found");
    check("...revealing nothing about existence elsewhere", dump(res.body) === dump({ error: "not_found" }));
  }
  {
    const { deps } = makeDeps();
    check("a blank itemId → 400", (await handleInboxDetail({ ...auth, itemId: "  " }, deps)).status === 400);
  }
  {
    const { deps } = makeDeps({ getThrows: true });
    check("a detail data failure → bounded 500",
      (await handleInboxDetail({ ...auth, itemId: "i" }, deps)).status === 500);
  }
  {
    // Unknown audit events must be dropped, never rendered.
    const { deps } = makeDeps({
      item: detail({
        activity: [
          { id: "a1", event: "inbox.archive", at: NOW },
          { id: "a2", event: "internal.secret_pipeline_event", at: NOW },
          { id: "a3", event: "billing.charge_failed", at: NOW },
        ],
      }),
    });
    const res = await handleInboxDetail({ ...auth, itemId: "i" }, deps);
    const item = res.body.item as { activity: { event: string }[] };
    check("unknown audit events are DROPPED", item.activity.length === 1 && item.activity[0]!.event === "inbox.archive");
    check("...and never appear as raw strings", !dump(res).includes("internal.secret_pipeline_event"));
    check("activity rows carry id/event/at only",
      dump(Object.keys(item.activity[0]!).sort()) === dump(["at", "event", "id"]));
    check("no audit metadata is forwarded", !dump(res).includes("metadata") && !dump(res).includes("actorUserId") && !dump(res).includes("correlationId"));
  }
  for (const e of INBOX_AUDIT_EVENTS) check(`audit event ${e} is recognised`, isKnownAuditEvent(e));
  for (const e of ["inbox.deleted", "INBOX.ARCHIVE", "", "inbox.", "__proto__"]) {
    check(`unknown audit ${dump(e)} not recognised`, !isKnownAuditEvent(e));
  }
  {
    // Rating-only review: no text, but a rating.
    const { deps } = makeDeps({ item: detail({ type: "review", text: null, rating: 2, preview: undefined } as never) });
    const res = await handleInboxDetail({ ...auth, itemId: "i" }, deps);
    const item = res.body.item as Record<string, unknown>;
    check("a rating-only review reports text:null", item.text === null);
    check("...and preview:null (never an empty body)", item.preview === null);
    check("...and keeps its rating", item.rating === 2);
    check("...and is typed as a review", item.type === "review");
  }
  {
    const { deps } = makeDeps({ item: detail({ text: "   " }) });
    check("a whitespace-only body is normalized to null",
      ((await handleInboxDetail({ ...auth, itemId: "i" }, deps)).body.item as { text: string | null }).text === null);
  }

  /* ===================== MUTATIONS ===================== */
  console.log("\nMUTATIONS");

  for (const action of INBOX_ACTIONS) {
    const body: Record<string, unknown> = { action };
    if (action === "priority") body.value = "high";
    if (action === "workflow") body.value = "in_review";
    const { deps, rec } = makeDeps();
    const res = await handleInboxAction({ ...auth, itemId: "item_1", body }, deps);
    check(`action ${action} succeeds`, res.status === 200 && res.body.ok === true);
    check(`action ${action} reaches the repo with session tenant + user`,
      (rec.mutateFor[0] as { tenantId: string; userId: string }).tenantId === "tenant_A" &&
      (rec.mutateFor[0] as { userId: string }).userId === "user_A");
    check(`action ${action} returns the fresh canonical item`, res.body.item !== null);
  }
  for (const p of INBOX_PRIORITIES) {
    const { deps, rec } = makeDeps();
    await handleInboxAction({ ...auth, itemId: "i", body: { action: "priority", value: p } }, deps);
    check(`priority ${p} is passed through`, (rec.mutateFor[0] as { priority: string }).priority === p);
  }
  for (const w of INBOX_WORKFLOWS) {
    const { deps, rec } = makeDeps();
    await handleInboxAction({ ...auth, itemId: "i", body: { action: "workflow", value: w } }, deps);
    check(`workflow ${w} is passed through`, (rec.mutateFor[0] as { workflow: string }).workflow === w);
  }
  for (const bad of ["urgent!", "HIGH", "", "critical", null, 5, {}]) {
    const { deps, rec } = makeDeps();
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "priority", value: bad } }, deps);
    check(`invalid priority ${dump(bad)} → 400`, res.status === 400 && res.body.error === "invalid_request");
    check(`invalid priority ${dump(bad)} never reaches the repo`, rec.mutateFor.length === 0);
  }
  for (const bad of ["done", "NEW", "", "closed", null]) {
    const { deps, rec } = makeDeps();
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "workflow", value: bad } }, deps);
    check(`invalid workflow ${dump(bad)} → 400`, res.status === 400);
    check(`invalid workflow ${dump(bad)} never reaches the repo`, rec.mutateFor.length === 0);
  }
  for (const bad of [{ action: "hide" }, { action: "delete" }, { action: "reply" }, { action: "ban" }, { action: "bulk" }, { action: "" }, {}, null, [], "read"]) {
    const { deps, rec } = makeDeps();
    const res = await handleInboxAction({ ...auth, itemId: "i", body: bad }, deps);
    check(`provider/unknown action ${dump(bad)} → 400`, res.status === 400);
    check(`provider/unknown action ${dump(bad)} never reaches the repo`, rec.mutateFor.length === 0);
  }

  /* --------------------- mutation security --------------------- */
  {
    const { deps, rec } = makeDeps({ canAct: false });
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "read" } }, deps);
    check("a role WITHOUT InboxAct → 403 permission_denied", res.status === 403 && res.body.error === "permission_denied");
    check("...and never reaches the repo", rec.mutateFor.length === 0);
    check("...and never even checks billing (permission first)", rec.writeChecks.length === 0);
  }
  {
    const { deps, rec } = makeDeps({ writable: false });
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "archive" } }, deps);
    check("a restricted/read-only tenant → 403 read_only", res.status === 403 && res.body.error === "read_only");
    check("...and never reaches the repo", rec.mutateFor.length === 0);
    check("write access is checked against the SESSION tenant", rec.writeChecks[0] === "tenant_A");
  }
  {
    // A forged client payload must change nothing.
    const { deps, rec } = makeDeps({ canAct: false });
    const res = await handleInboxAction(
      { ...auth, itemId: "i", body: { action: "read", canWrite: true, role: "owner", tenantId: "tenant_EVIL", userId: "user_EVIL" } },
      deps,
    );
    check("a forged canWrite does not grant the write", res.status === 403);
    check("a forged role does not grant the write", res.body.error === "permission_denied");
    check("a forged tenantId never reaches the repo", rec.mutateFor.length === 0);
  }
  {
    const { deps, rec } = makeDeps({ writable: false, canAct: true });
    await handleInboxAction({ ...auth, itemId: "i", body: { action: "read", canWrite: true } }, deps);
    check("read-only is decided by the SERVER, not the payload", rec.mutateFor.length === 0);
  }
  for (const [label, over] of [
    ["unverified", { emailVerified: false }],
    ["family workspace", { workspaceKind: "family" }],
  ] as [string, Partial<ResolvedSession>][]) {
    const { deps, rec } = makeDeps({ sessionResult: { ok: true, session: session(over) } });
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "read" } }, deps);
    check(`mutation gated for ${label} → 403`, res.status === 403);
    check(`mutation for ${label} never reaches the repo`, rec.mutateFor.length === 0);
  }
  {
    const { deps } = makeDeps({ mutateResult: { ok: false, reason: "not_found" } });
    const res = await handleInboxAction({ ...auth, itemId: "gone", body: { action: "read" } }, deps);
    check("a repo not_found → 404", res.status === 404 && res.body.error === "not_found");
  }
  {
    const { deps } = makeDeps({ mutateResult: { ok: false, reason: "some_internal_reason" } });
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "read" } }, deps);
    check("an unexpected repo reason → bounded 400", res.status === 400 && res.body.error === "invalid_request");
    check("...never echoing the internal reason", !dump(res).includes("some_internal_reason"));
  }
  {
    // A post-mutation read failure must not turn a successful write into a failure.
    const { deps } = makeDeps({ getThrows: true });
    const res = await handleInboxAction({ ...auth, itemId: "i", body: { action: "read" } }, deps);
    check("a successful write still reports ok when the refresh read fails", res.status === 200 && res.body.ok === true);
    check("...with item:null rather than stale data", res.body.item === null);
  }
  {
    const { deps } = makeDeps();
    check("a blank itemId → 400",
      (await handleInboxAction({ ...auth, itemId: "", body: { action: "read" } }, deps)).status === 400);
  }

  /* ===================== OPTIONS ===================== */
  console.log("\nOPTIONS");

  {
    const { deps } = makeDeps();
    const res = await handleInboxOptions(auth, deps);
    const opts = res.body.options as { members: Record<string, unknown>[] };
    check("options → 200", res.status === 200);
    check("members carry id + name only", dump(Object.keys(opts.members[0]!).sort()) === dump(["id", "name"]));
    check("options expose no email", !dump(res).includes("@"));
  }
  {
    const { deps } = makeDeps({ sessionResult: { ok: false, reason: "session_revoked" } });
    check("options are gated too", (await handleInboxOptions(auth, deps)).status === 401);
  }

  /* ===================== BOUNDED MAPPING ===================== */
  console.log("\nBOUNDED MAPPING");

  check("a known value maps through", boundedKey(INBOX_PRIORITIES, "urgent", "normal") === "urgent");
  for (const bad of ["URGENT", "", null, undefined, 5, {}, "critical"]) {
    check(`unknown priority ${dump(bad)} falls back safely`, boundedKey(INBOX_PRIORITIES, bad, "normal") === "normal");
  }
  check("an unknown processing state falls back to pending", boundedKey(INBOX_PROCESSING_STATES, "quantum", "pending") === "pending");
  check("a limit state stays truthful (never processed_paid)",
    boundedKey(INBOX_PROCESSING_STATES, "basic_limit_reached", "pending") === "basic_limit_reached");

  /* ===================== SOURCE GUARDS ===================== */
  console.log("\nSOURCE GUARDS");

  {
    const svc = codeOf("apps/web/src/server/mobile-inbox.ts");
    const deps = codeOf("apps/web/src/server/mobile-inbox-deps.ts");

    check("mobile reuses the canonical keyset paginator", deps.includes("listInboxPage"));
    check("mobile reuses the canonical counts", deps.includes("inboxCounts"));
    check("mobile reuses the canonical page size", deps.includes("INBOX_PAGE_SIZE"));
    check("mobile reuses the four canonical mutations",
      ["setInboxRead", "setInboxArchived", "setInboxPriority", "setInboxWorkflowStatus"].every((f) => deps.includes(f)));
    check("mobile reuses the canonical permission", deps.includes("Permission.InboxAct"));
    check("mobile reuses the customer classification projection", deps.includes("projectStoredClassification"));
    check("sentiment is computed from the PROJECTION, not the raw verdict",
      deps.includes("categories: projected.categories") && deps.includes("riskLevel: projected.riskLevel"));
    check("mobile reuses the data-mode brand scoping", deps.includes("getRealModeFilter"));

    check("no offset pagination anywhere", !deps.includes("skip:") && !svc.includes("offset"));
    check("detail does NOT use findUnique", !deps.includes("findUnique"));
    check("detail queries carry an explicit tenantId predicate", deps.includes("where: { id: itemId, tenantId }"));
    check("the service module holds no Prisma access", !svc.includes("prisma") && !svc.includes("db."));
    check("no bulk mutation is reachable from mobile", !deps.includes("bulkInboxAction") && !svc.includes("bulk"));
    check("no provider write is reachable from mobile",
      !deps.includes("platformActionExecute") && !/\breply\b|\bhide\(|\bban\(/.test(deps));
    check("no label/note mutation shipped in M4",
      !deps.includes("addInboxItemLabel") && !deps.includes("addInboxNote") && !deps.includes("assignInboxItem"));
    check("admin AI diagnostics are never selected", !deps.includes("usageEvent") && !deps.includes("providerCall"));
    check("audit select is id/event/createdAt only",
      deps.includes("select: { id: true, event: true, createdAt: true }"));
    check("notes select excludes the author's email", !/inboxNote[\s\S]{0,400}email/.test(deps));

    for (const r of ["route", "[itemId]/route", "[itemId]/action/route", "options/route"]) {
      const src = codeOf(`apps/web/src/app/api/mobile/inbox/${r}.ts`);
      check(`${r} sets no cookie`, !src.includes("cookies"));
      check(`${r} is no-store`, src.includes("no-store"));
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — mobile Inbox API (M4): ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
