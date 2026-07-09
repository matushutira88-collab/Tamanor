/**
 * V1.27B — Facebook hide diagnostics for one queue item. Read-only. Does NOT hide,
 * and NEVER prints a token value.
 *
 * Usage: pnpm facebook-hide:diagnose --queueItemId=<id>
 *
 * Prints the queue item, target comment/post ids, the connected account's page +
 * permissions + token health, and a SAFE GET of the comment
 * (fields=id,can_hide,is_hidden,message) so you can see whether the hide would be
 * possible — without performing it.
 */
import { prisma, decryptToken } from "@guardora/db";
import { META_GRAPH_BASE } from "@guardora/connectors";

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

async function main() {
  const queueItemId = argOf("queueItemId");
  if (!queueItemId) { console.error("Missing --queueItemId=<id>"); process.exit(1); }

  const q = await prisma.actionQueueItem.findFirst({ where: { id: queueItemId } });
  if (!q) { console.error("Queue item not found:", queueItemId); process.exit(1); }

  const item = await prisma.reputationItem.findFirst({
    where: { id: q.itemId },
    select: { riskLevel: true, contentItem: { select: { externalId: true, externalParentId: true, text: true, connectedAccount: { select: { id: true, externalName: true, pageId: true, externalId: true, health: true, grantedPermissions: true, tokenExpiresAt: true, lastError: true, accessToken: true, longLivedToken: true } } } } },
  });
  const acct = item?.contentItem.connectedAccount;

  console.log("=== Facebook hide diagnose ===");
  console.log("queueItemId         :", q.id);
  console.log("category            :", q.category, "| confidence:", q.confidence);
  console.log("proposedAction      :", q.proposedAction, "| queueState:", q.queueState);
  console.log("externalCommentId   :", item?.contentItem.externalId ?? "—");
  console.log("externalPostId      :", item?.contentItem.externalParentId ?? "—");
  if (!acct) { console.log("connectedAccount    : — (none)"); await prisma.$disconnect(); return; }
  console.log("pageName            :", acct.externalName ?? "—");
  console.log("pageId              :", acct.pageId ?? acct.externalId);
  console.log("permissions         :", acct.grantedPermissions.join(", ") || "—");
  console.log("hide permission     :", acct.grantedPermissions.includes("pages_manage_engagement") ? "granted" : "MISSING");
  console.log("health              :", acct.health);
  const expired = !!acct.tokenExpiresAt && acct.tokenExpiresAt.getTime() <= Date.now();
  console.log("token health        :", acct.lastError === "token_expired" || expired ? "EXPIRED — reconnect" : "ok");

  const token = decryptToken(acct.longLivedToken ?? acct.accessToken);
  const commentId = item?.contentItem.externalId;
  if (token && commentId && !expired) {
    try {
      const url = `${META_GRAPH_BASE}/${encodeURIComponent(commentId)}?fields=id,can_hide,is_hidden,message&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (res.ok) {
        const j = (await res.json()) as { id?: string; can_hide?: boolean; is_hidden?: boolean; message?: string };
        console.log("GET comment         :", `ok — can_hide=${j.can_hide} is_hidden=${j.is_hidden}`);
        console.log("comment message     :", (j.message ?? "").slice(0, 80));
      } else {
        console.log("GET comment         :", `HTTP ${res.status} — token/permission issue (no token logged)`);
      }
    } catch {
      console.log("GET comment         :", "network error (no token logged)");
    }
  } else {
    console.log("GET comment         :", token ? (expired ? "skipped (token expired)" : "skipped (no comment id)") : "skipped (no token)");
  }
  console.log("NOTE                : diagnostic only — no hide was performed.");

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
