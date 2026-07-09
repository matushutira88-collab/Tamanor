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
import { GraphFacebookHideTransport } from "@guardora/connectors";
import { checkAccountToken } from "../src/connection-manager";

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

  // V1.27F — a successful execution is the source of truth. Load the latest one
  // FIRST; a comment GET is only secondary verification after that.
  const latest = await prisma.platformActionExecution.findFirst({
    where: { queueItemId: q.id, actionType: "hide_comment" },
    orderBy: { createdAt: "desc" },
    select: { status: true, reason: true, providerResponseCode: true, executedAt: true },
  });
  const executedOk = latest?.status === "executed" && (latest.reason === "live_hide_executed" || latest.reason === "already_hidden");
  console.log("latest_execution    :", latest ? `${latest.status}/${latest.reason}` : "none");
  if (latest) console.log("provider            :", latest.providerResponseCode ?? "—");

  const token = decryptToken(acct.longLivedToken ?? acct.accessToken);
  const commentId = item?.contentItem.externalId;
  if (token && commentId && !expired) {
    const st = await new GraphFacebookHideTransport().getCommentState!(commentId, token);
    if (!st.ok) {
      if (st.errorCode === "not_found") {
        console.log("GET comment         :", "not found / unavailable");
        // V1.27F — after a successful execution this is expected, not a failure.
        console.log("result              :", executedOk ? "hidden_or_unavailable_after_execution" : "comment_deleted_or_unavailable");
      } else if (executedOk) {
        // A generic/limited GET AFTER a confirmed 200 hide is not a fresh failure.
        console.log("GET comment         :", `secondary GET ${st.errorCode} (post-execution)`);
        console.log("result              :", "hidden_or_unavailable_after_execution");
      } else {
        console.log("GET comment         :", `token/permission issue (${st.errorCode})`);
        console.log("result              :", st.errorCode === "token_expired" || st.errorCode === "token_invalid" ? "blocked/reconnect_required" : `blocked/${st.errorCode}`);
      }
    } else {
      console.log("GET comment         :", `ok — can_hide=${st.canHide} is_hidden=${st.isHidden}`);
      const result = st.isHidden ? "already_hidden" : executedOk ? "hidden_or_unavailable_after_execution" : !st.canHide ? "blocked/facebook_can_hide_false" : "hide_possible";
      console.log("result              :", result);
      if (st.isHidden) {
        // is_hidden hides from the PUBLIC only — author/admin visibility is expected.
        console.log("public_visibility_note:", "hidden comments may remain visible to author/admin");
      }
    }
  } else if (executedOk) {
    console.log("result              :", "hidden_or_unavailable_after_execution");
  } else {
    console.log("GET comment         :", token ? (expired ? "skipped (token expired)" : "skipped (no comment id)") : "skipped (no token)");
  }
  // V1.27D — repair a stale false-expired connection row when the Page token works.
  const repaired = await checkAccountToken(acct.id);
  console.log("connection (now)    :", `${repaired.connectionStatus} / token=${repaired.tokenHealth}`);
  console.log("NOTE                : diagnostic only — no hide was performed.");

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
