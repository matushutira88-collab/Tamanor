/**
 * Child Safety Analytics & Trends V1 (local DB). Proves the READ-ONLY operational analytics layer over
 * the accepted canonical domain: role-gated view + export, tenant isolation, k-anonymity SUPPRESSION
 * (incl. reconstruction-safe secondary suppression), overview counts, zero-filled distributions, complete
 * time-series buckets (day/week/month; missing == zero), median performance, per-reviewer workload
 * (never ranked/scored), protection-plan + guardian-delivery analytics, and a content-free CSV export
 * (aggregated metrics only — no ids / users / guardian / notes / messages / evidence / storage keys).
 * Run: pnpm child-safety-analytics:test
 */
import {
  systemDb,
  getChildSafetyAnalyticsReport, exportChildSafetyAnalyticsCsv, buildAnalyticsCsvRows,
  ChildSafetyAnalyticsForbiddenError, type AnalyticsActor,
} from "@guardora/db";
import { Role, WorkspaceKind, AnalyticsGranularity } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throwsForbidden(l: string, fn: () => Promise<unknown> | unknown) {
  try { await fn(); check(l, false, "did not throw"); }
  catch (e) { check(l, e instanceof ChildSafetyAnalyticsForbiddenError, `wrong error: ${(e as Error)?.message}`); }
}

const sfx = `csan_${process.pid}`;
const tids: string[] = [];
let k = 0;
const actor = (tenantId: string, userId: string, role: Role): AnalyticsActor => ({ tenantId, userId, role });

const DAY = 86_400_000, HOUR = 3_600_000;
const BASE = new Date("2026-06-15T12:00:00.000Z");
const NOW = new Date(BASE.getTime() + HOUR);
const FROM = new Date(BASE.getTime() - 30 * DAY);
const TO = BASE;

async function seedTenant() {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const profileId = (await systemDb.protectedProfile.create({ data: { tenantId: id, ageBand: "age_10_12", protectionStatus: "active" } })).id;
  return { tenantId: id, profileId };
}

async function mkIncident(tenantId: string, profileId: string, opts: {
  severity: string; urgency?: string; status: string; riskFamily?: string;
  createdAt: Date; closedAt?: Date | null; assignedReviewerId?: string | null; escalationState?: string;
  reviewAt?: Date | null; reviewerId?: string;
}): Promise<string> {
  const inc = await systemDb.childSafetyIncident.create({ data: {
    tenantId, protectedProfileId: profileId, status: opts.status, riskFamily: opts.riskFamily ?? "grooming",
    severity: opts.severity, urgency: opts.urgency ?? "elevated", escalationState: opts.escalationState ?? "none",
    openedAt: opts.createdAt, lastSignalAt: opts.createdAt, createdAt: opts.createdAt,
    closedAt: opts.closedAt ?? null, assignedReviewerId: opts.assignedReviewerId ?? null,
  } });
  if (opts.reviewAt && opts.reviewerId) {
    await systemDb.childSafetyReviewEvent.create({ data: { tenantId, incidentId: inc.id, eventType: "assigned", actorUserId: opts.reviewerId, toValue: opts.reviewerId, createdAt: opts.reviewAt } });
  }
  return inc.id;
}

async function mkDelivery(tenantId: string, profileId: string, outcome: string, i: number) {
  const sig = await systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: "GROOMING", severity: "high", sourceType: "platform_partner", confidenceBand: "high", createdAt: new Date(BASE.getTime() - DAY) } });
  const dec = await systemDb.safetyRecipientAuthorizationDecision.create({ data: { tenantId, safetySignalId: sig.id, protectedProfileId: profileId, recipientMembershipId: `m_${i}_${tenantId}`, decisionStatus: "pending", reasonCode: "authorized_guardian" } });
  await systemDb.safetySignalDelivery.create({ data: {
    tenantId, safetySignalId: sig.id, protectedProfileId: profileId, recipientAuthorizationDecisionId: dec.id,
    recipientMembershipId: `m_${i}_${tenantId}`, disclosureScope: "summary", signalType: "GROOMING", severity: "high",
    idempotencyKey: `idem_${i}_${tenantId}`, deliveryStatus: outcome, preparedAt: new Date(BASE.getTime() - DAY),
  } });
}

