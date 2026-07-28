import { Suspense } from "react";
import { familyUnreadNotificationCount } from "@guardora/db";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { FamilyShell } from "../family-shell";
import { FamilyToaster } from "../family-feedback";
import { familyDict } from "../family-i18n";
import { familyNotifDict } from "../family-notifications-i18n";
import { familyUnreadBadge } from "../family-notification-view";
import type { FamilyBellProps } from "../family-notification-bell";

export const dynamic = "force-dynamic";

/**
 * CS-C6 — Family console layout (route group, URL stays `/family/*`). Requires a FAMILY session with
 * COMPLETED onboarding (incomplete → the onboarding wizard) and renders the Family app shell.
 */
export default async function FamilyConsoleLayout({ children }: { children: React.ReactNode }) {
  const { session, actor } = await requireFamilyConsole();
  const locale = await getLocale();
  const t = familyDict(locale);
  const tn = familyNotifDict(locale);
  // Unread bell count — FAIL-SAFE: any failure degrades to no numeric badge (the shell never crashes and never
  // exposes a raw error). Computed server-side; refreshes on every navigation / mutation (force-dynamic).
  let bell: FamilyBellProps = { ariaLabel: tn.bell.none, badgeText: "", showBadge: false };
  try {
    const unread = await familyUnreadNotificationCount(actor);
    const badge = familyUnreadBadge(unread);
    bell = { showBadge: badge.show, badgeText: badge.text, ariaLabel: badge.show ? tn.bell.label(badge.text) : tn.bell.none };
  } catch { /* fail-safe: keep the no-badge bell */ }
  return (
    <FamilyShell nav={t.nav} shell={t.shell} brand={t.brand} workspaceName={session.tenantName} userName={session.userName} bell={bell}>
      {children}
      {/* Success feedback for every Family server action, mounted once for the whole console.
          Suspense is required because the toaster reads the redirect's search params. */}
      <Suspense fallback={null}>
        <FamilyToaster strings={t.feedback} />
      </Suspense>
    </FamilyShell>
  );
}
