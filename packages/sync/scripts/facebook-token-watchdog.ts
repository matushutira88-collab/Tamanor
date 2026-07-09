/**
 * V1.27C — Facebook token watchdog runner. Validates every active Facebook Page
 * token against Graph (GET /{pageId}) and flags needs_reconnect BEFORE any hide.
 * Read-only; never logs a token. Intended to run every ~6h (cron) or at worker boot.
 *
 * Usage: pnpm facebook-token:watchdog
 */
import { prisma } from "@guardora/db";
import { runFacebookTokenWatchdog } from "../src/connection-manager";

async function main() {
  const results = await runFacebookTokenWatchdog();
  console.log(`watchdog checked ${results.length} Facebook Page account(s):`);
  for (const r of results) {
    console.log(`  ${r.accountId}: connection=${r.connectionStatus} token=${r.tokenHealth} result=${r.result}${r.transient ? " (transient)" : ""}`);
  }
  const bad = results.filter((r) => r.connectionStatus !== "connected");
  console.log(bad.length === 0 ? "All connections healthy." : `${bad.length} account(s) need attention.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
