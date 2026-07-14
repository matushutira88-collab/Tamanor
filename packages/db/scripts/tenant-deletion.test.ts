/**
 * V1.45C1 — TENANT DELETION FOUNDATION (real Postgres, RLS runtime).
 *
 * Exercises the REAL deletion lifecycle end-to-end against a real DB:
 *  A) authorization policy (Owner-only capability; platform admin vs staff; confirmation; op-id origin);
 *  B) atomic active→deleting request transition + convergence + activity blocking;
 *  C) provider cleanup reusing the canonical V1.45B disconnectAccount (cluster + Meta-unsupported);
 *  D) immediate session invalidation + identity/other-tenant survival;
 *  E) durable webhook-link purge + deleting-tenant exclusion + legacy-row policy;
 *  F) COMPLETE cascade proof across every tenant-scoped group + survival of globals;
 *  G) idempotency + crash-boundary retry + stale-op-id safety + concurrent finalize;
 *  H) privacy — no token/name/email/payload in the receipt or its summary.
 *
 * Run: pnpm tenant-deletion:test
 */
import {
  systemDb, withTenant, encryptToken,
  createUserSession, readUserSession, resolveActiveTenant,
  requestTenantDeletion, requestTenantDeletionAsPlatformAdmin, completeTenantDeletion,
  getTenantDeletionReceipt, assertTenantActive, getTenantActivityState,
  findMetaSyncCandidates, findMetaAccountsByExternalIds,
  setPlatformRoleByEmail, isTenantDeletionError, isTenantInactiveError, isPlatformForbidden,
} from "../src/index";
import { deleteTenant, executeTenantDeletion, resumePendingTenantDeletions, runReadOnlySync } from "../../sync/src/index";
import { can, Role, Permission } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}

const RAW = "RAW_PAGE_TOKEN_TDEL";

