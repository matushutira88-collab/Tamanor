/**
 * V1.57.3A — EXECUTABLE, DATABASE-BACKED checkout concurrency tests.
 *
 * These are NOT source-pattern checks: they open genuinely concurrent database transactions against a
 * REAL Postgres and assert the durable-reservation invariants (one live attempt per tenant, single
 * Stripe session, cross-tenant RLS isolation, crash/timeout recovery). Only the Stripe HTTP boundary
 * is mocked — the reservation transaction, the partial unique index, the advisory lock, the status
 * guard and RLS all run for real.
 *
 * SAFETY: refuses to run unless DATABASE_URL points at a LOCAL Postgres. Never run against production.
 * Run:  scripts/run-checkout-concurrency.sh   (spins up a throwaway local Postgres container)
 */
import { PrismaClient } from "@prisma/client";
import {
  systemDb,
  reserveCheckoutAttempt, markCheckoutAttemptOpen, markCheckoutAttemptFailed,
  completeCheckoutAttemptBySession, expireCheckoutAttemptBySession,
} from "../src/index";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:\/]/.test(DB)) {
  console.error("✗ REFUSING TO RUN: checkout-concurrency.test.ts requires a LOCAL Postgres (localhost/127.0.0.1).");
  console.error("  DATABASE_URL host is not local — never run this mutating concurrency suite against production.");
  process.exit(2);
}

let passed = 0, failed = 0;
function assert(cond: boolean, label: string, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? passed++ : failed++;
}

// ── Stripe HTTP boundary mock (the ONLY mocked component) ───────────────────────────────────────
type FailMode = "connection" | "definitive" | undefined;
function makeStripe(opts: { expiresAt?: Date } = {}) {
  const byKey = new Map<string, { id: string; url: string; expiresAt: Date }>();
  let uniqueCreates = 0;
  return {
    uniqueCreates: () => uniqueCreates,
    /** Deduplicates on idempotency key exactly like Stripe: same key → same session, no new create. */
    async createSession(key: string, _priceId: string, failMode: FailMode = undefined) {
      if (byKey.has(key)) return byKey.get(key)!; // idempotent replay — NO new session
      if (failMode === "definitive") { const e = new Error("bad request") as Error & { type: string }; e.type = "StripeInvalidRequestError"; throw e; }
      uniqueCreates++;
      const session = { id: `cs_${uniqueCreates}_${key.slice(-8)}`, url: `https://checkout.stripe.test/${uniqueCreates}`, expiresAt: opts.expiresAt ?? new Date(Date.now() + 3600_000) };
      byKey.set(key, session); // session now exists at "Stripe" even if the response is then lost
      if (failMode === "connection") { const e = new Error("network timeout") as Error & { type: string }; e.type = "StripeConnectionError"; throw e; }
      return session;
    },
  };
}
type Stripe = ReturnType<typeof makeStripe>;

// ── Faithful re-implementation of service.ts::createCheckout (reservation → drive) ───────────────
async function drive(tenantId: string, attemptId: string, key: string, priceId: string, stripe: Stripe, failMode: FailMode) {
  try {
    const session = await stripe.createSession(key, priceId, failMode);
    await markCheckoutAttemptOpen({ attemptId, tenantId, sessionId: session.id, url: session.url, sessionExpiresAt: session.expiresAt });
    return { outcome: "created" as const, sessionId: session.id, key };
  } catch (err) {
    const type = (err as { type?: string }).type ?? "";
    const definitive = type === "StripeInvalidRequestError" || type === "StripeAuthenticationError";
    if (definitive) await markCheckoutAttemptFailed({ attemptId, tenantId, failureCode: type });
    return { outcome: "failed" as const, key, definitive };
  }
}
async function simulateCheckout(tenantId: string, a: { plan: string; interval: string; priceId: string; userId?: string; stripe: Stripe; failMode?: FailMode }) {
  const r = await reserveCheckoutAttempt({ tenantId, userId: a.userId ?? null, plan: a.plan, interval: a.interval, priceId: a.priceId });
  if (r.kind === "blocked") return { outcome: "blocked" as const, reason: r.reason };
  if (r.kind === "existing") {
    if (!r.samePlan) return { outcome: "existing_blocked" as const };
    if (r.url) return { outcome: "reused_url" as const, url: r.url };
    return drive(tenantId, r.attemptId, r.idempotencyKey, a.priceId, a.stripe, a.failMode);
  }
  return drive(tenantId, r.attemptId, r.idempotencyKey, a.priceId, a.stripe, a.failMode);
}

const countLive = (tenantId: string) =>
  systemDb.stripeCheckoutAttempt.count({ where: { tenantId, status: { in: ["CREATING", "OPEN"] } } });

const STARTER = { plan: "starter", interval: "monthly", priceId: "price_sm" };
const GROWTH = { plan: "growth", interval: "monthly", priceId: "price_gm" };

