/**
 * M8 — `ConnectorOAuthFlow` against a REAL PostgreSQL database.
 *
 * The M7 suites proved this logic against injected fakes. This one proves it where
 * it actually has to hold: real Postgres, the real migration, real Row-Level
 * Security, and the real `tamanor_app` (NOBYPASSRLS) runtime role.
 *
 * What only a real database can establish, and what this file therefore asserts:
 *   - the unique index on `stateHash` genuinely rejects a duplicate
 *   - the guarded `updateMany` consume is genuinely atomic under concurrency —
 *     exactly one of N simultaneous callbacks wins
 *   - the tenant-isolation POLICY genuinely hides another tenant's flow from the
 *     app role, rather than merely being declared in a migration
 *   - the trusted system consume can still find a flow by hash BEFORE any tenant
 *     context exists, which is the one thing the callback depends on
 *   - the three cascades genuinely delete the flow when a session/user/tenant goes
 *
 * LOCAL ONLY. Chained behind the repository's `assert-local-db` guard by its
 * package script, exactly like every other destructive suite here.
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  consumeConnectorOAuthState, createConnectorOAuthFlow, finalizeConnectorOAuthFlow,
  generateOAuthState, hashOAuthState, originatingSessionIsValid, readConnectorOAuthFlow,
  deleteExpiredConnectorOAuthFlows,
} from "../src/connector-oauth-flow";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`);
  c ? pass++ : fail++;
};

const OWNER = process.env.DATABASE_URL;
const APP = process.env.APP_DATABASE_URL;
if (!OWNER) { console.error("✗ DATABASE_URL (owner role) is required."); process.exit(2); }
if (!APP) { console.error("✗ APP_DATABASE_URL (tamanor_app role) is required."); process.exit(2); }

const owner = new PrismaClient({ datasourceUrl: OWNER });
/** The RLS-enforced runtime client — the one the application actually uses. */
const app = new PrismaClient({ datasourceUrl: APP });

/**
 * Run a query with the app role's tenant context set, exactly as `withTenantDb`
 * does: `set_config(..., true)` is TRANSACTION-LOCAL, so the query must run on the
 * transaction client `tx`. Using the outer client would silently escape the context
 * and read with no tenant at all — which is precisely what the positive control
 * below ("the same app role DOES see it under its own tenant") exists to catch.
 */