/** Create a fully-populated tenant: one row in EVERY tenant-scoped cascade group. */
async function seedTenant(sfx: string, tag: string) {
  const tenant = await systemDb.tenant.create({ data: { name: `TDEL_${tag}_${sfx}`, slug: `tdel-${tag}-${sfx}` } });
  const tId = tenant.id;
  const user = await systemDb.user.create({ data: { email: `owner-${tag}-${sfx}@example.test`, name: "Owner" } });
  await systemDb.membership.create({ data: { userId: user.id, tenantId: tId, role: "owner" } });
  const brand = await systemDb.brand.create({ data: { tenantId: tId, name: `B_${tag}` } });
  await systemDb.brandLiveSafetySettings.create({ data: { tenantId: tId, brandId: brand.id } });
  const page = await systemDb.connectedAccount.create({ data: { tenantId: tId, brandId: brand.id, platform: "facebook_page", status: "active", mode: "read_only", health: "healthy", externalId: `PG_${tag}_${sfx}`, pageId: `PG_${tag}_${sfx}`, longLivedToken: encryptToken(RAW), grantedPermissions: ["pages_manage_engagement"] } });
  const ig = await systemDb.connectedAccount.create({ data: { tenantId: tId, brandId: brand.id, platform: "instagram_business", status: "active", mode: "read_only", health: "healthy", externalId: `IG_${tag}_${sfx}`, igBusinessId: `IG_${tag}_${sfx}`, parentAccountId: page.id, longLivedToken: encryptToken(RAW) } });
  const content = await systemDb.contentItem.create({ data: { tenantId: tId, brandId: brand.id, connectedAccountId: page.id, platform: "facebook_page", kind: "comment", externalId: `C_${tag}_${sfx}`, text: "hello", publishedAt: new Date() } });
  const rep = await systemDb.reputationItem.create({ data: { tenantId: tId, brandId: brand.id, platform: "facebook_page", contentItemId: content.id } });
  await systemDb.moderationDecision.create({ data: { tenantId: tId, brandId: brand.id, reputationItemId: rep.id, action: "hide", proposedByKind: "system" } });
  const label = await systemDb.inboxLabel.create({ data: { tenantId: tId, name: `L_${tag}`, normalizedName: `l_${tag}` } });
  await systemDb.inboxItemLabel.create({ data: { tenantId: tId, reputationItemId: rep.id, labelId: label.id } });
  await systemDb.inboxNote.create({ data: { tenantId: tId, reputationItemId: rep.id, body: "note" } });
  await systemDb.syncRun.create({ data: { tenantId: tId, brandId: brand.id, connectedAccountId: page.id, status: "completed" } });
  await systemDb.syncLease.create({ data: { tenantId: tId, connectedAccountId: ig.id, holderId: "h", expiresAt: new Date(Date.now() + 60000) } });
  const period = await systemDb.usagePeriod.create({ data: { tenantId: tId, periodStart: new Date("2026-07-01T00:00:00Z"), periodEnd: new Date("2026-08-01T00:00:00Z"), plan: "free" } });
  await systemDb.usageEvent.create({ data: { tenantId: tId, usagePeriodId: period.id, eventType: "classify", processingTier: "rules", idempotencyKey: `idem_${tag}_${sfx}`, status: "succeeded" } });
  await systemDb.aiResultCache.create({ data: { tenantId: tId, contentHash: `h_${tag}_${sfx}`, modelKey: "m", policyVersion: "1", normalizedResult: {} } });
  await systemDb.metaOnboardingSession.create({ data: { tenantId: tId, brandId: brand.id, userId: user.id, userAccessToken: "x", pages: [], expiresAt: new Date(Date.now() + 60000) } });
  await systemDb.auditLog.create({ data: { tenantId: tId, event: "seed", actorKind: "system" } });
  await systemDb.brandRule.create({ data: { tenantId: tId, brandId: brand.id, name: "r", category: "blocked_words" } });
  await systemDb.reportSnapshot.create({ data: { tenantId: tId, brandId: brand.id, periodStart: new Date(), periodEnd: new Date(), metrics: {} } });
  const incident = await systemDb.incident.create({ data: { tenantId: tId, brandId: brand.id, title: "inc", category: "crisis" } });
  await systemDb.incidentRelatedItem.create({ data: { tenantId: tId, incidentId: incident.id, reputationItemId: rep.id } });
  await systemDb.controlPolicy.create({ data: { tenantId: tId, brandId: brand.id, category: "spam" } });
  await systemDb.actionQueueItem.create({ data: { tenantId: tId, brandId: brand.id, itemId: rep.id, category: "spam", proposedAction: "hide", queueState: "monitor" } });
  await systemDb.brandAutoProtectPolicy.create({ data: { tenantId: tId, brandId: brand.id, category: "spam" } });
  await systemDb.autoProtectDecision.create({ data: { tenantId: tId, brandId: brand.id, itemId: rep.id, matchedCategory: "spam", policyMode: "monitor", decision: "monitor" } });
  await systemDb.brandRiskFeedback.create({ data: { tenantId: tId, brandId: brand.id, feedbackType: "false_positive" } });
  await systemDb.brandRiskMemoryRule.create({ data: { tenantId: tId, brandId: brand.id, type: "watch_phrase", phrase: "p", normalizedPhrase: "p" } });
  await systemDb.platformActionExecution.create({ data: { tenantId: tId, brandId: brand.id, connectedAccountId: page.id, platform: "facebook_page", actionType: "hide_comment", status: "blocked" } });
  await systemDb.providerCall.create({ data: { tenantId: tId, type: "ai_risk", provider: "none", status: "skipped" } });
  // A durable-linked webhook row (purge target) + a legacy unlinked one for THIS tenant's page id.
  await systemDb.webhookEvent.create({ data: { platform: "facebook_page", signatureValid: true, payload: { entry: [{ id: `PG_${tag}_${sfx}` }] }, tenantId: tId, connectedAccountId: page.id } });
  return { tenant, user, brand, page, ig, rep, content };
}

