/**
 * @guardora/db — Prisma client singleton.
 *
 * Run `pnpm db:generate` to generate the client before first use. In dev we
 * reuse a global instance to avoid exhausting connections on hot reload.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
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
 * SYSTEM-LEVEL client — deliberately NOT tenant-scoped (owner role). Use ONLY for
 * operations that legitimately cross tenants: worker account discovery, session
 * bootstrap, scheduled cleanup, migrations, global diagnostics. Never in a normal
 * tenant request path. Grep `systemDb` to audit every cross-tenant use.
 */
export const systemDb: PrismaClient = prisma;

export * from "@prisma/client";
export * from "./token-crypto";
export * from "./meta-account";
export * from "./session";
export * from "./tenant-db";
