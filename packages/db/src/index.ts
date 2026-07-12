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

export * from "@prisma/client";
export * from "./token-crypto";
export * from "./meta-account";
export * from "./session";
export * from "./tenant-db";
export * from "./repositories";