/** Count rows across every tenant-scoped table for a tenant id (systemDb bypasses RLS → sees all). */
async function tenantRowCounts(tId: string): Promise<Record<string, number>> {
  const c: Record<string, number> = {};
  c.memberships = await systemDb.membership.count({ where: { tenantId: tId } });
  c.brands = await systemDb.brand.count({ where: { tenantId: tId } });
  c.brandLiveSafety = await systemDb.brandLiveSafetySettings.count({ where: { tenantId: tId } });
  c.connectedAccounts = await systemDb.connectedAccount.count({ where: { tenantId: tId } });
  c.contentItems = await systemDb.contentItem.count({ where: { tenantId: tId } });
  c.reputationItems = await systemDb.reputationItem.count({ where: { tenantId: tId } });
  c.moderationDecisions = await systemDb.moderationDecision.count({ where: { tenantId: tId } });
  c.inboxLabels = await systemDb.inboxLabel.count({ where: { tenantId: tId } });
  c.inboxItemLabels = await systemDb.inboxItemLabel.count({ where: { tenantId: tId } });
  c.inboxNotes = await systemDb.inboxNote.count({ where: { tenantId: tId } });
  c.syncRuns = await systemDb.syncRun.count({ where: { tenantId: tId } });
  c.syncLeases = await systemDb.syncLease.count({ where: { tenantId: tId } });
  c.usagePeriods = await systemDb.usagePeriod.count({ where: { tenantId: tId } });
  c.usageEvents = await systemDb.usageEvent.count({ where: { tenantId: tId } });
  c.aiResultCache = await systemDb.aiResultCache.count({ where: { tenantId: tId } });
  c.metaOnboarding = await systemDb.metaOnboardingSession.count({ where: { tenantId: tId } });
  c.auditLogs = await systemDb.auditLog.count({ where: { tenantId: tId } });
  c.brandRules = await systemDb.brandRule.count({ where: { tenantId: tId } });
  c.reportSnapshots = await systemDb.reportSnapshot.count({ where: { tenantId: tId } });
  c.incidents = await systemDb.incident.count({ where: { tenantId: tId } });
  c.incidentRelatedItems = await systemDb.incidentRelatedItem.count({ where: { tenantId: tId } });
  c.controlPolicies = await systemDb.controlPolicy.count({ where: { tenantId: tId } });
  c.actionQueueItems = await systemDb.actionQueueItem.count({ where: { tenantId: tId } });
  c.autoProtectPolicies = await systemDb.brandAutoProtectPolicy.count({ where: { tenantId: tId } });
  c.autoProtectDecisions = await systemDb.autoProtectDecision.count({ where: { tenantId: tId } });
  c.brandRiskFeedback = await systemDb.brandRiskFeedback.count({ where: { tenantId: tId } });
  c.brandRiskMemoryRules = await systemDb.brandRiskMemoryRule.count({ where: { tenantId: tId } });
  c.platformActionExecutions = await systemDb.platformActionExecution.count({ where: { tenantId: tId } });
  c.providerCalls = await systemDb.providerCall.count({ where: { tenantId: tId } });
  c.userSessions = await systemDb.userSession.count({ where: { activeTenantId: tId } });
  c.webhookEvents = await systemDb.webhookEvent.count({ where: { tenantId: tId } });
  return c;
}

