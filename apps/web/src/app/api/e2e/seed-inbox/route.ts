/**
 * V1.42B — TEST-ONLY deterministic inbox fixture. Idempotently ensures a fixed SET of reputation
 * items for the signed-in fixture tenant and RESETS their inbox workflow state to a known baseline
 * (unread, not archived, normal priority, `new` status), so the browser suite starts from a
 * deterministic point every run. Covers the provider/health matrix from the phase spec:
 *   - Facebook comment on a HEALTHY connector
 *   - Facebook comment on an UNHEALTHY (permission-missing) connector
 *   - Instagram comment
 *   - Google review WITH text
 *   - Google RATING-ONLY review (no text — never fabricated)
 * plus two tenant labels. Fail-closed: 404 unless E2E_TEST_MODE === "true". Uses withTenant (RLS)
 * only — never systemDb; no provider HTTP; creates no privileged access.
 */
import { getSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Health = { status: "active"; health: "healthy" | "degraded"; lastError?: string };

export async function POST() {
  if (!e2eSeamEnabled()) return new Response("Not found", { status: 404 });
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = session.tenantId;

  const result = await withTenant(tenantId, async (db) => {
    const brand = (await db.brand.findFirst({ where: { tenantId }, orderBy: { id: "asc" } }))
      ?? (await db.brand.create({ data: { tenantId, name: "E2E Fixture" } }));

    // Clean label slate every run (labels created by a prior test would otherwise make a
    // "create + assign" flow hit duplicate_label). Deleting a label cascades its join rows.
    await db.inboxLabel.deleteMany({ where: { tenantId } });

    async function ensureAccount(extId: string, platform: string, name: string, h: Health) {
      const found = await db.connectedAccount.findFirst({ where: { brandId: brand.id, externalId: extId } });
      if (found) { await db.connectedAccount.update({ where: { id: found.id }, data: { status: h.status, health: h.health, lastError: h.lastError ?? null } }); return found.id; }
      return (await db.connectedAccount.create({ data: { tenantId, brandId: brand.id, platform: platform as never, status: h.status, mode: "read_only", externalId: extId, externalName: name, health: h.health, lastError: h.lastError ?? null } })).id;
    }
    async function ensureItem(accountId: string, extId: string, platform: string, kind: "comment" | "review", text: string, author: string | null, rating: number | null) {
      const content = await db.contentItem.upsert({
        where: { connectedAccountId_externalId: { connectedAccountId: accountId, externalId: extId } },
        create: { tenantId, brandId: brand.id, connectedAccountId: accountId, platform: platform as never, kind, externalId: extId, text, authorDisplayName: author, rating: rating ?? undefined, publishedAt: new Date() },
        update: { text, rating: rating ?? undefined, authorDisplayName: author },
      });
      const baseline = { isRead: false, archivedAt: null, priority: "normal" as const, inboxWorkflowStatus: "new" as const, assignedToUserId: null, createdAt: new Date(), processingStatus: "processed_rules" as const, processingTier: "rules" as const, processingReason: null, lastProcessedAt: new Date(), classifierVersion: "risk-rules-v1", contentHash: null };
      const existing = await db.reputationItem.findFirst({ where: { contentItemId: content.id } });
      if (existing) {
        await db.reputationItem.update({ where: { id: existing.id }, data: baseline });
        // Reset relational inbox state too, so each run is deterministic.
        await db.inboxItemLabel.deleteMany({ where: { reputationItemId: existing.id } });
        await db.inboxNote.deleteMany({ where: { reputationItemId: existing.id } });
        return existing.id;
      }
      return (await db.reputationItem.create({ data: { tenantId, brandId: brand.id, platform: platform as never, contentItemId: content.id, status: "classified", ...baseline } })).id;
    }
    async function ensureLabel(name: string, colorKey: string) {
      const normalizedName = name.trim().toLowerCase();
      const found = await db.inboxLabel.findFirst({ where: { tenantId, normalizedName } });
      if (found) return found.id;
      return (await db.inboxLabel.create({ data: { tenantId, name, normalizedName, colorKey } })).id;
    }

    const fbHealthy = await ensureAccount("E2E_FB_HEALTHY", "facebook_page", "E2E Facebook Page", { status: "active", health: "healthy" });
    const fbUnhealthyAcc = await ensureAccount("E2E_FB_UNHEALTHY", "facebook_page", "E2E Facebook (broken)", { status: "active", health: "degraded", lastError: "Missing permission: pages_manage_engagement" });
    const igAcc = await ensureAccount("E2E_IG", "instagram_business", "E2E Instagram", { status: "active", health: "healthy" });
    const googleAcc = await ensureAccount("E2E_GOOGLE", "google_business", "E2E Google Location", { status: "active", health: "healthy" });

    const ids = {
      fb: await ensureItem(fbHealthy, "e2e_fb_comment", "facebook_page", "comment", "E2E fixture comment", "E2E Author", null),
      fb2: await ensureItem(fbHealthy, "e2e_fb_comment_2", "facebook_page", "comment", "Second Facebook comment", "Casey Buyer", null),
      ig: await ensureItem(igAcc, "e2e_ig_comment", "instagram_business", "comment", "Instagram comment about the product", "ig_user", null),
      gtext: await ensureItem(googleAcc, "e2e_google_review", "google_business", "review", "Great service, would recommend.", "Jordan Reviewer", 4),
      grating: await ensureItem(googleAcc, "e2e_google_rating", "google_business", "review", "", null, 5),
      fbUnhealthy: await ensureItem(fbUnhealthyAcc, "e2e_fb_unhealthy", "facebook_page", "comment", "Comment on a broken connector", "Sam Angry", null),
    };
    // One item in a truthful LIMIT state so the browser can verify the limit badge + usage link.
    await db.reputationItem.update({ where: { id: ids.fbUnhealthy }, data: { processingStatus: "premium_limit_reached", processingReason: "premium_call_limit_reached", processingTier: "rules" } });
    const labels = { vip: await ensureLabel("VIP", "brand"), urgent: await ensureLabel("Urgent follow-up", "danger") };
    return { itemId: ids.fb, ids, labels };
  });

  return Response.json({ ok: true, ...result }, { status: 200 });
}
