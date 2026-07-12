/**
 * V1.27G — backfill ActionQueueItem.queueState from the latest execution so the
 * active queue reflects reality. Dry-run by default; pass --apply to write.
 *
 * Rules (never touches a rejected item):
 *   latest executed / live_hide_executed / already_hidden -> executed
 *   latest blocked / comment_deleted_or_unavailable        -> no_action
 *   approval_required hide_comment whose comment is gone    -> no_action (with --check-comments)
 *
 * Usage: pnpm backfill:queue-states [--apply] [--check-comments]
 */
import { prisma } from "@guardora/db";
import { getCommentLifecycle } from "../src/live-actions";

const APPLY = process.argv.includes("--apply");
const CHECK_COMMENTS = process.argv.includes("--check-comments");

async function main() {
  const items = await prisma.actionQueueItem.findMany({
    where: { queueState: { notIn: ["rejected", "executed", "no_action"] } },
    select: { id: true, tenantId: true, itemId: true, queueState: true, proposedAction: true },
  });

  const plan: { id: string; from: string; to: string; why: string }[] = [];

  for (const it of items) {
    const latest = await prisma.platformActionExecution.findFirst({
      where: { queueItemId: it.id, actionType: "hide_comment" },
      orderBy: { createdAt: "desc" },
      select: { status: true, reason: true },
    });
    let to: "executed" | "no_action" | null = null;
    let why = "";
    if (latest?.status === "executed" && (latest.reason === "live_hide_executed" || latest.reason === "already_hidden")) { to = "executed"; why = `latest ${latest.reason}`; }
    else if (latest?.status === "blocked" && latest.reason === "comment_deleted_or_unavailable") { to = "no_action"; why = "comment deleted/unavailable"; }
    else if (!latest && CHECK_COMMENTS && it.queueState === "approval_required" && it.proposedAction === "hide_comment") {
      // Optional: the comment may have been manually deleted on Facebook (one Graph GET).
      const rep = await prisma.reputationItem.findFirst({ where: { id: it.itemId }, select: { contentItem: { select: { externalId: true, connectedAccountId: true } } } });
      const ext = rep?.contentItem;
      if (ext?.externalId && ext.connectedAccountId) {
        try {
          const lc = await getCommentLifecycle({ tenantId: it.tenantId, accountId: ext.connectedAccountId, commentId: ext.externalId });
          if (lc.status === "deleted") { to = "no_action"; why = "comment gone on Facebook"; }
        } catch { /* best-effort */ }
      }
    }
    if (to && to !== it.queueState) plan.push({ id: it.id, from: it.queueState, to, why });
  }

  console.log(`Scanned ${items.length} non-terminal queue items. ${plan.length} to update:`);
  for (const p of plan) console.log(`  ${p.id}: ${p.from} -> ${p.to}  (${p.why})`);

  if (!APPLY) {
    console.log("\nDRY-RUN. Re-run with --apply (and optionally --check-comments) to write.");
  } else {
    for (const p of plan) await prisma.actionQueueItem.updateMany({ where: { id: p.id, queueState: { notIn: ["rejected"] } }, data: { queueState: p.to } });
    console.log(`\nApplied ${plan.length} update(s).`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
