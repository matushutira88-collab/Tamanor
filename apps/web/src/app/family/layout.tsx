import type { Metadata } from "next";
import { requireFamilyActor } from "@/server/family-guard";

export const metadata: Metadata = { title: "Tamanor Family", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C6/6.1 — Family route group guard. Every `/family/*` route requires an active, verified session in a
 * FAMILY workspace (server-authoritative). A non-family session is routed by the CENTRAL resolver inside
 * requireFamilyActor — Business → /dashboard, unknown/corrupt/unsupported → /unsupported-workspace. There
 * is NO Business fallback for an unknown kind.
 */
export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  await requireFamilyActor();
  return <>{children}</>;
}