const createdTenants: string[] = [];
async function newTenant(tag: string): Promise<string> {
  const t = await systemDb.tenant.create({ data: { name: `conc ${tag}`, slug: `conc-${tag}-${Math.floor(Math.random() * 1e9)}` }, select: { id: true } });
  createdTenants.push(t.id);
  return t.id;
}

async function run() {
  console.log(`\nDatabase: LOCAL (${DB.replace(/:\/\/[^@]*@/, "://***@")})`);
  console.log("Concurrency: genuine — Promise.all over separate pooled connections/transactions.\n");
  try {
    // 1) same tenant + same plan, concurrent → one live attempt, one Stripe session
    {
      const t = await newTenant("same"); const s = makeStripe();
      const [a, b] = await Promise.all([simulateCheckout(t, { ...STARTER, stripe: s }), simulateCheckout(t, { ...STARTER, stripe: s })]);
      assert((await countLive(t)) === 1 && s.uniqueCreates() === 1, "1) same tenant + same plan (concurrent): exactly one live attempt, one Stripe session", `live=${await countLive(t)} creates=${s.uniqueCreates()}`);
      assert([a.outcome, b.outcome].every((o) => o === "created" || o === "reused_url"), "   both callers receive a usable checkout outcome", `${a.outcome}/${b.outcome}`);
    }
    // 2) same tenant + different plans, concurrent → one live attempt, one session, other blocked
    {
      const t = await newTenant("diff"); const s = makeStripe();
      const [a, b] = await Promise.all([simulateCheckout(t, { ...STARTER, stripe: s }), simulateCheckout(t, { ...GROWTH, stripe: s })]);
      const outcomes = [a.outcome, b.outcome].sort().join(",");
      assert((await countLive(t)) === 1 && s.uniqueCreates() === 1, "2) same tenant + DIFFERENT plans (concurrent): exactly one live attempt, one Stripe session", `live=${await countLive(t)} creates=${s.uniqueCreates()}`);
      assert(outcomes === "created,existing_blocked", "   one created, the other blocked (no parallel different-plan session)", outcomes);
    }
    // 3) different tenants, concurrent → both independent, no cross-blocking
    {
      const t1 = await newTenant("indA"); const t2 = await newTenant("indB"); const s = makeStripe();
      const [a, b] = await Promise.all([simulateCheckout(t1, { ...STARTER, stripe: s }), simulateCheckout(t2, { ...STARTER, stripe: s })]);
      assert(a.outcome === "created" && b.outcome === "created" && s.uniqueCreates() === 2, "3) different tenants (concurrent): both succeed independently, two sessions", `${a.outcome}/${b.outcome} creates=${s.uniqueCreates()}`);
      assert((await countLive(t1)) === 1 && (await countLive(t2)) === 1, "   one live attempt per tenant, no cross-tenant blocking");
    }
    // 4) crash after reservation, before Stripe → stale CREATING expires, recovery allowed
    {
      const t = await newTenant("crash"); const base = Date.now();
      const r1 = await reserveCheckoutAttempt({ tenantId: t, userId: null, ...STARTER, creatingTtlMs: 1000, now: new Date(base) }); // then "crash" (no drive)
      const r2 = await reserveCheckoutAttempt({ tenantId: t, userId: null, ...STARTER, creatingTtlMs: 1000, now: new Date(base + 5000) });
      assert(r1.kind === "reserved" && r2.kind === "reserved" && r1.attemptId !== r2.attemptId, "4) crash before Stripe: stale CREATING expires, a later request recovers with a new attempt", `${r1.kind}/${r2.kind}`);
      assert((await countLive(t)) === 1, "   exactly one live attempt after recovery (old one EXPIRED)");
    }
    // 5) Stripe timeout after session may exist → retry reuses SAME key, NO duplicate session
    {
      const t = await newTenant("ambig"); const s = makeStripe();
      const first = await simulateCheckout(t, { ...STARTER, stripe: s, failMode: "connection" });
      assert(first.outcome === "failed" && !("definitive" in first && first.definitive) && s.uniqueCreates() === 1, "5) ambiguous Stripe timeout: attempt stays live, session created once", `${first.outcome} creates=${s.uniqueCreates()}`);
      const retry = await simulateCheckout(t, { ...STARTER, stripe: s });
      assert(retry.outcome === "created" && s.uniqueCreates() === 1, "   retry reuses the SAME attempt key → Stripe dedupes → NO duplicate session", `${retry.outcome} creates=${s.uniqueCreates()}`);
      assert((await countLive(t)) === 1, "   still exactly one live attempt");
    }
    // 6) existing OPEN attempt → repeat reuses URL; different plan does not create another
    {
      const t = await newTenant("open"); const s = makeStripe();
      await simulateCheckout(t, { ...STARTER, stripe: s });
      const same = await simulateCheckout(t, { ...STARTER, stripe: s });
      const other = await simulateCheckout(t, { ...GROWTH, stripe: s });
      assert(same.outcome === "reused_url" && s.uniqueCreates() === 1, "6) existing OPEN: same-plan repeat reuses the open session URL (no new session)", `${same.outcome} creates=${s.uniqueCreates()}`);
      assert(other.outcome === "existing_blocked" && s.uniqueCreates() === 1, "   different-plan request does not create a parallel session", `${other.outcome} creates=${s.uniqueCreates()}`);
    }
    // 7) expired OPEN attempt → atomically expires, permits exactly one new
    {
      const t = await newTenant("expOpen"); const s = makeStripe({ expiresAt: new Date(Date.now() - 1000) }); // session URL already expired
      await simulateCheckout(t, { ...STARTER, stripe: s });
      const again = await simulateCheckout(t, { ...STARTER, stripe: s });
      assert(again.outcome === "created" && s.uniqueCreates() === 2, "7) expired OPEN: old attempt expires atomically, exactly one new attempt permitted", `${again.outcome} creates=${s.uniqueCreates()}`);
      assert((await countLive(t)) === 1, "   exactly one live attempt after re-open");
    }
    // 8) active / trialing / past_due / incomplete subscription → no attempt, no Stripe call
    {
      for (const status of ["active", "trialing", "past_due", "incomplete"]) {
        const t = await newTenant(`sub-${status}`); const s = makeStripe();
        await systemDb.subscription.create({ data: { tenantId: t, stripeCustomerId: `cus_${t}`, plan: "starter", status, currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } });
        const r = await simulateCheckout(t, { ...STARTER, stripe: s });
        assert(r.outcome === "blocked" && s.uniqueCreates() === 0 && (await countLive(t)) === 0, `8) ${status} subscription: checkout blocked, no Stripe call, no attempt row`, `${r.outcome} creates=${s.uniqueCreates()} live=${await countLive(t)}`);
      }
    }
    // 9) webhook completion → attempt COMPLETED; subscription remains the entitlement source
    {
      const t = await newTenant("wh"); const s = makeStripe();
      const r = await simulateCheckout(t, { ...STARTER, stripe: s });
      await completeCheckoutAttemptBySession((r as { sessionId: string }).sessionId);
      const a = await systemDb.stripeCheckoutAttempt.findFirst({ where: { tenantId: t }, orderBy: { createdAt: "desc" } });
      assert(a?.status === "COMPLETED" && a?.completedAt != null && (await countLive(t)) === 0, "9) webhook checkout.session.completed → attempt COMPLETED, no live attempt", `status=${a?.status}`);
      // Entitlement is NOT granted from the attempt row: no subscription row was created by completing it.
      assert((await systemDb.subscription.findUnique({ where: { tenantId: t } })) === null, "   completing the attempt does NOT create/grant a subscription (Subscription stays the source of truth)");
    }
    // 9b) checkout.session.expired webhook → attempt EXPIRED
    {
      const t = await newTenant("whExp"); const s = makeStripe();
      const r = await simulateCheckout(t, { ...STARTER, stripe: s });
      await expireCheckoutAttemptBySession((r as { sessionId: string }).sessionId);
      assert((await countLive(t)) === 0, "9b) webhook checkout.session.expired → attempt EXPIRED (frees the tenant)");
    }
    // 10) cross-tenant attempt IDs cannot be read or mutated (RLS FORCE + tenant_isolation policy).
    //     MUST run through the restricted tamanor_app role (NOSUPERUSER NOBYPASSRLS) — the superuser
    //     systemDb bypasses RLS by design, so RLS is only meaningful via the runtime app role.
    {
      const appUrl = process.env.APP_DATABASE_URL;
      if (!appUrl) {
        assert(false, "10) RLS test SKIPPED — APP_DATABASE_URL (tamanor_app role) not provided", "runner must export it");
      } else {
        const owner = await newTenant("rlsOwner"); const other = await newTenant("rlsOther");
        await simulateCheckout(owner, { ...STARTER, stripe: makeStripe() });
        const attempt = await systemDb.stripeCheckoutAttempt.findFirst({ where: { tenantId: owner }, select: { id: true } });
        const id = attempt!.id;
        const appDb = new PrismaClient({ datasourceUrl: appUrl });
        try {
          await appDb.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${other}, true)`; // OTHER tenant's context
            const visible = await tx.stripeCheckoutAttempt.findMany({ where: { id } });
            const upd = await tx.stripeCheckoutAttempt.updateMany({ where: { id }, data: { status: "ABANDONED" } });
            assert(visible.length === 0 && upd.count === 0, "10) cross-tenant attempt is INVISIBLE and IMMUTABLE under RLS (via tamanor_app role)", `visible=${visible.length} updated=${upd.count}`);
          });
        } finally {
          await appDb.$disconnect();
        }
        const still = await systemDb.stripeCheckoutAttempt.findUnique({ where: { id }, select: { status: true } });
        assert(still?.status !== "ABANDONED", "   owner's attempt row is untouched by the cross-tenant write");
      }
    }
  } finally {
    // Clean up every tenant this suite created (cascade removes attempts + subscriptions).
    for (const id of createdTenants) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
  }

  console.log(`\n${failed === 0 ? "PASS" : `FAIL (${failed})`} — checkout concurrency (V1.57.3A): ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
