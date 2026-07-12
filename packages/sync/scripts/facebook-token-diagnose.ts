/**
 * V1.27B — Facebook Page token diagnostics. Read-only. NEVER prints a token value.
 *
 * Usage: pnpm facebook-token:diagnose --accountId=<id>
 *
 * Prints page/health/permission/expiry state and, if a token exists, a SAFE Graph
 * debug (GET /me/accounts scoped by the stored token) reporting only whether the
 * call succeeded and which pages are visible — never the token itself.
 */
import { prisma, decryptToken } from "@guardora/db";
import { META_GRAPH_BASE, GraphFacebookHideTransport } from "@guardora/connectors";
import { checkAccountToken } from "../src/connection-manager";

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

async function main() {
  const accountId = argOf("accountId");
  if (!accountId) { console.error("Missing --accountId=<id>"); process.exit(1); }

  const acct = await prisma.connectedAccount.findFirst({
    where: { id: accountId },
    select: {
      id: true, platform: true, externalName: true, pageId: true, externalId: true,
      status: true, health: true, grantedPermissions: true, tokenType: true,
      tokenExpiresAt: true, lastError: true, lastErrorAt: true, accessToken: true, longLivedToken: true,
    },
  });
  if (!acct) { console.error("Account not found:", accountId); process.exit(1); }

  const token = decryptToken(acct.longLivedToken ?? acct.accessToken);
  const now = Date.now();
  const expired = !!acct.tokenExpiresAt && acct.tokenExpiresAt.getTime() <= now;

  console.log("=== Facebook token diagnose ===");
  console.log("pageName            :", acct.externalName ?? "—");
  console.log("pageId              :", acct.pageId ?? acct.externalId);
  console.log("platform            :", acct.platform);
  console.log("health              :", acct.health);
  console.log("status              :", acct.status);
  console.log("grantedPermissions  :", acct.grantedPermissions.join(", ") || "—");
  console.log("tokenExpiresAt      :", acct.tokenExpiresAt ? acct.tokenExpiresAt.toISOString() : "unknown");
  console.log("tokenExpired        :", expired ? "YES" : "no");
  console.log("lastError           :", acct.lastError ?? "—");
  console.log("lastErrorAt         :", acct.lastErrorAt ? acct.lastErrorAt.toISOString() : "—");
  console.log("token exists        :", token ? "yes" : "no");
  // Only the CLASS of token — never a value.
  console.log("token type          :", acct.tokenType ?? (token ? "page_token" : "unknown"));

  // V1.27C — a PAGE token is validated via GET /{pageId}?fields=id,name — NOT
  // /me/accounts (which needs a USER token). /me/accounts is only a reconnect debug.
  const pageId = acct.pageId ?? acct.externalId;
  if (token) {
    const st = await new GraphFacebookHideTransport().getPageTokenState!(pageId, token);
    if (st.ok) {
      console.log("page token          : page_token_ok");
      console.log("target_page_visible :", st.pageId === pageId ? "YES" : `returned ${st.pageId}`);
      console.log("page name (graph)   :", st.pageName ?? "—");
    } else {
      console.log("page token          :", `page_token_invalid (${st.errorCode})`);
    }
    // Optional secondary user-token debug (expected to fail for a page token).
    try {
      const res = await fetch(`${META_GRAPH_BASE}/me/accounts?fields=id,name&access_token=${encodeURIComponent(token)}`);
      console.log("user token check    :", res.ok ? "ok (user token)" : `user_token_check_failed (HTTP ${res.status})`);
    } catch {
      console.log("user token check    :", "user_token_check_failed (network)");
    }
  } else {
    console.log("page token          :", "skipped (no token)");
  }

  // V1.27D — authoritative check + self-repair of a stale false-expired row.
  const repaired = await checkAccountToken(acct.tenantId, accountId);
  console.log("--- repair ---");
  console.log("connection (now)    :", repaired.connectionStatus);
  console.log("token health (now)  :", repaired.tokenHealth, `(result: ${repaired.result}${repaired.transient ? ", transient" : ""})`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