async function seedRichTenant() {
  const { tenantId, profileId } = await seedTenant();
  const R1 = `rev1_${tenantId}`, R2 = `rev2_${tenantId}`;
  // 6 resolved (severity high): 0..4 → R1, 5 → R2. openedAt spread over days; +1h first review; +2h resolved.
  for (let i = 0; i < 6; i++) {
    const opened = new Date(BASE.getTime() - (i + 1) * DAY);
    await mkIncident(tenantId, profileId, {
      severity: "high", status: "resolved", createdAt: opened, closedAt: new Date(opened.getTime() + 2 * HOUR),
      assignedReviewerId: i < 5 ? R1 : R2, reviewAt: new Date(opened.getTime() + HOUR), reviewerId: i < 5 ? R1 : R2,
    });
  }
  // 5 open medium + 1 open critical (drives severity suppression: critical=1 primary-hidden, medium=5 secondary-hidden).
  for (let i = 0; i < 5; i++) await mkIncident(tenantId, profileId, { severity: "medium", status: "open", createdAt: new Date(BASE.getTime() - (i + 7) * DAY) });
  const criticalIncident = await mkIncident(tenantId, profileId, { severity: "critical", status: "open", createdAt: new Date(BASE.getTime() - 13 * DAY), escalationState: "escalated" });

  // 5 escalations (triggered) on the critical incident + earlier ones.
  const escIncidents = [criticalIncident];
  for (let i = 0; i < 4; i++) escIncidents.push(await mkIncident(tenantId, profileId, { severity: "high", status: "monitoring", createdAt: new Date(BASE.getTime() - (i + 2) * DAY) }));
  for (let i = 0; i < escIncidents.length; i++) {
    await systemDb.childSafetyEscalation.create({ data: { tenantId, incidentId: escIncidents[i]!, escalationType: "urgent_internal", status: "triggered", urgency: "immediate", reasonCode: "sextortion", triggeredAt: new Date(BASE.getTime() - (i + 1) * DAY) } });
  }

  // 6 completed protection plans (activated→completed = 3h) on 6 incidents; 1 plan holds the actions.
  let actionPlanId = "";
  for (let i = 0; i < 6; i++) {
    const planInc = await mkIncident(tenantId, profileId, { severity: "high", status: "resolved", createdAt: new Date(BASE.getTime() - (i + 1) * DAY), closedAt: new Date(BASE.getTime() - (i + 1) * DAY + 2 * HOUR) });
    const activatedAt = new Date(BASE.getTime() - (i + 1) * DAY);
    const plan = await systemDb.childSafetyProtectionPlan.create({ data: { tenantId, incidentId: planInc, status: "completed", priority: "normal", createdBy: R1, activatedAt, completedAt: new Date(activatedAt.getTime() + 3 * HOUR), createdAt: activatedAt } });
    if (i === 0) actionPlanId = plan.id;
  }
  // Actions: 5 in_progress (assigned R1, overdue) + 5 blocked (unassigned, not overdue).
  let seq = 0;
  for (let i = 0; i < 5; i++) await systemDb.childSafetyProtectionAction.create({ data: { tenantId, planId: actionPlanId, actionType: "follow_up_review", title: "x", status: "in_progress", priority: "normal", sequence: seq++, createdBy: R1, assignedReviewerId: R1, dueAt: new Date(BASE.getTime() - 3 * DAY), createdAt: new Date(BASE.getTime() - 4 * DAY) } });
  for (let i = 0; i < 5; i++) await systemDb.childSafetyProtectionAction.create({ data: { tenantId, planId: actionPlanId, actionType: "follow_up_review", title: "x", status: "blocked", priority: "normal", sequence: seq++, createdBy: R1, dueAt: null, createdAt: new Date(BASE.getTime() - 4 * DAY) } });

  // 3 evidence items.
  const evInc = escIncidents[0]!;
  for (let i = 0; i < 3; i++) await systemDb.childSafetyEvidence.create({ data: { tenantId, incidentId: evInc, evidenceType: "manual", sourceType: "system", contentHash: `h${i}_${tenantId}`, chainPosition: i + 1, bodyText: "x", createdAt: new Date(BASE.getTime() - 2 * DAY) } });

  // 4 interventions.
  for (let i = 0; i < 4; i++) {
    const sig = await systemDb.safetySignal.create({ data: { tenantId, protectedProfileId: profileId, signalType: "GROOMING", severity: "high", sourceType: "platform_partner", confidenceBand: "high", createdAt: new Date(BASE.getTime() - 2 * DAY) } });
    await systemDb.childSafetyIntervention.create({ data: { tenantId, safetySignalId: sig.id, protectedProfileId: profileId, outcome: "CREATE_OR_UPDATE_INCIDENT", correlationKey: `k${i}`, severity: "high", urgency: "elevated", createdAt: new Date(BASE.getTime() - 2 * DAY) } });
  }

  // 6 guardian deliveries in the "prepared" outcome (initial lifecycle state; no companion-field constraint).
  for (let i = 0; i < 6; i++) await mkDelivery(tenantId, profileId, "prepared", i);

  return { tenantId, profileId, R1, R2 };
}

