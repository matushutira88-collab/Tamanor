import type { Metadata } from "next";
import { requireFamilyActor } from "@/server/family-guard";
import { PlatformOwnerEntry } from "@/components/dashboard/platform-owner-entry.server";

export const metadata: Metadata = { title: "Tamanor Family", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C6/6.1 — Family route group guard. Every `/family/*` route requires an active, verified session in a
 * FAMILY workspace (server-authoritative). A non-family session is routed by the CENTRAL resolver inside
 * requireFamilyActor — Business → /dashboard, unknown/corrupt/unsupported → /unsupported-workspace. There
 * is NO Business fallback for an unknown kind.
 */
export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requireFamilyActor();
  return (
    <>
      {/* Owner-only Platform Administration entry. A platform owner in a FAMILY workspace is redirected off
          /dashboard to /family(/onboarding), so the card is mounted on the family route group here (one place,
          covering console + onboarding). Renders NULL for the ~all non-owner family users (no empty wrapper). */}
      <PlatformOwnerEntry userId={session.userId} route="/family" />
      {children}
    </>
  );
}
