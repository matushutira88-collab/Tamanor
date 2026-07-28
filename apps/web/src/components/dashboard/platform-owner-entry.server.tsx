import {
  resolvePlatformRoleDetailed,
  canViewPlatformAdminEntry,
  buildPlatformAdminEntryDiagnostic,
  platformDashboardMetrics,
} from "@guardora/db";
import { getLocale } from "@/i18n/locale-server";
import { PlatformAdminEntry } from "./platform-admin-entry";
import { PLATFORM_ADMIN_ENTRY_COPY } from "./platform-admin-entry-copy";

/**
 * Owner-only Platform Administration entry — a SELF-CONTAINED server component so it renders on EVERY workspace
 * kind's landing route (business `/dashboard`, family `/family` + `/family/onboarding`), not just the business
 * dashboard. The business `/dashboard` layout redirects non-business workspaces away before that page's JSX is
 * emitted, which is why a card living only there never reached a family-workspace owner.
 *
 * Resolves the platform role FRESH from persisted state (never the session/email/tenant role), emits the
 * PII-free PLATFORM_ADMIN_ENTRY_EVALUATED diagnostic, and renders the card ONLY for an active platform owner.
 * The /admin route guard stays entirely independent.
 */
export async function PlatformOwnerEntry({ userId, route }: { userId: string; route: string }) {
  const resolution = await resolvePlatformRoleDetailed(userId);
  const canViewEntry = canViewPlatformAdminEntry(resolution.role);
  // TEMPORARY, PII-free production diagnostic (role labels + booleans only — never email/userId/session/DB).
  console.log(JSON.stringify(buildPlatformAdminEntryDiagnostic(resolution, {
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
    route,
    canViewEntry,
  })));
  if (!canViewEntry) return null;

  const metrics = await platformDashboardMetrics(userId).catch(() => null);
  const copy = PLATFORM_ADMIN_ENTRY_COPY[await getLocale()];
  return <PlatformAdminEntry copy={copy} metrics={metrics} />;
}
