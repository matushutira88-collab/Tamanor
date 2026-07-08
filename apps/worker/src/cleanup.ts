import { prisma } from "@guardora/db";
import { log } from "./logger";

/**
 * Delete expired Meta onboarding sessions (short-lived discovery state that
 * holds tokens). No per-row audit — a summary log is sufficient.
 */
export async function cleanupExpiredOnboarding(): Promise<number> {
  const res = await prisma.metaOnboardingSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (res.count > 0) {
    log.info("worker.cleanup.onboarding", { deleted: res.count });
  }
  return res.count;
}
