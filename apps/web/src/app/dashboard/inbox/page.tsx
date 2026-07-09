import Link from "next/link";
import {
  PLATFORM_META,
  Platform,
  Priority,
  ReputationStatus,
  RiskLevel,
} from "@guardora/core";
import { PageHeader, Badge, EmptyState, Tabs } from "@/components/dashboard/ui";
import { PlatformIcon } from "@/components/dashboard/platform-icon";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
import { formatDate } from "@/lib/format";
import { RISK_TONE, STATUS_TONE, PRIORITY_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/inbox");

type SP = Record<string, string | undefined>;

const TAB_STATUSES: Record<string, ReputationStatus[]> = {
  needs_review: [ReputationStatus.New, ReputationStatus.Classified, ReputationStatus.Escalated],
  proposed: [ReputationStatus.NeedsApproval, ReputationStatus.Actioned],
  resolved: [ReputationStatus.Resolved],
  ignored: [ReputationStatus.Ignored],
};
const TAB_ORDER = ["needs_review", "proposed", "resolved", "ignored"] as const;

function opt<T extends Record<string, string>>(e: T, allLabel: string, label: (v: string) => string) {
  return [{ value: "", label: allLabel }, ...Object.values(e).map((v) => ({ value: v, label: label(v) }))];
}
function pick<T extends Record<string, string>>(e: T, raw?: string) {
  return raw && (Object.values(e) as string[]).includes(raw) ? raw : undefined;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const hdrT = await getT();
  const sp = await searchParams;

  const tab = sp.tab && TAB_STATUSES[sp.tab] ? sp.tab : "needs_review";
  const platform = pick(Platform, sp.platform);
  const risk = pick(RiskLevel, sp.risk);
  const priority = pick(Priority, sp.priority);
  const brandId = sp.brand || undefined;
  const ap = sp.ap || undefined;
  const realMode = await getRealModeFilter(session.tenantId);

  // Auto-Protect filter → resolve matching reputation item ids (brand-scoped).
  let apItemIds: string[] | undefined;
  if (ap) {
    const apWhere = ap === "preserved" ? { matchedCategory: "normal_criticism" } : { decision: ap };
    apItemIds = (await prisma.autoProtectDecision.findMany({
      where: { tenantId: session.tenantId, ...apWhere },
      select: { itemId: true },
    })).map((d) => d.itemId);
  }

  const baseFilters = {
    tenantId: session.tenantId,
    ...realMode.brandWhere,
    ...(platform ? { platform: platform as Platform } : {}),
    ...(risk ? { riskLevel: risk as RiskLevel } : {}),
    ...(priority ? { priority: priority as Priority } : {}),
    ...(brandId ? { brandId } : {}),
    ...(apItemIds ? { id: { in: apItemIds } } : {}),
  };

  const [brands, grouped, items] = await Promise.all([
    prisma.brand.findMany({ where: { tenantId: session.tenantId, ...(realMode.isRealMode ? { id: { in: realMode.realBrandIds } } : {}) }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.reputationItem.groupBy({ by: ["status"], where: baseFilters, _count: true }),
    prisma.reputationItem.findMany({
      where: { ...baseFilters, status: { in: TAB_STATUSES[tab] } },
      include: { contentItem: true, brand: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
  ]);

  const countByStatus = new Map(grouped.map((g) => [g.status, g._count as unknown as number]));
  const tabCount = (t: string) => TAB_STATUSES[t]!.reduce((n, s) => n + (countByStatus.get(s) ?? 0), 0);

  const qs = new URLSearchParams();
  if (brandId) qs.set("brand", brandId);
  if (platform) qs.set("platform", platform);
  if (risk) qs.set("risk", risk);
  if (priority) qs.set("priority", priority);
  if (ap) qs.set("ap", ap);
  const suffix = qs.toString() ? `&${qs.toString()}` : "";

  const apChips: { key: string; label: string }[] = [
    { key: "", label: hdrT.autoProtect.filterAll },
    { key: "would_auto_hide", label: tEnum(hdrT, "autoProtectDecision", "would_auto_hide") },
    { key: "requires_approval", label: tEnum(hdrT, "autoProtectDecision", "requires_approval") },
    { key: "monitor", label: tEnum(hdrT, "autoProtectDecision", "monitor") },
    { key: "preserved", label: hdrT.autoProtect.mCriticism },
    { key: "blocked_by_safety", label: tEnum(hdrT, "autoProtectDecision", "blocked_by_safety") },
  ];
  const chipSuffix = (() => {
    const q = new URLSearchParams();
    if (brandId) q.set("brand", brandId);
    if (platform) q.set("platform", platform);
    if (risk) q.set("risk", risk);
    if (priority) q.set("priority", priority);
    return q.toString() ? `&${q.toString()}` : "";
  })();

  const brandOptions = [{ value: "", label: hdrT.dash.allBrands }, ...brands.map((b) => ({ value: b.id, label: b.name }))];

  const tabLabel: Record<string, string> = {
    needs_review: hdrT.dash.needsReview,
    proposed: tEnum(hdrT, "decision", "proposed"),
    resolved: tEnum(hdrT, "status", "resolved"),
    ignored: tEnum(hdrT, "status", "ignored"),
  };

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />

      <Tabs
        active={tab}
        tabs={TAB_ORDER.map((t) => ({ key: t, label: tabLabel[t]!, href: `/dashboard/inbox?tab=${t}${suffix}`, count: tabCount(t) }))}
      />

      {/* Auto-Protect quick filters (shadow mode) */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">🛡️ {hdrT.autoProtect.filterLabel}:</span>
        {apChips.map((c) => {
          const active = (ap ?? "") === c.key;
          return (
            <Link
              key={c.key || "all"}
              href={`/dashboard/inbox?tab=${tab}${c.key ? `&ap=${c.key}` : ""}${chipSuffix}`}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${active ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {/* Filters */}
      <form className="mb-4 flex flex-wrap items-end gap-2.5">
        <input type="hidden" name="tab" value={tab} />
        <FilterSelect name="brand" label={hdrT.dash.brand} value={brandId ?? ""} options={brandOptions} />
        <FilterSelect name="platform" label={hdrT.dash.platform} value={platform ?? ""} options={opt(Platform, hdrT.dash.allPlatforms, (v) => PLATFORM_META[v as Platform].label)} />
        <FilterSelect name="risk" label={hdrT.dash.risk} value={risk ?? ""} options={opt(RiskLevel, hdrT.dash.allRisk, (v) => tEnum(hdrT, "risk", v))} />
        <FilterSelect name="priority" label={hdrT.dash.priority} value={priority ?? ""} options={opt(Priority, hdrT.dash.allPriority, (v) => tEnum(hdrT, "priority", v))} />
        <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">{hdrT.dash.apply}</button>
        <Link href={`/dashboard/inbox?tab=${tab}`} className="rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">{hdrT.dash.clear}</Link>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={hdrT.ui.emptyInboxTitle}
          body={hdrT.ui.emptyInboxBody}
          hint={hdrT.common.readOnlyDefault}
        />
      ) : (
        <div className="gu-card overflow-hidden">
          <div className="grid grid-cols-[1.7fr_1.1fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            <span>{hdrT.dash.content}</span>
            <span>{hdrT.dash.brandPlatform}</span>
            <span>{hdrT.dash.risk}</span>
            <span>{hdrT.dash.priority}</span>
            <span>{hdrT.dash.status}</span>
            <span>{hdrT.dash.ingested}</span>
          </div>
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/dashboard/inbox/${it.id}`}
              className="group grid grid-cols-[1.7fr_1.1fr_0.8fr_0.8fr_0.9fr_0.8fr] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3.5 text-sm transition last:border-0 hover:bg-[var(--color-surface-2)]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-xs font-bold text-[var(--color-brand-strong)]">
                  {(it.contentItem.authorDisplayName ?? "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-1 font-medium text-[var(--color-fg)]">{it.contentItem.text}</span>
                  <span className="text-xs text-[var(--color-muted)]">{it.contentItem.authorDisplayName ?? hdrT.dash.unknown}</span>
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-muted)]">
                <PlatformIcon platform={it.platform} size={24} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-fg)]">{it.brand.name}</span>
                  {PLATFORM_META[it.platform as Platform].label}
                </span>
              </span>
              <span><Badge tone={RISK_TONE[it.riskLevel as RiskLevel]}>{withEmoji("risk", it.riskLevel, tEnum(hdrT, "risk", it.riskLevel))}</Badge></span>
              <span><Badge tone={PRIORITY_TONE[it.priority as Priority]}>{tEnum(hdrT, "priority", it.priority)}</Badge></span>
              <span><Badge tone={STATUS_TONE[it.status as ReputationStatus]}>{tEnum(hdrT, "status", it.status)}</Badge></span>
              <span className="text-xs text-[var(--color-muted)]">{formatDate(it.contentItem.ingestedAt)}</span>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">{`${hdrT.dash.showing} ${items.length} ${hdrT.dash.items} · ${hdrT.dash.max} 100`}</p>
    </>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--color-muted)]">{label}</span>
      <select name={name} defaultValue={value} className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-soft)]">
        {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  );
}
