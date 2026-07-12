import { deleteExpiredOnboardingSessions } from "@guardora/db";
import { log } from "./logger";

/**
 * SYSTEM cleanup — delete expired Meta onboarding sessions (short-lived discovery
 * state that holds tokens). This is genuinely global TTL garbage collection across
 * all tenants and is the sanctioned system-only exception: it runs on the owner
 * client inside `deleteExpiredOnboardingSessions` (the table has strict FORCE RLS,
 * so a tenant-scoped client with no context would delete nothing). It never mutates
 * tenant business data. No per-row audit — a summary log is sufficient.
 */
export async function cleanupExpiredOnboarding(): Promise<number> {
  const res = await deleteExpiredOnboardingSessions(new Date());
  if (res.count > 0) {
    log.info("worker.cleanup.onboarding", { deleted: res.count });
  }
  return res.count;
}
