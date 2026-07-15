/**
 * V1.39C / V1.42B — TEST-ONLY auth bootstrap for the Playwright browser gate. Establishes a real
 * DB-backed session for a fixture workspace user WITHOUT the dev picker, so the E2E suite can run
 * against a PRODUCTION build (where the dev picker is correctly disabled) and reuse a stable
 * storageState. `?role=viewer` bootstraps a least-privileged viewer in the same fixture tenant
 * (used to prove viewers cannot mutate the inbox).
 *
 * Fail-closed: returns 404 unless `E2E_TEST_MODE === "true"` (never set in real production).
 * It only issues a session via sanctioned paths and creates no privileged access.
 */
import { listDevLoginUsers, ensureE2EViewerUser, systemDb } from "@guardora/db";
import { startSession } from "@/server/session";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!e2eSeamEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const users = await listDevLoginUsers();
  const primary = users[0];
  if (!primary) {
    return Response.json({ ok: false, reason: "no_fixture_user" }, { status: 500 });
  }
  const tenantId = primary.memberships[0]?.tenantId;
  const wantViewer = new URL(req.url).searchParams.get("role") === "viewer";
  if (wantViewer) {
    if (!tenantId) return Response.json({ ok: false, reason: "no_fixture_tenant" }, { status: 500 });
    const viewer = await ensureE2EViewerUser(tenantId);
    await startSession(viewer.id, tenantId);
    return Response.json({ ok: true, role: "viewer" }, { status: 200 });
  }
  // V1.50C — ensure the fixture is verified so it passes the dashboard verification gate
  // (test-only; the fixture is a pre-existing dev/seed user).
  await systemDb.user.updateMany({ where: { id: primary.id, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  await startSession(primary.id);
  return Response.json({ ok: true, tenant: primary.memberships[0]?.tenant.name ?? null }, { status: 200 });
}
