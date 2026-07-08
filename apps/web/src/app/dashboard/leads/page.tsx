import Link from "next/link";
import { Permission, can } from "@guardora/core";
import { LeadStatus } from "@guardora/db";
import { PageHeader, Badge, EmptyState, Tabs, Card } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { humanize, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/leads");

const STATUS_TONE: Record<string, string> = {
  new: "brand",
  contacted: "warn",
  closed: "neutral",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const hdrT = await getT();
  if (!can(session.role, Permission.MemberManage)) {
    return (
      <>
        <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />
        <EmptyState
          title="Restricted"
          body={`Leads are internal. Your role (${session.role}) doesn't have access. Ask an Owner or Admin.`}
        />
      </>
    );
  }

  const sp = await searchParams;
  const status =
    sp.status && (Object.values(LeadStatus) as string[]).includes(sp.status)
      ? (sp.status as LeadStatus)
      : undefined;

  const [groups, leads] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    prisma.lead.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const count = new Map(groups.map((g) => [g.status, g._count as unknown as number]));
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const tabs = [
    { key: "", label: "All", href: "/dashboard/leads", count: total },
    { key: LeadStatus.new, label: "New", href: `/dashboard/leads?status=${LeadStatus.new}`, count: count.get(LeadStatus.new) ?? 0 },
    { key: LeadStatus.contacted, label: "Contacted", href: `/dashboard/leads?status=${LeadStatus.contacted}`, count: count.get(LeadStatus.contacted) ?? 0 },
    { key: LeadStatus.closed, label: "Closed", href: `/dashboard/leads?status=${LeadStatus.closed}`, count: count.get(LeadStatus.closed) ?? 0 },
  ];

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />
      <Tabs active={status ?? ""} tabs={tabs} />

      {leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          body="Demo requests from /book-demo and messages from /contact appear here as soon as they're submitted."
          hint="Leads are saved to your database — no emails are sent."
        />
      ) : (
        <Card className="!p-0">
          <div className="grid grid-cols-[1.4fr_1.1fr_0.8fr_0.8fr_0.9fr] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            <span>Name</span>
            <span>Company</span>
            <span>Source</span>
            <span>Status</span>
            <span>Received</span>
          </div>
          {leads.map((l) => (
            <Link
              key={l.id}
              href={`/dashboard/leads/${l.id}`}
              className="grid grid-cols-[1.4fr_1.1fr_0.8fr_0.8fr_0.9fr] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm transition last:border-0 hover:bg-[var(--color-surface-2)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-xs text-[var(--color-muted)]">{l.email}</span>
              </span>
              <span className="truncate text-[var(--color-muted)]">{l.company ?? "—"}</span>
              <span><Badge tone="neutral">{humanize(l.source)}</Badge></span>
              <span><Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{humanize(l.status)}</Badge></span>
              <span className="text-xs text-[var(--color-muted)]">{formatDate(l.createdAt)}</span>
            </Link>
          ))}
        </Card>
      )}
      <p className="mt-3 text-xs text-[var(--color-muted)]">Showing {leads.length} lead(s) · max 200.</p>
    </>
  );
}
