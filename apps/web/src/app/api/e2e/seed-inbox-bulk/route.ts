/**
 * V1.43 — TEST-ONLY bulk inbox fixture for the SCALABILITY suite. Idempotently (re)creates a large,
 * deterministic set of reputation items (`?count=1000|5000|10000`) for the signed-in fixture tenant
 * so the browser gate can prove keyset pagination, server search/filter and stable memory at scale.
 *
 * Rows have DISTINCT createdAt (1s apart) so the keyset order is total; a fixed subset carries the
 * "needle" token (search) and every 4th row is unread (filter). Fail-closed: 404 unless
 * E2E_TEST_MODE === "true". Uses withTenant (RLS) only — never systemDb; no provider HTTP; inserts
 * are chunked (createMany) to stay well under Postgres' bind-parameter ceiling.
 */
import { getSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { e2eSeamEnabled } from "@/lib/e2e-seam";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENTS = ["positive", "neutral", "negative"] as const;
const PRIOS = ["low", "normal", "high", "urgent"] as const;
const WFS = ["new", "in_review", "action_required", "resolved"] as const;
const BASE = Date.UTC(2026, 0, 1); // fixed epoch so createdAt is deterministic across runs
const CHUNK = 1000;

export async function POST(req: Request) {
  if (!e2eSeamEnabled()) return new Response("Not found", { status: 404 });
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = session.tenantId;
  const count = Math.min(Math.max(Number(new URL(req.url).searchParams.get("count") ?? 1000) || 1000, 1), 20000);

  const result = await withTenant(tenantId, async (db) => {
    const brand = (await db.brand.findFirst({ where: { tenantId }, orderBy: { id: "asc" } }))
      ?? (await db.brand.create({ data: { tenantId, name: "Scale Fixture" } }));
    const accId = (await db.connectedAccount.findFirst({ where: { brandId: brand.id, externalId: "SCALE_FB" } }))?.id
      ?? (await db.connectedAccount.create({ data: { tenantId, brandId: brand.id, platform: "facebook_page" as never, status: "active", mode: "read_only", externalId: "SCALE_FB", externalName: "Scale Page", health: "healthy" } })).id;

    // Clean prior scale rows for a deterministic run (content delete cascades reputation items).
    await db.contentItem.deleteMany({ where: { connectedAccountId: accId, externalId: { startsWith: "scale_" } } });

    let seeded = 0;
    for (let start = 0; start < count; start += CHUNK) {
      const end = Math.min(start + CHUNK, count);
      const cData: unknown[] = [];
      const rData: unknown[] = [];
      for (let i = start; i < end; i++) {
        const cid = randomUUID();
        const createdAt = new Date(BASE + i * 1000);
        const isReview = i % 5 === 0;
        cData.push({ id: cid, tenantId, brandId: brand.id, connectedAccountId: accId, platform: "facebook_page", kind: isReview ? "review" : "comment", externalId: `scale_${i}`, text: `Scale item ${i} about service ${i % 10 === 0 ? "needle" : "haystack"}`, authorDisplayName: `Scale Author ${i % 50}`, rating: isReview ? (i % 5) + 1 : null, publishedAt: createdAt });
        rData.push({ id: randomUUID(), tenantId, brandId: brand.id, platform: "facebook_page", contentItemId: cid, status: "classified", sentiment: SENTS[i % 3], riskCategories: i % 7 === 0 ? ["spam"] : [], riskLevel: i % 11 === 0 ? "high" : "none", createdAt, isRead: i % 4 === 0, priority: PRIOS[i % 4], inboxWorkflowStatus: WFS[i % 4] });
      }
      await db.contentItem.createMany({ data: cData as never });
      await db.reputationItem.createMany({ data: rData as never });
      seeded += end - start;
    }
    const total = await db.reputationItem.count({ where: { tenantId } });
    const unread = await db.reputationItem.count({ where: { tenantId, isRead: false, archivedAt: null } });
    const needle = await db.reputationItem.count({ where: { tenantId, contentItem: { is: { text: { contains: "needle" } } } } });
    return { seeded, total, unread, needle };
  });

  return Response.json({ ok: true, count, ...result }, { status: 200 });
}
