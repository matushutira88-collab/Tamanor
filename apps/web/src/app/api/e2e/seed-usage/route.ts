/**
 * V1.44 — TEST-ONLY deterministic usage fixture. Sets the signed-in fixture tenant's CURRENT period
 * counters to a known state so the browser gate can verify the usage card's normal/warning/critical/
 * exhausted rendering and the fail-closed behaviour. Fail-closed: 404 unless E2E_TEST_MODE === "true".
 * Uses withTenant (RLS) only — never systemDb; touches only usage counters (no AI, no provider).
 */
import { getSession } from "@/server/auth";
import { withTenant, getOrCreateCurrentPeriod } from "@guardora/db";
import { e2eSeamEnabled } from "@/lib/e2e-seam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free policy anchors: 500 basic / 10 premium calls / 200000 micros.
const DEFAULT_STATE = { basic: 100, calls: 1, cost: 20_000 };
const STATES: Record<string, { basic: number; calls: number; cost: number }> = {
  normal: { basic: 100, calls: 1, cost: 20_000 },
  "50": { basic: 250, calls: 5, cost: 100_000 },
  "80": { basic: 400, calls: 8, cost: 160_000 },
  basic_exhausted: { basic: 500, calls: 2, cost: 40_000 },
  premium_calls_exhausted: { basic: 120, calls: 10, cost: 60_000 },
  premium_cost_exhausted: { basic: 120, calls: 6, cost: 200_000 },
};

export async function POST(req: Request) {
  if (!e2eSeamEnabled()) return new Response("Not found", { status: 404 });
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = session.tenantId;
  const stateKey = new URL(req.url).searchParams.get("state") ?? "normal";
  const s = STATES[stateKey] ?? DEFAULT_STATE;

  await getOrCreateCurrentPeriod(tenantId, "free");
  await withTenant(tenantId, (db) => db.usagePeriod.updateMany({
    where: { tenantId },
    data: { basicUnitsUsed: s.basic, premiumCallsUsed: s.calls, premiumCostMicros: BigInt(s.cost) },
  }));

  return Response.json({ ok: true, state: stateKey, ...s }, { status: 200 });
}
