/**
 * V1.32B Instagram moderation CLI harness (research/test-only). Fail-closed:
 * nothing executes unless INSTAGRAM_HIDE_TEST_ENABLED=true and
 * INSTAGRAM_HIDE_TEST_CONFIRM=YES. There is no real Graph executor wired here, so
 * a "live" run reports the gated/normalized result rather than calling Instagram —
 * a real executor is injected only in the manual test protocol (spec M).
 *
 *   pnpm instagram-hide:diagnose --accountId=… --commentId=…
 *   pnpm instagram-hide:test     --accountId=… --commentId=…
 *   pnpm instagram-hide:restore  --accountId=… --commentId=…
 */
import { getInstagramActionsConfig } from "@guardora/config";
import { runInstagramModerationTest, instagramModerationDiagnostics } from "@guardora/sync";
import { prisma } from "@guardora/db";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

async function run() {
  const mode = process.argv[2] ?? "diagnose";
  const accountId = arg("accountId") ?? "";
  const commentId = arg("commentId") ?? "";
  const gates = getInstagramActionsConfig();

  console.log(`Instagram moderation harness — mode: ${mode}`);
  console.log(`  gates: hideTestEnabled=${gates.hideTestEnabled} confirmed=${gates.hideTestConfirmed} autoHide=${gates.autoHideEnabled} canExecuteTest=${gates.canExecuteTest}`);

  if (mode === "diagnose") {
    const acct = accountId ? await prisma.connectedAccount.findFirst({ where: { id: accountId }, select: { externalName: true, grantedPermissions: true, platform: true, tokenHealth: true } }) : null;
    const diag = instagramModerationDiagnostics({
      accountId: accountId || "(none)",
      accountName: acct?.externalName ?? undefined,
      grantedPermissions: acct?.grantedPermissions ?? [],
      accountFound: accountId ? !!acct : undefined,
      tokenValid: acct ? acct.tokenHealth !== "expired" && acct.tokenHealth !== "invalid" : undefined,
    });
    console.log(`  status: ${diag.status}`);
    console.log(`  hasReadPermission=${diag.hasReadPermission} hasModerationPermission=${diag.hasModerationPermission}`);
    console.log(`  canHideTest=${diag.canHideTest} canUnhideTest=${diag.canUnhideTest}`);
    await prisma.$disconnect();
    return;
  }

  if (mode === "test" || mode === "restore") {
    const kind = mode === "test" ? "hide" : "unhide";
    // No real executor is provided in this harness — the result is the gated outcome.
    const result = await runInstagramModerationTest(kind, { accountId, externalCommentId: commentId });
    console.log(`  result: status=${result.status} reason=${result.reason}`);
    if (result.reason === "blocked_by_safety_gate") console.log("  → Blocked by safety gate. Set INSTAGRAM_HIDE_TEST_ENABLED=true and INSTAGRAM_HIDE_TEST_CONFIRM=YES, and wire a real executor, to run a live test.");
    if (result.reason === "dry_run") console.log("  → Dry-run: enabled but not confirmed. Nothing was sent to Instagram.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Unknown mode: ${mode}. Use diagnose | test | restore.`);
  await prisma.$disconnect();
}

run().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
