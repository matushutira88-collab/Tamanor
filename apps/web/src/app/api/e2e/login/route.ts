/**
 * V1.39C — TEST-ONLY auth bootstrap for the Playwright browser gate. Establishes a real
 * DB-backed session for a fixture workspace user WITHOUT the dev picker, so the E2E suite
 * can run against a PRODUCTION build (where the dev picker is correctly disabled) and reuse
 * a stable storageState.
 *
 * Fail-closed: returns 404 unless `E2E_TEST_MODE === "true"` (never set in real production).
 * It only issues a session for an existing seeded user via the same sanctioned path the
 * login screen uses; it creates no privileged access and changes no business data.
 */
import { listDevLoginUsers } from "@guardora/db";
import { startSession } from "@/server/session";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!e2eSeamEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  const users = await listDevLoginUsers();
  const user = users[0];
  if (!user) {
    return Response.json({ ok: false, reason: "no_fixture_user" }, { status: 500 });
  }
  await startSession(user.id);
  return Response.json({ ok: true, tenant: user.memberships[0]?.tenant.name ?? null }, { status: 200 });
}
