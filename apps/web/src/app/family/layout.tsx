import type { Metadata } from "next";
import { requireFamilyActor } from "@/server/family-guard";

export const metadata: Metadata = { title: "Tamanor Family", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C6 — Family route group guard. Every `/family/*` route requires an active, verified session in a
 * FAMILY workspace (server-authoritative). Non-family workspaces are redirected to /dashboard here.
 */
export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  await requireFamilyActor();
  return <>{children}</>;
}