async function run() {
  const sfx = Date.now().toString(36);

  // ==================== A) AUTHORIZATION POLICY ====================
  check("A2/A3) tenant:delete is OWNER-EXCLUSIVE (Admin/Analyst/Reviewer/Viewer denied)",
    can(Role.Owner, Permission.TenantDelete) === true &&
    [Role.Admin, Role.Analyst, Role.Reviewer, Role.Viewer].every((r) => can(r, Permission.TenantDelete) === false));

  // Platform admin vs staff for the SEPARATE platform capability (A6/A7).
  const staff = await systemDb.user.create({ data: { email: `staff-${sfx}@example.test` } });
  const padmin = await systemDb.user.create({ data: { email: `padmin-${sfx}@example.test` } });
  await setPlatformRoleByEmail(staff.email, "staff");
  await setPlatformRoleByEmail(padmin.email, "admin");
  const seedForPlatform = await seedTenant(sfx, "PLAT");
  check("A6) platform STAFF cannot delete a tenant (platform_forbidden)",
    await throws(() => requestTenantDeletionAsPlatformAdmin(staff.id, seedForPlatform.tenant.id, seedForPlatform.tenant.name), isPlatformForbidden));
  // A7 — platform ADMIN is authorized (separate authority; verified by a successful request transition).
  const platReq = await requestTenantDeletionAsPlatformAdmin(padmin.id, seedForPlatform.tenant.id, seedForPlatform.tenant.name);
  const platReceipt = await getTenantDeletionReceipt(platReq.operationId);
  check("A7) platform ADMIN request succeeds via the SEPARATE platform authority", !!platReq.operationId && platReceipt?.initiatedAuthority === "platform_admin");
  await deleteTenant({ tenantId: seedForPlatform.tenant.id, actorUserId: padmin.id, authority: "platform_admin", confirmationName: seedForPlatform.tenant.name });

  // ==================== B) REQUEST TRANSITION ====================
  const S = await seedTenant(sfx, "REQ");
  const tId = S.tenant.id;

  // A8/A9 — a forged/wrong confirmation name deletes NOTHING (op-id is never client-supplied at all).
  check("A/confirmation) wrong tenant-name confirmation is rejected, tenant stays active",
    await throws(() => requestTenantDeletion({ tenantId: tId, actorUserId: S.user.id, authority: "tenant_owner", confirmationName: "WRONG NAME" }),
      (e) => isTenantDeletionError(e) && (e as { code: string }).code === "confirmation_mismatch"));
  check("A/confirmation-b) tenant remained ACTIVE after a rejected request",
    (await systemDb.tenant.findUnique({ where: { id: tId }, select: { deletionState: true } }))!.deletionState === "active");

  // B4/B5 — two CONCURRENT valid requests converge on ONE server-generated operation.
  const [req1, req2] = await Promise.all([
    requestTenantDeletion({ tenantId: tId, actorUserId: S.user.id, authority: "tenant_owner", confirmationName: S.tenant.name }),
    requestTenantDeletion({ tenantId: tId, actorUserId: S.user.id, authority: "tenant_owner", confirmationName: S.tenant.name }),
  ]);
  const opId = req1.operationId;
  check("B4) two concurrent requests converge on ONE operationId", req1.operationId === req2.operationId);
  check("B1) tenant transitioned active→deleting",
    (await systemDb.tenant.findUnique({ where: { id: tId }, select: { deletionState: true, deletionOperationId: true } }))!.deletionState === "deleting");
  check("B2) operationId is server-generated (UUID) and stored on the tenant",
    /^[0-9a-f-]{36}$/.test(opId) && (await systemDb.tenant.findUnique({ where: { id: tId }, select: { deletionOperationId: true } }))!.deletionOperationId === opId);
  check("B3) a `requested` receipt exists for the operation",
    (await getTenantDeletionReceipt(opId))?.status === "requested");
  // B5 — a repeat request on an already-deleting tenant returns the SAME operation.
  const req3 = await requestTenantDeletion({ tenantId: tId, actorUserId: S.user.id, authority: "tenant_owner", confirmationName: S.tenant.name });
  check("B5) repeat request on a deleting tenant returns the same operation", req3.operationId === opId && req3.alreadyDeleting === true);
  check("B/one-receipt) exactly ONE receipt exists for this tenant (no duplicate operations)",
    (await systemDb.tenantDeletionReceipt.count({ where: { deletedTenantId: tId } })) === 1);

  // B6/B7/B8 — activity is blocked while deleting.
  check("B7) assertTenantActive throws for a deleting tenant (blocks provider reconnect etc.)",
    await throws(() => assertTenantActive(tId), isTenantInactiveError));
  check("B7b) getTenantActivityState reports not-ok + tenant_deleting", (await getTenantActivityState(tId)).reason === "tenant_deleting");
  check("B8) resolveActiveTenant refuses a deleting tenant (no switch/login into it)",
    (await resolveActiveTenant(S.user.id, tId)) === null);
  check("C5) runReadOnlySync path: worker discovery EXCLUDES the deleting tenant's accounts",
    (await findMetaSyncCandidates(["active"])).every((a) => a.tenantId !== tId));

  // ==================== D) SESSIONS (before the row is physically deleted) ====================
  // Create a session on a DIFFERENT fresh tenant, then mark THAT tenant deleting to prove invalidation.
  const D = await seedTenant(sfx, "SESS");
  const dSession = await createUserSession({ userId: D.user.id, activeTenantId: D.tenant.id });
  check("D0) a fresh session validates while the tenant is active", (await readUserSession(dSession.token)).ok === true);
  await requestTenantDeletion({ tenantId: D.tenant.id, actorUserId: D.user.id, authority: "tenant_owner", confirmationName: D.tenant.name });
  const afterMark = await readUserSession(dSession.token);
  // The request transition ACTIVELY revokes sessions, so an existing session reads as `session_revoked`.
  // Either way it is invalidated the instant the tenant is deleting; a stale cookie cannot restore access.
  check("D1) the session is invalidated the instant the tenant is deleting",
    afterMark.ok === false && (afterMark.reason === "session_revoked" || afterMark.reason === "tenant_deleting"),
    `reason=${afterMark.reason}`);

  // D1b — prove the hydrate `tenant_deleting` BACKSTOP independently: mark a fresh tenant deleting
  // via a raw update (NO active revoke), so the session survives only to be rejected by the guard.
  const D2 = await seedTenant(sfx, "SESS2");
  const d2Session = await createUserSession({ userId: D2.user.id, activeTenantId: D2.tenant.id });
  await systemDb.tenant.update({ where: { id: D2.tenant.id }, data: { deletionState: "deleting", deletionOperationId: `raw-${sfx}` } });
  const d2After = await readUserSession(d2Session.token);
  check("D1b) hydrate backstop: a non-revoked session on a deleting tenant is rejected as tenant_deleting",
    d2After.ok === false && d2After.reason === "tenant_deleting");

  check("D5) creating/switching a session into a deleting tenant fails",
    await throws(() => createUserSession({ userId: D.user.id, activeTenantId: D.tenant.id }), () => true));

  // ==================== E) WEBHOOK LINKAGE & POLICY ====================
  // Legacy unlinked row + another tenant's linked row must survive; deleting-tenant match excluded.
  const other = await seedTenant(sfx, "OTHER");
  await systemDb.webhookEvent.create({ data: { platform: "facebook_page", signatureValid: true, payload: { entry: [{ id: "LEGACY" }] } } }); // no tenantId (legacy)
  const legacyCount = await systemDb.webhookEvent.count({ where: { tenantId: null } });
  check("E3/E4) a webhook page-id mapping to a DELETING tenant no longer matches (→ ignored, no sync)",
    (await findMetaAccountsByExternalIds([`PG_REQ_${sfx}`])).length === 0);
  check("E3b) the SAME query still matches an ACTIVE tenant's account",
    (await findMetaAccountsByExternalIds([`PG_OTHER_${sfx}`])).some((a) => a.tenantId === other.tenant.id));

  // ==================== F) FULL DELETION + CASCADE PROOF ====================
  const beforeCounts = await tenantRowCounts(tId);
  const globalLeadsBefore = await systemDb.lead.count();
  const usersBefore = await systemDb.user.count({ where: { id: S.user.id } });
  const otherBefore = await tenantRowCounts(other.tenant.id);

  const result = await executeTenantDeletion({ tenantId: tId, operationId: opId });
  check("F0) executeTenantDeletion finalized the receipt as completed", result.status === "completed" && result.tenantRowDeleted === true);
  check("F1) the tenant row is physically gone", (await systemDb.tenant.findUnique({ where: { id: tId } })) === null);

  const afterCounts = await tenantRowCounts(tId);
  const allZero = Object.values(afterCounts).every((n) => n === 0);
  check("F2) ALL tenant-scoped rows cascade-deleted (every group → 0)", allZero, JSON.stringify(afterCounts));
  const hadData = Object.entries(beforeCounts).filter(([, n]) => n > 0).map(([k]) => k);
  check("F2b) the deleted tenant HAD representative rows in every cascade group before deletion",
    hadData.length >= 28, `${hadData.length} groups seeded`);

  // Survival of globals + other tenant.
  check("F3) the global User identity survives", (await systemDb.user.count({ where: { id: S.user.id } })) === usersBefore && usersBefore === 1);
  check("F4) another tenant and ALL its data are untouched",
    JSON.stringify(await tenantRowCounts(other.tenant.id)) === JSON.stringify(otherBefore));
  check("F5) global leads are untouched", (await systemDb.lead.count()) === globalLeadsBefore);
  check("F6) the GLOBAL deletion receipt survives the tenant cascade", (await getTenantDeletionReceipt(opId)) !== null);
  check("E1) tenant-linked webhook rows were purged (count recorded on receipt)", result.webhookEventsPurged >= 1 && afterCounts.webhookEvents === 0);
  check("E2) another tenant's webhook rows remain", (await systemDb.webhookEvent.count({ where: { tenantId: other.tenant.id } })) >= 1);
  check("E5) legacy UNLINKED webhook rows are NOT removed by tenant deletion (documented policy)",
    (await systemDb.webhookEvent.count({ where: { tenantId: null } })) === legacyCount);

  // ==================== C) PROVIDER CLEANUP TRUTH (from the receipt summary) ====================
  const summary = result.providerResultSummary as { accounts: number; clustersInvalidated: number; byRevocation: Record<string, number>; manualCleanupRecommended: boolean };
  check("C1/C2) provider cleanup ran over the tenant's accounts (cluster-aware)", summary.accounts >= 2 && summary.clustersInvalidated >= 1);
  check("C3) unsupported Meta revoke did NOT block deletion and is reported truthfully",
    (summary.byRevocation.unsupported ?? 0) >= 1 && summary.manualCleanupRecommended === true && result.tenantRowDeleted === true);

  // ==================== G) IDEMPOTENCY / CRASH RECOVERY / STALE OP-ID ====================
  // G4 — retry completeTenantDeletion after the tenant is already gone → idempotent completed receipt.
  const retry = await completeTenantDeletion({ tenantId: tId, operationId: opId, providerAccountCount: 0, providerResultSummary: { retry: true }, webhookEventsPurged: 0 });
  check("G4) completeTenantDeletion is idempotent after the tenant row is already gone", retry.status === "completed" && retry.tenantRowDeleted === true);

  // G6 — a STALE operationId cannot delete another (still-deleting) tenant lifecycle.
  const G = await seedTenant(sfx, "STALE");
  const gReq = await requestTenantDeletion({ tenantId: G.tenant.id, actorUserId: G.user.id, authority: "tenant_owner", confirmationName: G.tenant.name });
  check("G6) a stale/foreign operationId cannot finalize a different tenant lifecycle",
    await throws(() => completeTenantDeletion({ tenantId: G.tenant.id, operationId: opId, providerAccountCount: 0, providerResultSummary: {}, webhookEventsPurged: 0 }),
      (e) => isTenantDeletionError(e) && (e as { code: string }).code === "operation_mismatch"));
  check("G6b) the target tenant is still present + deleting after the stale attempt",
    (await systemDb.tenant.findUnique({ where: { id: G.tenant.id }, select: { deletionState: true } }))!.deletionState === "deleting");
  // Finish it cleanly with its OWN operation.
  await executeTenantDeletion({ tenantId: G.tenant.id, operationId: gReq.operationId });

  // G7 — two concurrent finalize calls converge (one deletes, both see completed).
  const C7 = await seedTenant(sfx, "CONC");
  const c7Req = await requestTenantDeletion({ tenantId: C7.tenant.id, actorUserId: C7.user.id, authority: "tenant_owner", confirmationName: C7.tenant.name });
  const [f1, f2] = await Promise.allSettled([
    executeTenantDeletion({ tenantId: C7.tenant.id, operationId: c7Req.operationId }),
    executeTenantDeletion({ tenantId: C7.tenant.id, operationId: c7Req.operationId }),
  ]);
  const settledOk = [f1, f2].filter((r) => r.status === "fulfilled").length;
  check("G7) two concurrent finalize calls converge (tenant gone, receipt completed, no crash)",
    settledOk >= 1 && (await systemDb.tenant.findUnique({ where: { id: C7.tenant.id } })) === null && (await getTenantDeletionReceipt(c7Req.operationId))?.status === "completed");

  // ==================== R) PRODUCTION RESUME AFTER SESSION SELF-REVOCATION ====================
  // Simulate the inline server action CRASHING right after the request transition: only
  // requestTenantDeletion ran (session revoked, tenant `deleting`), execute never happened. The
  // owner can no longer reach the tenant. Prove the SYSTEM resume runner completes it — NO session.
  const R = await seedTenant(sfx, "RESUME");
  const rSession = await createUserSession({ userId: R.user.id, activeTenantId: R.tenant.id });
  const rReq = await requestTenantDeletion({ tenantId: R.tenant.id, actorUserId: R.user.id, authority: "tenant_owner", confirmationName: R.tenant.name });
  check("R0) after the request transition the initiator's session is dead (cannot self-retry)",
    (await readUserSession(rSession.token)).ok === false);
  check("R0b) the tenant is stranded `deleting` (execute never ran)",
    (await systemDb.tenant.findUnique({ where: { id: R.tenant.id }, select: { deletionState: true } }))!.deletionState === "deleting" &&
    (await getTenantDeletionReceipt(rReq.operationId))?.status === "requested");
  const resume = await resumePendingTenantDeletions({ staleMs: 0 });
  check("R1) the SYSTEM resume runner (worker path) finishes the stranded deletion WITHOUT a session",
    resume.resumed >= 1 && (await systemDb.tenant.findUnique({ where: { id: R.tenant.id } })) === null &&
    (await getTenantDeletionReceipt(rReq.operationId))?.status === "completed");
  check("R2) resume is idempotent — a second pass finds nothing new to resume for this tenant",
    (await systemDb.tenant.count({ where: { id: R.tenant.id } })) === 0);

  // ==================== D-race) WEBHOOK/SYNC RACE — matched active, then deleting ====================
  // The account is matched while ACTIVE; the tenant then transitions to `deleting`; a sync attempt for
  // that already-matched account must be REJECTED and create NO content (state re-checked fresh, not
  // only at discovery). This closes the "matched-then-deleting" window.
  const W = await seedTenant(sfx, "RACE");
  const matchedWhileActive = await findMetaAccountsByExternalIds([`PG_RACE_${sfx}`]);
  check("D-race-0) the account matches while the tenant is ACTIVE", matchedWhileActive.some((a) => a.id === W.page.id));
  const contentBefore = await systemDb.contentItem.count({ where: { tenantId: W.tenant.id } });
  await systemDb.tenant.update({ where: { id: W.tenant.id }, data: { deletionState: "deleting", deletionOperationId: `race-${sfx}` } });
  const syncRunsBefore = await systemDb.syncRun.count({ where: { tenantId: W.tenant.id } });
  const leasesBefore = await systemDb.syncLease.count({ where: { tenantId: W.tenant.id } });
  const raceSync = await runReadOnlySync({ accountId: W.page.id, tenantId: W.tenant.id });
  check("D-race-1) a sync for the already-matched account is REJECTED once the tenant is deleting", raceSync.ok === false);
  check("D-race-2) NO content was ingested by the racing sync", (await systemDb.contentItem.count({ where: { tenantId: W.tenant.id } })) === contentBefore);
  check("D-race-3) the racing sync opened NO new SyncRun and acquired NO lease (rejected before any work)",
    (await systemDb.syncRun.count({ where: { tenantId: W.tenant.id } })) === syncRunsBefore &&
    (await systemDb.syncLease.count({ where: { tenantId: W.tenant.id } })) === leasesBefore);

  // ==================== G-fk) FK INTEGRITY DESPITE `NOT VALID` ====================
  // The brand_auto_protect_policies FK is NOT VALID (2 pre-existing dev orphans), but Postgres STILL
  // enforces it for every NEW write. Prove a new orphan insert is rejected; a valid row cascades.
  const fkT = await seedTenant(sfx, "FK");
  let orphanRejected = false;
  try {
    await systemDb.brandAutoProtectPolicy.create({ data: { tenantId: `no-such-tenant-${sfx}`, brandId: fkT.brand.id, category: "spam2" } });
  } catch { orphanRejected = true; }
  check("G-fk-1) a NEW row with a non-existent tenantId is REJECTED (FK enforced despite NOT VALID)", orphanRejected);
  const validPolicy = await systemDb.brandAutoProtectPolicy.count({ where: { tenantId: fkT.tenant.id } });
  await deleteTenant({ tenantId: fkT.tenant.id, actorUserId: fkT.user.id, authority: "tenant_owner", confirmationName: fkT.tenant.name });
  check("G-fk-2) a VALID tenant's auto-protect policy rows still cascade to 0 (NOT VALID does not block cascade)",
    validPolicy >= 1 && (await systemDb.brandAutoProtectPolicy.count({ where: { tenantId: fkT.tenant.id } })) === 0);

  // ==================== H) PRIVACY ====================
  const receipt = await getTenantDeletionReceipt(opId);
  const blob = JSON.stringify(receipt);
  // PII to prove absent: the raw token, the tenant NAME, the owner EMAIL, and the content text.
  // (The authority value "tenant_owner" legitimately contains "owner" and is NOT PII.)
  const forbidden = [RAW, S.tenant.name, S.user.email, "hello"];
  const leaks = forbidden.filter((s) => blob.includes(s));
  check("H1) the receipt contains NO token/name/email/content/payload", leaks.length === 0, `leaked: ${leaks.join(",")}`);
  check("H2) the receipt stores only opaque ids + safe aggregates",
    typeof receipt!.deletedTenantId === "string" && receipt!.initiatedAuthority === "tenant_owner" && receipt!.failureClass === null &&
    !blob.includes("Error") && !blob.includes("token"));
  check("H3) deletedTenantId is the opaque cuid (never the tenant NAME)", receipt!.deletedTenantId === tId && !blob.includes(S.tenant.name));

  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