async function main() {
  const A = await seedRichTenant();
  const input = { from: FROM, to: TO, now: NOW, granularity: AnalyticsGranularity.Day };
  const owner = actor(A.tenantId, "owner", Role.Owner);
  const admin = actor(A.tenantId, "admin", Role.Admin);
  const reviewer = actor(A.tenantId, "reviewer", Role.Reviewer);
  const analyst = actor(A.tenantId, "analyst", Role.Analyst);
  const viewer = actor(A.tenantId, "viewer", Role.Viewer);

  // ── A. AUTHORIZATION ──────────────────────────────────────────────
  console.log("\nA. authorization");
  check("★ Owner may view", !!(await getChildSafetyAnalyticsReport(owner, input)).overview);
  check("★ Admin may view", !!(await getChildSafetyAnalyticsReport(admin, input)).overview);
  check("★ Reviewer may view", !!(await getChildSafetyAnalyticsReport(reviewer, input)).overview);
  await throwsForbidden("★ Analyst may NOT view", () => getChildSafetyAnalyticsReport(analyst, input));
  await throwsForbidden("★ Viewer may NOT view", () => getChildSafetyAnalyticsReport(viewer, input));

  const report = await getChildSafetyAnalyticsReport(owner, input);

  // ── B. EXPORT PERMISSION (Owner/Admin only; Reviewer view-only) ────
  console.log("\nB. export permission");
  check("★ Owner may export", !!exportChildSafetyAnalyticsCsv(owner, report).csv);
  check("★ Admin may export", !!exportChildSafetyAnalyticsCsv(admin, report).csv);
  await throwsForbidden("★ Reviewer may NOT export (view-only)", () => exportChildSafetyAnalyticsCsv(reviewer, report));

  // ── C. OVERVIEW ───────────────────────────────────────────────────
  console.log("\nC. overview");
  const o = report.overview;
  // Seeded incidents: 6 resolved + 5 open-medium + 1 open-critical + 4 monitoring (escalation) + 6 resolved (plan) = 22.
  check("★ incidentsCreated = 22", o.incidentsCreated === 22, `${o.incidentsCreated}`);
  check("★ incidentsResolved = 12", o.incidentsResolved === 12, `${o.incidentsResolved}`);
  check("★ openIncidents = 10 (6 open + 4 monitoring)", o.openIncidents === 10, `${o.openIncidents}`);
  check("★ escalations = 5, activeEscalations = 5", o.escalations === 5 && o.activeEscalations === 5, `${o.escalations}/${o.activeEscalations}`);
  check("★ completedProtectionPlans = 6, active = 0", o.completedProtectionPlans === 6 && o.activeProtectionPlans === 0, `${o.completedProtectionPlans}/${o.activeProtectionPlans}`);
  check("★ overdueActions = 5, blockedActions = 5", o.overdueActions === 5 && o.blockedActions === 5, `${o.overdueActions}/${o.blockedActions}`);
  check("★ evidenceCount = 3, interventionCount = 4", o.evidenceCount === 3 && o.interventionCount === 4, `${o.evidenceCount}/${o.interventionCount}`);

  // ── D. DISTRIBUTIONS + SUPPRESSION ────────────────────────────────
  console.log("\nD. distributions + suppression");
  const sevDist = report.distributions.severity!;
  const cell = (d: typeof sevDist, key: string) => d.find((b) => b.key === key)!;
  check("★ severity has all 4 canonical values (zero-filled)", sevDist.length === 4 && ["low", "medium", "high", "critical"].every((v) => sevDist.some((b) => b.key === v)));
  check("★ severity high = 16 (revealed)", cell(sevDist, "high").count.value === 16 && cell(sevDist, "high").count.suppressed === false, JSON.stringify(cell(sevDist, "high")));
  check("★ severity critical (1) is PRIMARY-suppressed (value null)", cell(sevDist, "critical").count.suppressed === true && cell(sevDist, "critical").count.value === null);
  check("★ severity medium (5) is SECONDARY-suppressed (prevents subtraction)", cell(sevDist, "medium").count.suppressed === true && cell(sevDist, "medium").count.value === null);
  check("★ severity low (0) reported truthfully as 0 (not suppressed)", cell(sevDist, "low").count.value === 0 && cell(sevDist, "low").count.suppressed === false);
  check("★ NO suppressed cell ever carries a number", sevDist.every((b) => !b.count.suppressed || b.count.value === null));
  const statusDist = report.distributions.status!;
  check("★ status distribution zero-fills all 9 statuses", statusDist.length === 9);
  check("★ every distribution dimension present", ["severity", "urgency", "risk_family", "status", "escalation_status", "plan_status", "action_status", "delivery_outcome"].every((d) => Array.isArray(report.distributions[d])));
  const dlv = report.distributions.delivery_outcome!;
  check("★ delivery prepared = 6 (revealed)", cell(dlv, "prepared").count.value === 6);

  // ── E. TIME SERIES (every bucket exists; missing == zero) ─────────
  console.log("\nE. time series buckets");
  const ts = report.timeSeries;
  check("★ day granularity → 31 buckets (30-day range, inclusive)", ts.buckets.length === 31, `${ts.buckets.length}`);
  check("★ incidents series aligned to buckets (same length)", ts.incidents.length === ts.buckets.length);
  check("★ incidents series sums to incidentsCreated", ts.incidents.reduce((a, b) => a + b, 0) === o.incidentsCreated);
  check("★ every bucket is a real number (missing == 0, no gaps)", ts.incidents.every((n) => Number.isFinite(n)) && ts.incidents.some((n) => n === 0));
  const wk = await getChildSafetyAnalyticsReport(owner, { ...input, granularity: AnalyticsGranularity.Week });
  const mo = await getChildSafetyAnalyticsReport(owner, { ...input, granularity: AnalyticsGranularity.Month });
  check("★ week granularity buckets exist + sum preserved", wk.timeSeries.buckets.length >= 4 && wk.timeSeries.incidents.reduce((a, b) => a + b, 0) === o.incidentsCreated);
  check("★ month granularity buckets exist + sum preserved", mo.timeSeries.buckets.length >= 1 && mo.timeSeries.incidents.reduce((a, b) => a + b, 0) === o.incidentsCreated);
  check("★ resolutions/escalations/interventions/plans series all bucket-aligned", [ts.resolutions, ts.escalations, ts.interventions, ts.protectionPlans].every((s) => s.length === ts.buckets.length));

  // ── F. PERFORMANCE MEDIANS ────────────────────────────────────────
  console.log("\nF. performance medians");
  const p = report.performance;
  check("★ incident→first review median ≈ 1h, revealed, observations = 6", p.incidentToFirstReview.suppressed === false && p.incidentToFirstReview.medianMs === HOUR && p.incidentToFirstReview.observations === 6, JSON.stringify(p.incidentToFirstReview));
  check("★ incident→resolved median ≈ 2h, revealed", p.incidentToResolved.suppressed === false && p.incidentToResolved.medianMs === 2 * HOUR, JSON.stringify(p.incidentToResolved));
  check("★ plan activation→completion median ≈ 3h, revealed, observations = 6", p.planActivationToCompletion.suppressed === false && p.planActivationToCompletion.medianMs === 3 * HOUR && p.planActivationToCompletion.observations === 6);

  // ── G. REVIEWER WORKLOAD (never ranked; suppressed) ───────────────
  console.log("\nG. reviewer workload");
  const wl = report.reviewerWorkload;
  const r1 = wl.find((r) => r.reviewerId === A.R1)!;
  const r2 = wl.find((r) => r.reviewerId === A.R2)!;
  check("★ workload lists both assigned reviewers", !!r1 && !!r2);
  check("★ ordered by STABLE reviewer id (not by any metric — no ranking)", JSON.stringify(wl.map((r) => r.reviewerId)) === JSON.stringify([...wl.map((r) => r.reviewerId)].sort()));
  check("★ R1 (5 incidents) revealed: assigned = 5", r1.assignedIncidents.value === 5 && r1.assignedIncidents.suppressed === false);
  check("★ R1 median first review revealed (n = 5)", r1.medianFirstReview.suppressed === false && r1.medianFirstReview.observations === 5);
  check("★ R2 (1 incident) SUPPRESSED: assigned value null", r2.assignedIncidents.suppressed === true && r2.assignedIncidents.value === null);
  check("★ R2 medians suppressed (tiny caseload can't be singled out)", r2.medianFirstReview.suppressed === true && r2.medianFirstReview.medianMs === null);

  // ── H. PROTECTION PLANS + GUARDIAN DELIVERY ───────────────────────
  console.log("\nH. protection plans + guardian delivery");
  check("★ plan analytics: completed = 6", report.protectionPlans.completed === 6);
  check("★ plan status distribution present", report.protectionPlans.statusDistribution.some((b) => b.key === "completed" && b.count.value === 6));
  check("★ action status distribution: in_progress = 5, blocked = 5 (revealed)", report.protectionPlans.actionStatusDistribution.find((b) => b.key === "in_progress")!.count.value === 5 && report.protectionPlans.actionStatusDistribution.find((b) => b.key === "blocked")!.count.value === 5);
  check("★ guardian delivery outcomes = overview + distribution (prepared 6)", o.guardianDeliveryOutcomes.find((b) => b.key === "prepared")!.count.value === 6);

  // ── I. TENANT ISOLATION ───────────────────────────────────────────
  console.log("\nI. tenant isolation");
  const B = await seedTenant();
  for (let i = 0; i < 3; i++) await mkIncident(B.tenantId, B.profileId, { severity: "low", status: "open", createdAt: new Date(BASE.getTime() - DAY) });
  const bReport = await getChildSafetyAnalyticsReport(actor(B.tenantId, "owner", Role.Owner), input);
  check("★ tenant B sees only its 3 incidents (no A leakage)", bReport.overview.incidentsCreated === 3, `${bReport.overview.incidentsCreated}`);
  check("★ tenant A unchanged by tenant B's data", (await getChildSafetyAnalyticsReport(owner, input)).overview.incidentsCreated === 22);
  check("★ tenant B has no reviewer workload rows from A", bReport.reviewerWorkload.every((r) => r.reviewerId !== A.R1 && r.reviewerId !== A.R2));

  // ── J. CSV EXPORT (aggregated ONLY — no ids / PII) ────────────────
  console.log("\nJ. csv export");
  const { filename, csv } = exportChildSafetyAnalyticsCsv(owner, report);
  const rows = buildAnalyticsCsvRows(report);
  check("★ CSV has the stable header", csv.startsWith("section,metric,dimension,value"));
  check("★ filename is safe + content-free", /^child-safety-analytics_[\d-]+_[\d-]+\.csv$/.test(filename), filename);
  check("★ CSV carries the aggregated overview (incidents_created,22)", /overview,incidents_created,,22/.test(csv));
  check("★ CSV NEVER contains the tenant id", !csv.includes(A.tenantId));
  check("★ CSV NEVER contains a real reviewer id", !csv.includes(A.R1) && !csv.includes(A.R2));
  check("★ CSV NEVER contains the protected-profile id", !csv.includes(A.profileId));
  check("★ reviewer workload rows use OPAQUE positional labels", rows.some((r) => r.section === "reviewer_workload" && r.dimension === "reviewer_1") && rows.every((r) => r.section !== "reviewer_workload" || !String(r.dimension).includes(A.R1)));
  check("★ suppressed values are written as 'suppressed' (never the hidden number)", rows.some((r) => r.section === "distribution" && r.metric === "severity" && r.value === "suppressed"));
  check("★ CSV has NO forbidden columns (id/user/guardian/note/message/evidence/storage)", !/incidentId|userId|guardian|note|message|storageKey|storage_key/i.test(csv));
}

main()
  .then(async () => {
    for (const id of tids) {
      for (const t of ["childSafetyReviewEvent", "childSafetyProtectionActionEvent", "childSafetyProtectionAction", "childSafetyProtectionPlan", "childSafetyEvidenceCustodyEvent", "childSafetyEvidence", "childSafetyEscalation", "childSafetyIncidentSignal", "childSafetyIncident", "safetySignalDelivery", "safetyRecipientAuthorizationDecision", "childSafetyIntervention", "safetySignal", "auditLog", "protectedProfile"] as const) {
        await (systemDb as never as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[t].deleteMany({ where: { tenantId: id } }).catch(() => {});
      }
      await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Analytics & Trends V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => { console.error("FATAL:", e?.stack ?? e?.message ?? e); for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {}); process.exit(1); });
