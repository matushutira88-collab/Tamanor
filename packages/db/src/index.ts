/**
 * @guardora/db — Prisma client singleton.
 *
 * Run `pnpm db:generate` to generate the client before first use. In dev we
 * reuse a global instance to avoid exhausting connections on hot reload.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  appDb: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * SYSTEM-LEVEL client — deliberately NOT tenant-scoped (owner role, DATABASE_URL).
 * Use ONLY for operations that legitimately cross tenants: worker account
 * discovery, session bootstrap, scheduled cleanup, migrations, global diagnostics.
 * Never in a normal tenant request path. Grep `systemDb` to audit every use.
 */
export const systemDb: PrismaClient = prisma;

/**
 * V1.37.3 — RUNTIME tenant client. Connects as the NON-superuser, NON-bypassrls
 * role (`APP_DATABASE_URL` → tamanor_app) so Postgres RLS is enforced. This is the
 * client `withTenantDb()` uses; tenant queries MUST go through `withTenantDb`.
 *
 * Fail-closed in production: APP_DATABASE_URL is required and must differ from
 * DATABASE_URL. In dev/test it falls back to the owner client with a LOUD warning
 * (never silent) so RLS is only bypassed on an explicitly-unconfigured machine.
 */
function resolveAppClient(): PrismaClient {
  const appUrl = process.env.APP_DATABASE_URL;
  const dbUrl = process.env.DATABASE_URL;
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (!appUrl) throw new Error("APP_DATABASE_URL is required in production (RLS-enforcing runtime role).");
    if (appUrl === dbUrl) throw new Error("APP_DATABASE_URL must differ from DATABASE_URL — it must be the non-superuser tamanor_app role.");
    return new PrismaClient({ datasourceUrl: appUrl, log: ["error"] });
  }
  if (appUrl && appUrl !== dbUrl) {
    return new PrismaClient({ datasourceUrl: appUrl, log: ["warn", "error"] });
  }
  // eslint-disable-next-line no-console
  console.warn("[db] APP_DATABASE_URL not set (or equals DATABASE_URL) — tenant runtime falls back to the OWNER client; RLS is BYPASSED. Set APP_DATABASE_URL to the tamanor_app role to enforce RLS.");
  return prisma;
}

/**
 * The runtime client is resolved LAZILY on first use, never at module load. This
 * matters because `resolveAppClient()` fails closed in production (throws if
 * APP_DATABASE_URL is missing/equal to owner). Evaluating it eagerly would crash
 * `next build` and any import-time evaluation where the DB env isn't present yet.
 * A Proxy defers creation to the first real query (a request/worker path), where
 * the environment is fully loaded.
 */
function getAppDb(): PrismaClient {
  if (!globalForPrisma.appDb) {
    globalForPrisma.appDb = resolveAppClient();
  }
  return globalForPrisma.appDb;
}

export const appDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getAppDb();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * V1.58.7 — gracefully disconnect BOTH Prisma clients (owner systemDb + the lazily-created RLS appDb)
 * during worker shutdown. Best-effort (allSettled) — a disconnect error must never block process exit.
 * The appDb is disconnected only if it was ever instantiated (the Proxy defers creation to first use).
 */
export async function closeDbClients(): Promise<void> {
  await Promise.allSettled([
    prisma.$disconnect(),
    globalForPrisma.appDb ? globalForPrisma.appDb.$disconnect() : Promise.resolve(),
  ]);
}

export * from "@prisma/client";
export * from "./token-crypto";
export * from "./meta-account";
export * from "./session";
export * from "./password";
export * from "./registration";
export * from "./auth-tokens";
export * from "./billing-repo";
export * from "./resource-limits";
export * from "./export-repo";
export * from "./notification-repo";
export * from "./notification-email";
export * from "./team-repo";
export * from "./tenant-db";
export * from "./repositories";
export * from "./security-detection";
export * from "./evidence-integrity";
export * from "./evidence-storage";
export * from "./evidence-antivirus";
export * from "./cyberbullying-incident";
export * from "./cyberbullying-evidence-upload";
export * from "./cyberbullying-detection-triage";
export * from "./cyberbullying-case-management";
export * from "./cyberbullying-notifications";
export * from "./cyberbullying-escalation";
export * from "./cyberbullying-sla";
export * from "./cyberbullying-compliance";
export * from "./cyberbullying-redaction";
export * from "./child-safety-family";
export * from "./child-safety-consent";
export * from "./inbox-repo";
export * from "./usage-repo";
export * from "./global-usage-repo";
export * from "./platform-repo";
export * from "./sync-lease";
export * from "./session-mgmt";
export * from "./account-protection";
export * from "./onboarding";
export * from "./dashboard-metrics";
export * from "./tenant-lifecycle";
export * from "./tenant-deletion";
export * from "./user-deletion";
export * from "./webhook-retention";
