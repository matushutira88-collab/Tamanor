/**
 * V1.37.5B — test fixture helper. Ensures a REAL ReputationItem (+ ActionQueueItem)
 * exists for a HideContext's ids BEFORE an execution/provider-call history row is
 * written, so the history-group FKs + cross-tenant triggers are satisfied by real,
 * same-tenant parents. Idempotent (create-if-missing by explicit id), so repeated
 * calls with the same ids — as idempotency tests do — reuse the same real rows.
 */
type Prismaish = {
  reputationItem: { findUnique: (a: unknown) => Promise<{ id: string } | null>; create: (a: unknown) => Promise<unknown> };
  contentItem: { create: (a: unknown) => Promise<{ id: string }> };
  actionQueueItem: { findUnique: (a: unknown) => Promise<{ id: string } | null>; create: (a: unknown) => Promise<unknown> };
};
type CtxLike = { tenantId: string; itemId?: string | null; queueItemId?: string | null; matchedCategory?: string };

/** `realBrandId`/`realAccountId` are REAL rows (Brand/ConnectedAccount FKs); the created
 * ReputationItem carries `ctx.tenantId` so the history FK/trigger sees a same-tenant parent. */
export async function ensureHideTarget(
  prisma: Prismaish,
  ctx: CtxLike,
  realBrandId: string,
  realAccountId: string,
): Promise<void> {
  if (ctx.itemId) {
    const exists = await prisma.reputationItem.findUnique({ where: { id: ctx.itemId }, select: { id: true } });
    if (!exists) {
      const ci = await prisma.contentItem.create({
        data: { tenantId: ctx.tenantId, brandId: realBrandId, connectedAccountId: realAccountId, platform: "facebook_page", kind: "comment", externalId: `rifx_${ctx.itemId}`, text: "x", publishedAt: new Date() },
      });
      await prisma.reputationItem.create({
        data: { id: ctx.itemId, tenantId: ctx.tenantId, brandId: realBrandId, platform: "facebook_page", contentItemId: ci.id, riskLevel: "high", riskCategories: [], sentiment: "neutral" },
      });
    }
  }
  if (ctx.queueItemId && ctx.itemId) {
    const exists = await prisma.actionQueueItem.findUnique({ where: { id: ctx.queueItemId }, select: { id: true } });
    if (!exists) {
      await prisma.actionQueueItem.create({
        data: { id: ctx.queueItemId, tenantId: ctx.tenantId, brandId: realBrandId, itemId: ctx.itemId, category: ctx.matchedCategory ?? "scam", confidence: 0.9, proposedAction: "hide_comment", queueState: "approval_required" },
      });
    }
  }
}
