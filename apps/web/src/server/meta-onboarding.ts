import "server-only";
import { cookies } from "next/headers";
import type { MetaDiscoveredPage } from "@guardora/connectors";
import { prisma } from "./db";
import type { AppSession } from "./auth";

export const ONBOARDING_COOKIE = "meta_onboarding";

/** A page as shown in the selection UI — WITHOUT any token material. */
export interface SelectablePage {
  pageId: string;
  name: string;
  category?: string;
  hasInstagram: boolean;
  igBusinessId?: string;
  igUsername?: string;
}

export interface OnboardingView {
  id: string;
  brandId: string;
  brandName: string;
  grantedScopes: string[];
  pages: SelectablePage[];
}

function sanitize(pages: MetaDiscoveredPage[]): SelectablePage[] {
  return pages.map((p) => ({
    pageId: p.pageId,
    name: p.name,
    category: p.category,
    hasInstagram: Boolean(p.igBusinessId),
    igBusinessId: p.igBusinessId,
    igUsername: p.igUsername,
  }));
}

/**
 * Load the current onboarding session for the UI, validated against the caller's
 * tenant + user and not expired. Returns null if missing/expired — the selection
 * page then shows an "expired flow" state. Tokens are stripped before returning.
 */
export async function loadOnboardingForUi(
  session: AppSession,
): Promise<OnboardingView | null> {
  const jar = await cookies();
  const id = jar.get(ONBOARDING_COOKIE)?.value;
  if (!id) return null;

  const row = await prisma.metaOnboardingSession.findFirst({
    where: {
      id,
      tenantId: session.tenantId,
      userId: session.userId,
      expiresAt: { gt: new Date() },
    },
  });
  if (!row) return null;

  const brand = await prisma.brand.findFirst({
    where: { id: row.brandId, tenantId: session.tenantId },
    select: { name: true },
  });
  if (!brand) return null;

  return {
    id: row.id,
    brandId: row.brandId,
    brandName: brand.name,
    grantedScopes: row.grantedScopes,
    pages: sanitize(row.pages as unknown as MetaDiscoveredPage[]),
  };
}

/** Server-only: load the RAW session (incl. tokens) for account creation. */
export async function loadOnboardingRaw(session: AppSession, id: string) {
  return prisma.metaOnboardingSession.findFirst({
    where: {
      id,
      tenantId: session.tenantId,
      userId: session.userId,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function clearOnboarding(id: string): Promise<void> {
  const jar = await cookies();
  jar.delete(ONBOARDING_COOKIE);
  await prisma.metaOnboardingSession.deleteMany({ where: { id } });
}
