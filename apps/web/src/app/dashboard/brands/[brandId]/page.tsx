import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BrandStatus,
  Permission,
  PLATFORM_META,
  Platform,
  can,
} from "@guardora/core";
import { PageHeader, Badge, StatCard } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { humanize, formatDate } from "@/lib/format";
import { CONNECTOR_TONE } from "@/lib/ui-maps";
import { updateBrandStatus } from "../actions";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  paused: "warn",
  archived: "neutral",
};

const COPY: Record<
  Locale,
  {
    description: (loc: string, tz: string, tone: string) => string;
    allBrands: string;
    connectedAccountsStat: string;
    brandRules: string;
    reputationItems: string;
    setStatus: string;
    connectedAccountsHeading: string;
    manageConnections: string;
    noPlatforms: string;
    connected: string;
  }
> = {
  en: {
    description: (loc, tz, tone) => `${loc} · ${tz} · ${tone} tone`,
    allBrands: "← All brands",
    connectedAccountsStat: "Connected accounts",
    brandRules: "Brand rules",
    reputationItems: "Reputation items",
    setStatus: "Set status:",
    connectedAccountsHeading: "Connected accounts",
    manageConnections: "Manage connections →",
    noPlatforms: "No platforms connected.",
    connected: "connected",
  },
  sk: {
    description: (loc, tz, tone) => `${loc} · ${tz} · tón ${tone}`,
    allBrands: "← Všetky značky",
    connectedAccountsStat: "Pripojené účty",
    brandRules: "Pravidlá značky",
    reputationItems: "Položky reputácie",
    setStatus: "Nastaviť stav:",
    connectedAccountsHeading: "Pripojené účty",
    manageConnections: "Spravovať pripojenia →",
    noPlatforms: "Žiadne pripojené platformy.",
    connected: "pripojené",
  },
  de: {
    description: (loc, tz, tone) => `${loc} · ${tz} · Ton ${tone}`,
    allBrands: "← Alle Marken",
    connectedAccountsStat: "Verbundene Konten",
    brandRules: "Markenregeln",
    reputationItems: "Reputations-Einträge",
    setStatus: "Status festlegen:",
    connectedAccountsHeading: "Verbundene Konten",
    manageConnections: "Verbindungen verwalten →",
    noPlatforms: "Keine Plattformen verbunden.",
    connected: "verbunden",
  },
};

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const session = await requireSession();
  const manage = can(session.role, Permission.BrandManage);

  const brand = await withTenant(session.tenantId, (db) => db.brand.findFirst({
    where: { id: brandId, tenantId: session.tenantId },
    include: {
      connectedAccounts: { orderBy: { platform: "asc" } },
      _count: { select: { brandRules: true, reputationItems: true } },
    },
  }));
  if (!brand) notFound();

  const locale = await getLocale();
  const c = COPY[locale];

  return (
    <>
      <PageHeader
        title={brand.name}
        description={c.description(brand.defaultLocale, brand.timezone, humanize(brand.defaultTone))}
        action={
          <Badge tone={STATUS_TONE[brand.status] ?? "neutral"}>
            {humanize(brand.status)}
          </Badge>
        }
      />

      <Link
        href="/dashboard/brands"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        {c.allBrands}
      </Link>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={c.connectedAccountsStat} value={String(brand.connectedAccounts.length)} />
        <StatCard label={c.brandRules} value={String(brand._count.brandRules)} />
        <StatCard label={c.reputationItems} value={String(brand._count.reputationItems)} />
      </div>

      {/* Status controls */}
      {manage ? (
        <div className="mt-6 flex items-center gap-2">
          <span className="text-xs text-[var(--color-muted)]">{c.setStatus}</span>
          {Object.values(BrandStatus).map((s) => (
            <form key={s} action={updateBrandStatus.bind(null, brand.id, s)}>
              <button
                type="submit"
                disabled={brand.status === s}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs transition hover:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {humanize(s)}
              </button>
            </form>
          ))}
        </div>
      ) : null}

      {/* Connected accounts */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            {c.connectedAccountsHeading}
          </h2>
          <Link
            href="/dashboard/accounts"
            className="text-xs text-[var(--color-brand)] hover:underline"
          >
            {c.manageConnections}
          </Link>
        </div>
        {brand.connectedAccounts.length === 0 ? (
          <div className="gu-card p-5 text-sm text-[var(--color-muted)]">
            {c.noPlatforms}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {brand.connectedAccounts.map((a) => (
              <div key={a.id} className="gu-card flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">
                    {PLATFORM_META[a.platform as Platform].label}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {a.externalName ?? "—"} · {c.connected} {formatDate(a.createdAt)}
                  </p>
                </div>
                <Badge tone={CONNECTOR_TONE[a.status as keyof typeof CONNECTOR_TONE] ?? "neutral"}>
                  {humanize(a.status)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
