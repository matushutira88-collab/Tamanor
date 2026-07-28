/**
 * TEST-ONLY seam: set the primary E2E fixture user's platformRole so the browser suite can prove the owner-only
 * dashboard entry card. Fail-closed: 404 unless E2E_TEST_MODE === "true" (never enabled in a real deploy). Only
 * `owner` or `none` are accepted, and the spec RESTORES `none` in teardown so the shared fixture returns to its
 * baseline (other auth specs rely on platformRole=none). It never changes authorization logic — only the fixture
 * row — and clears platformAccessRevokedAt so a promoted owner is active. No PII in/out.
 */
import { listDevLoginUsers, systemDb, PlatformRole } from "@guardora/db";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!e2eSeamEnabled()) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = body.role;
  if (role !== "owner" && role !== "none") return Response.json({ error: "bad_role" }, { status: 400 });

  const users = await listDevLoginUsers();
  const primary = users[0];
  if (!primary) return Response.json({ error: "no_fixture_user" }, { status: 500 });

  await systemDb.user.update({
    where: { id: primary.id },
    data: { platformRole: role as PlatformRole, platformAccessRevokedAt: null },
  });
  return Response.json({ ok: true, role });
}
