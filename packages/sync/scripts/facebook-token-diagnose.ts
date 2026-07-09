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
import { META_GRAPH_BASE } from "@guardora/connectors";

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

  if (token && !expired) {
    try {
      const url = `${META_GRAPH_BASE}/me/accounts?fields=id,name&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (res.ok) {
        const j = (await res.json()) as { data?: { id: string; name: string }[] };
        const pages = (j.data ?? []).map((p) => `${p.name} (${p.id})`);
        console.log("graph /me/accounts  :", `ok — ${pages.length} page(s): ${pages.join(", ") || "none"}`);
        console.log("target page visible :", (j.data ?? []).some((p) => p.id === (acct.pageId ?? acct.externalId)) ? "YES" : "no");
      } else {
        console.log("graph /me/accounts  :", `HTTP ${res.status} — token may be invalid/expired (no token logged)`);
      }
    } catch {
      console.log("graph /me/accounts  :", "network error (no token logged)");
    }
  } else {
    console.log("graph /me/accounts  :", token ? "skipped (token expired)" : "skipped (no token)");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(String(e)); await prisma.$disconnect(); process.exit(1); });