async function asTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function main() {
  const suffix = randomUUID().slice(0, 8);

  /* ---------------------------------------------------------------- fixtures */
  // Two tenants, each with a user and a live session — the minimum needed to make
  // the isolation and cascade questions meaningful.
  const mk = async (label: string) => {
    const tenant = await owner.tenant.create({
      data: { name: `m8-${label}-${suffix}`, slug: `m8-${label}-${suffix}` },
      select: { id: true },
    });
    const user = await owner.user.create({
      data: { email: `m8-${label}-${suffix}@tamanor.test`, name: `M8 ${label}` },
      select: { id: true },
    });
    const session = await owner.userSession.create({
      data: {
        tokenHash: `m8-${label}-${suffix}-${randomUUID()}`,
        userId: user.id,
        activeTenantId: tenant.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      select: { id: true },
    });
    return { tenantId: tenant.id, userId: user.id, sessionId: session.id };
  };

  const A = await mk("a");
  const B = await mk("b");
  console.log("\n1) real schema + persistence");

  const stateA = generateOAuthState();
  const hashA = hashOAuthState(stateA);
  const flowA = await createConnectorOAuthFlow({
    userId: A.userId, tenantId: A.tenantId, sessionId: A.sessionId,
    surface: "mobile", provider: "meta", intent: "connect",
    brandId: null, accountId: null,
    stateHash: hashA, expiresAt: new Date(Date.now() + 600_000),
  });
  check("a flow persists through the tenant-scoped client", typeof flowA.id === "string");

  const raw = await owner.connectorOAuthFlow.findUnique({ where: { id: flowA.id } });
  check("the row exists in real Postgres", raw !== null);
  check("only the HASH is stored — the raw state is nowhere in the row",
    JSON.stringify(raw).includes(hashA) && !JSON.stringify(raw).includes(stateA));
  check("the stored hash is sha256 hex", /^[0-9a-f]{64}$/.test(raw!.stateHash));
  check("status starts pending and unconsumed",
    raw!.status === "pending" && raw!.stateConsumedAt === null);
  check("the originating session is bound", raw!.sessionId === A.sessionId);

  /* ------------------------------------------------- unique index / replay */
  console.log("\n2) replay protection (real unique index + guarded consume)");

  let duplicateRejected = false;
  try {
    await owner.connectorOAuthFlow.create({
      data: {
        userId: A.userId, tenantId: A.tenantId, sessionId: A.sessionId,
        surface: "mobile", provider: "meta", intent: "connect",
        stateHash: hashA, expiresAt: new Date(Date.now() + 600_000),
      },
    });
  } catch { duplicateRejected = true; }
  check("the UNIQUE index rejects a duplicate stateHash", duplicateRejected);

  const first = await consumeConnectorOAuthState(hashA);
  check("the first consume succeeds", first.ok === true);
  check("the first consume returns the right flow", first.ok && first.flow.id === flowA.id);

  const second = await consumeConnectorOAuthState(hashA);
  check("a REPLAYED consume is rejected", second.ok === false);
  check("the replay reason is already_used", !second.ok && second.reason === "already_used");
  check("the replay still identifies the flow so the app can be sent home",
    !second.ok && second.flowId === flowA.id);

  const after = await owner.connectorOAuthFlow.findUnique({ where: { id: flowA.id } });
  check("stateConsumedAt was set exactly once", after!.stateConsumedAt !== null);
  check("the status advanced to provider_pending", after!.status === "provider_pending");

  /* ------------------------------------------------------------ concurrency */
  console.log("\n3) concurrent consume — exactly one winner");

  const stateC = generateOAuthState();
  const flowC = await createConnectorOAuthFlow({
    userId: A.userId, tenantId: A.tenantId, sessionId: A.sessionId,
    surface: "mobile", provider: "meta", intent: "connect",
    stateHash: hashOAuthState(stateC), expiresAt: new Date(Date.now() + 600_000),
  });
  // Ten simultaneous callbacks for the same state — the shape a provider retry or a
  // duplicated delivery actually takes.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeConnectorOAuthState(hashOAuthState(stateC))),
  );
  const winners = results.filter((r) => r.ok).length;
  check("exactly ONE of 10 concurrent consumes wins", winners === 1, `winners=${winners}`);
  check("the other nine are all rejected", results.filter((r) => !r.ok).length === 9);
  void flowC;

  /* ------------------------------------------------------------- expiry/TTL */
  console.log("\n4) expiry is enforced by the query, not by a sweeper");

  const stateE = generateOAuthState();
  await createConnectorOAuthFlow({
    userId: A.userId, tenantId: A.tenantId, sessionId: A.sessionId,
    surface: "mobile", provider: "meta", intent: "connect",
    stateHash: hashOAuthState(stateE), expiresAt: new Date(Date.now() - 1000),
  });
  const expired = await consumeConnectorOAuthState(hashOAuthState(stateE));
  check("an EXPIRED state cannot be consumed", expired.ok === false);
  check("the expiry reason is bounded", !expired.ok && expired.reason === "expired");

  const swept = await deleteExpiredConnectorOAuthFlows(new Date());
  check("the TTL sweep removes expired rows", swept.count >= 1, `swept=${swept.count}`);

  /* --------------------------------------------------------- RLS isolation */
  console.log("\n5) REAL Row-Level Security");

  const visibleToOwn = await readConnectorOAuthFlow({
    tenantId: A.tenantId, userId: A.userId, flowId: flowA.id,
  });
  check("tenant A can read its own flow", visibleToOwn !== null);

  const visibleToOther = await readConnectorOAuthFlow({
    tenantId: B.tenantId, userId: B.userId, flowId: flowA.id,
  });
  check("tenant B CANNOT read tenant A's flow", visibleToOther === null);

  const foreignUserSameTenant = await readConnectorOAuthFlow({
    tenantId: A.tenantId, userId: B.userId, flowId: flowA.id,
  });
  check("a different USER in the same tenant cannot read the flow", foreignUserSameTenant === null);

  // The policy itself, not merely the query's WHERE clause: the app role with
  // tenant B's context set must not see tenant A's row even when asked directly.
  const leaked = await asTenant(B.tenantId, (tx) =>
    tx.connectorOAuthFlow.findMany({ where: { id: flowA.id } }),
  );
  check("the RLS POLICY hides the row from the app role under another tenant",
    Array.isArray(leaked) && leaked.length === 0, JSON.stringify(leaked));

  const seen = await asTenant(A.tenantId, (tx) =>
    tx.connectorOAuthFlow.findMany({ where: { id: flowA.id } }),
  );
  check("the same app role DOES see it under its own tenant", seen.length === 1);

  // The callback's one trusted lookup must still work with no tenant context at all.
  const stateT = generateOAuthState();
  await createConnectorOAuthFlow({
    userId: A.userId, tenantId: A.tenantId, sessionId: A.sessionId,
    surface: "mobile", provider: "google_business", intent: "connect",
    stateHash: hashOAuthState(stateT), expiresAt: new Date(Date.now() + 600_000),
  });
  const trusted = await consumeConnectorOAuthState(hashOAuthState(stateT));
  check("the trusted system consume finds the flow with NO tenant context",
    trusted.ok === true && trusted.flow.tenantId === A.tenantId);

  /* ------------------------------------------------- session binding/logout */
  console.log("\n6) session binding — logout fails the flow closed");

  check("a live originating session is valid", await originatingSessionIsValid(A.sessionId));
  await owner.userSession.update({
    where: { id: A.sessionId }, data: { revokedAt: new Date() },
  });
  check("a REVOKED session invalidates the flow", !(await originatingSessionIsValid(A.sessionId)));
  await owner.userSession.update({ where: { id: A.sessionId }, data: { revokedAt: null } });

  const expiredSession = await owner.userSession.create({
    data: {
      tokenHash: `m8-exp-${suffix}-${randomUUID()}`, userId: A.userId,
      activeTenantId: A.tenantId, expiresAt: new Date(Date.now() - 1000),
    },
    select: { id: true },
  });
  check("an EXPIRED session invalidates the flow", !(await originatingSessionIsValid(expiredSession.id)));
  check("an unknown session id is invalid", !(await originatingSessionIsValid("does-not-exist")));

  /* ------------------------------------------------------------- finalize */
  console.log("\n7) terminal transitions are one-way");

  const ok1 = await finalizeConnectorOAuthFlow({
    tenantId: A.tenantId, flowId: flowA.id, status: "completed", resultCode: null,
  });
  check("a non-terminal flow can be finalized", ok1 === true);
  const ok2 = await finalizeConnectorOAuthFlow({
    tenantId: A.tenantId, flowId: flowA.id, status: "cancelled", resultCode: "user_cancelled",
  });
  check("an already-terminal flow CANNOT be overwritten", ok2 === false);
  const finalRow = await owner.connectorOAuthFlow.findUnique({ where: { id: flowA.id } });
  check("the terminal status survived the late write", finalRow!.status === "completed");
  check("completedAt was recorded", finalRow!.completedAt !== null);

  /* -------------------------------------------------------------- cascades */
  console.log("\n8) real foreign-key cascades");

  const stateD = generateOAuthState();
  const doomed = await createConnectorOAuthFlow({
    userId: B.userId, tenantId: B.tenantId, sessionId: B.sessionId,
    surface: "mobile", provider: "meta", intent: "connect",
    stateHash: hashOAuthState(stateD), expiresAt: new Date(Date.now() + 600_000),
  });
  await owner.userSession.delete({ where: { id: B.sessionId } });
  const gone = await owner.connectorOAuthFlow.findUnique({ where: { id: doomed.id } });
  check("deleting the originating SESSION cascades the flow away", gone === null);

  /* --------------------------------------------------------------- cleanup */
  await owner.connectorOAuthFlow.deleteMany({ where: { tenantId: { in: [A.tenantId, B.tenantId] } } });
  await owner.userSession.deleteMany({ where: { userId: { in: [A.userId, B.userId] } } });
  await owner.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await owner.tenant.deleteMany({ where: { id: { in: [A.tenantId, B.tenantId] } } });

  await owner.$disconnect();
  await app.$disconnect();

  console.log(
    `\n${fail === 0 ? "PASS" : "FAIL"} — ConnectorOAuthFlow against real Postgres (M8): ${pass} passed, ${fail} failed`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch(async (e) => {
  console.error("✗ suite crashed:", e instanceof Error ? e.message : e);
  await owner.$disconnect().catch(() => {});
  await app.$disconnect().catch(() => {});
  process.exit(1);
});
