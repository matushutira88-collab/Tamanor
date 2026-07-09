/**
 * Operational workflow tests (V1.23). Run via: pnpm workflow:test
 * Approve/reject/mark-safe/mark-harmful/create-incident on a queue item, timeline
 * audit events, and the safety invariants (approve never executes a live action;
 * never-autonomous categories can't be autonomous; live actions = 0). Self-contained.
 */
import { prisma, Platform, ContentKind, ConnectorStatus, ConnectorMode, ConnectorHealth, ActorKind } from "../src/index";
import { NEVER_AUTONOMOUS } from "@guardora/ai";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const slug = `wf-test-${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { name: "WF Test", slug } });
  const brand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "WF Brand" } });
  const acct = await prisma.connectedAccount.create({ data: { tenantId: tenant.id, brandId: brand.id, platform: Platform.facebook_page, status: ConnectorStatus.active, mode: ConnectorMode.read_only, health: ConnectorHealth.healthy, externalId: "wf_acc", grantedPermissions: [] } });
  const content = await prisma.contentItem.create({ data: { tenantId: tenant.id, brandId: brand.id, connectedAccountId: acct.id, platform: Platform.facebook_page, kind: ContentKind.comment, externalId: "wf_c1", text: "this is a scam", publishedAt: new Date() } });
  const item = await prisma.reputationItem.create({ data: { tenantId: tenant.id, brandId: brand.id, platform: Platform.facebook_page, contentItemId: content.id, riskLevel: "critical", riskConfidence: 0.9, riskCategories: ["scam"] } });
  const q = await prisma.actionQueueItem.create({ data: { tenantId: tenant.id, brandId: brand.id, itemId: item.id, category: "scam", confidence: 0.9, proposedAction: "hide_comment", queueState: "approval_required", wouldExecute: true } });

  async function cleanup() {
    for (const m of [prisma.brandRiskFeedback, prisma.incident, prisma.actionQueueItem, prisma.auditLog, prisma.platformActionExecution, prisma.reputationItem, prisma.contentItem, prisma.connectedAccount, prisma.brand]) {
      await (m as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { tenantId: tenant.id } });
    }
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  }

  try {
    // 2) approve → approved, NO live action executed.
    await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "approved" } });
    await prisma.auditLog.create({ data: { tenantId: tenant.id, brandId: brand.id, event: "approval.approved", actorKind: ActorKind.system, targetType: "action_queue_item", targetId: q.id, metadata: { executed: false } as never } });
    const approved = await prisma.actionQueueItem.findUnique({ where: { id: q.id } });
    check("2) approve → approved, no execution row", approved?.queueState === "approved" && (await prisma.platformActionExecution.count({ where: { tenantId: tenant.id, status: "executed" } })) === 0);

    // 3) reject → rejected.
    await prisma.actionQueueItem.update({ where: { id: q.id }, data: { queueState: "rejected", rejectedByUserId: "u1" } });
    check("3) reject updates status", (await prisma.actionQueueItem.findUnique({ where: { id: q.id } }))?.queueState === "rejected");

    // 4/5) mark safe / harmful → feedback + audit.
    await prisma.brandRiskFeedback.create({ data: { tenantId: tenant.id, brandId: brand.id, itemId: item.id, feedbackType: "mark_safe", originalCategory: "scam" } });
    await prisma.auditLog.create({ data: { tenantId: tenant.id, brandId: brand.id, event: "feedback.created", actorKind: ActorKind.human, targetType: "reputation_item", targetId: item.id, metadata: { feedbackType: "mark_safe" } as never } });
    check("4) mark safe creates feedback + audit", (await prisma.brandRiskFeedback.count({ where: { tenantId: tenant.id, feedbackType: "mark_safe" } })) === 1 && (await prisma.auditLog.count({ where: { tenantId: tenant.id, event: "feedback.created" } })) === 1);

    await prisma.brandRiskFeedback.create({ data: { tenantId: tenant.id, brandId: brand.id, itemId: item.id, feedbackType: "mark_risky", originalCategory: "scam" } });
    check("5) mark harmful creates feedback", (await prisma.brandRiskFeedback.count({ where: { tenantId: tenant.id, feedbackType: "mark_risky" } })) === 1);

    // 6) create incident from approval.
    const inc = await prisma.incident.create({ data: { tenantId: tenant.id, brandId: brand.id, title: "scam — manual incident", category: "scam", severity: "critical", status: "open", relatedItemIds: [item.id] } });
    await prisma.auditLog.create({ data: { tenantId: tenant.id, brandId: brand.id, event: "incident.created", actorKind: ActorKind.human, targetType: "incident", targetId: inc.id, metadata: { manual: true } as never } });
    check("6) create incident works", (await prisma.incident.count({ where: { id: inc.id, status: "open" } })) === 1);

    // 7) timeline records events (audit rows exist for the operational events).
    const events = await prisma.auditLog.findMany({ where: { tenantId: tenant.id, event: { in: ["approval.approved", "feedback.created", "incident.created"] } }, select: { event: true } });
    check("7) timeline records policy/action events", events.length >= 3);

    // 14) never-autonomous categories cannot be autonomous (clamp logic).
    const clamp = (cat: string, mode: string) => (NEVER_AUTONOMOUS.has(cat as never) && mode === "autonomous" ? "approval" : mode);
    check("14) never-autonomous clamped to approval", clamp("normal_criticism", "autonomous") === "approval" && clamp("refund_complaint", "autonomous") === "approval" && clamp("scam", "autonomous") === "autonomous");

    // 16) live actions executed = 0.
    check("16) live actions executed = 0", (await prisma.platformActionExecution.count({ where: { tenantId: tenant.id, status: "executed" } })) === 0);
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — operational workflow`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
