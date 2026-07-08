import Link from "next/link";
import {
  DecisionStatus,
  ModerationAction,
  PLATFORM_META,
  Permission,
  Platform,
  Priority,
  RiskLevel,
  can,
} from "@guardora/core";
import { PageHeader, Badge, EmptyState, Tabs } from "@/components/dashboard/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize, formatDate } from "@/lib/format";
import { RISK_TONE, DECISION_TONE } from "@/lib/ui-maps";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/approvals");

type SP = Record<string, string | undefined>;

function opt<T extends Record<string, string>>(e: T, allLabel: string) {
  return [
    { value: "", label: allLabel },
    ...Object.values(e).map((v) => ({ value: v, label: humanize(v) })),
  ];
}
function pick<T extends Record<string, string>>(e: T, raw?: string) {
  return raw && (Object.values(e) as string[]).includes(raw) ? raw : undefined;
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requirePermission(Permission.ProposalView);
  const sp = await searchParams;

  const status = pick(DecisionStatus, sp.status);
  const action = pick(ModerationAction, sp.action);
  const platform = pick(Platform, sp.platform);
  const risk = pick(RiskLevel, sp.risk);
  const priority = pick(Priority, sp.priority);
  const brandId = sp.brand || undefined;

  const itemFilter = {
    ...(platform ? { platform: platform as Platform } : {}),
    ...(risk ? { riskLevel: risk as RiskLevel } : {}),
    ...(priority ? { priority: priority as Priority } : {}),
  };

  const [brands, statusGroups, decisions] = await Promise.all([
    prisma.brand.findMany({
      where: { tenantId: session.tenantId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.moderationDecision.groupBy({
      by: ["status"],
      where: { tenantId: session.tenantId },
      _count: true,
    }),
    prisma.moderationDecision.findMany({
      where: {
        tenantId: session.tenantId,
        ...(status ? { status: status as DecisionStatus } : {}),
        ...(action ? { action: action as ModerationAction } : {}),
        ...(brandId ? { brandId } : {}),
        ...(Object.keys(itemFilter).length ? { reputationItem: itemFilter } : {}),
      },
      include: {
        reputationItem: { include: { contentItem: { select: { text: true } } } },
        brand: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
  ]);

  const brandOptions = [
    { value: "", label: "All brands" },
    ...brands.map((b) => ({ value: b.id, label: b.name })),
  ];

  const countByStatus = new Map(statusGroups.map((g) => [g.status, g._count as unknown as number]));
  const totalCount = [...countByStatus.values()].reduce((a, b) => a + b, 0);
  const otherFilters = new URLSearchParams();
  if (brandId) otherFilters.set("brand", brandId);
  if (action) otherFilters.set("action", action);
  if (platform) otherFilters.set("platform", platform);
  if (risk) otherFilters.set("risk", risk);
  if (priority) otherFilters.set("priority", priority);
  const suffix = otherFilters.toString() ? `&${otherFilters.toString()}` : "";
  const tabHref = (s: string) => `/dashboard/approvals?status=${s}${suffix}`.replace("status=&", "");

  const tabs = [
    { key: "", label: "All", href: `/dashboard/approvals?${otherFilters.toString()}`, count: totalCount },
    { key: DecisionStatus.Proposed, label: "Proposed", href: tabHref(DecisionStatus.Proposed), count: countByStatus.get(DecisionStatus.Proposed) ?? 0 },
    { key: DecisionStatus.Approved, label: "Approved", href: tabHref(DecisionStatus.Approved), count: countByStatus.get(DecisionStatus.Approved) ?? 0 },
    { key: DecisionStatus.Executed, label: "Executed", href: tabHref(DecisionStatus.Executed), count: countByStatus.get(DecisionStatus.Executed) ?? 0 },
    { key: DecisionStatus.Failed, label: "Failed", href: tabHref(DecisionStatus.Failed), count: countByStatus.get(DecisionStatus.Failed) ?? 0 },
  ];

  return (
    <>
      <PageHeader
        title={nav.label}
        description={nav.description}
        action={<Badge tone="warn">{countByStatus.get(DecisionStatus.Proposed) ?? 0} pending</Badge>}
      />

      <Tabs active={status ?? ""} tabs={tabs} />

      <form className="mb-4 flex flex-wrap items-end gap-2.5">
        <input type="hidden" name="status" value={status ?? ""} />
        <FilterSelect name="brand" label="Brand" value={brandId ?? ""} options={brandOptions} />
        <FilterSelect name="action" label="Action" value={action ?? ""} options={opt(ModerationAction, "All actions")} />
        <FilterSelect name="platform" label="Platform" value={platform ?? ""} options={opt(Platform, "All platforms")} />
        <FilterSelect name="risk" label="Risk" value={risk ?? ""} options={opt(RiskLevel, "All risk")} />
        <FilterSelect name="priority" label="Priority" value={priority ?? ""} options={opt(Priority, "All priority")} />
        <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">
          Apply
        </button>
        <Link href="/dashboard/approvals" className="rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">
          Clear
        </Link>
      </form>

      {decisions.length === 0 ? (
        <EmptyState
          title="No proposals here"
          body="Proposals appear when the AI engine or a reviewer suggests an action. Nothing runs until it's approved and executed."
          hint="Runtime keeps moderation actions disabled — this is a safe review queue."
        />
      ) : (
      <div className="gu-card overflow-hidden">
        <div className="grid grid-cols-[1.5fr_0.9fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          <span>Content</span>
          <span>Brand · Platform</span>
          <span>Action</span>
          <span>Risk</span>
          <span>Status</span>
          <span>Created</span>
        </div>

        {(
          decisions.map((d) => {
            const snapshotLevel =
              (d.riskSnapshot as { level?: RiskLevel } | null)?.level ??
              (d.reputationItem.riskLevel as RiskLevel);
            return (
              <Link
                key={d.id}
                href={`/dashboard/approvals/${d.id}`}
                className="grid grid-cols-[1.5fr_0.9fr_0.8fr_0.8fr_0.9fr_0.9fr] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm transition last:border-0 hover:bg-[var(--color-surface-2)]"
              >
                <span className="truncate">{d.reputationItem.contentItem.text}</span>
                <span className="min-w-0 text-xs text-[var(--color-muted)]">
                  <span className="block truncate">{d.brand.name}</span>
                  {PLATFORM_META[d.reputationItem.platform as Platform].label}
                </span>
                <span>
                  <Badge>{humanize(d.action)}</Badge>
                </span>
                <span>
                  <Badge tone={RISK_TONE[snapshotLevel]}>{humanize(snapshotLevel)}</Badge>
                </span>
                <span>
                  <Badge tone={DECISION_TONE[d.status as DecisionStatus]}>
                    {humanize(d.status)}
                  </Badge>
                </span>
                <span className="text-xs text-[var(--color-muted)]">
                  {formatDate(d.createdAt)}
                </span>
              </Link>
            );
          })
        )}
      </div>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Showing {decisions.length} proposal(s) · max 100.
      </p>
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
