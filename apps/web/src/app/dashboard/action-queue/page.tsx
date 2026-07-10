import Link from "next/link";
import { queueTabStates, normalizeQueueTab, QUEUE_TABS, type QueueTab } from "@guardora/ai";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  approval_required: "warn", dry_run: "neutral", blocked_by_safety: "ok",
  suggested: "brand", executed: "warn", failed: "danger", monitor: "neutral", no_action: "neutral",
};

const TAB_LABEL: Record<QueueTab, "tabActive" | "tabApproval" | "tabBlocked" | "tabResolved" | "tabHistory"> = {
  active: "tabActive", approval: "tabApproval", blocked: "tabBlocked", resolved: "tabResolved", all: "tabHistory",
};

export default async function ActionQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const tab = normalizeQueueTab(sp.tab);
  const realMode = await getRealModeFilter(session.tenantId);
  const states = queueTabStates(tab);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere, ...(states ? { queueState: { in: states } } : {}) };

  // Per-tab counts for the badges (active is the working queue).
  const [items, activeCount] = await Promise.all([
    prisma.actionQueueItem.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.actionQueueItem.count({ where: { tenantId: session.tenantId, ...realMode.brandWhere, queueState: { in: queueTabStates("active")! } } }),
  ]);
  const itemIds = items.map((i) => i.itemId);
  const texts = new Map(
    (await prisma.reputationItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, contentItem: { select: { text: true } } } }))
      .map((r) => [r.id, r.contentItem.text]),
  );

  return (
    <>
      <PageHeader title={t.cc.queueTitle} description={tab === "active" ? t.cc.queueActiveSubtitle : t.cc.queueSubtitle} action={<Badge tone={activeCount > 0 ? "warn" : "ok"}>{activeCount} {t.cc.tabActive.toLowerCase()}</Badge>} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {QUEUE_TABS.map((tb) => (
          <Link key={tb} href={`/dashboard/action-queue${tb === "active" ? "" : `?tab=${tb}`}`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${tb === tab ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>
            {t.cc[TAB_LABEL[tb]]}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-medium">✅ {tab === "active" ? t.cc.queueEmptyActive : t.cc.queueEmpty}</p>
          {tab === "active" ? <p className="mt-1 text-sm text-[var(--color-muted)]">{t.cc.queueEmptyActiveBody}</p> : null}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                <th className="py-2 pr-2">{t.cc.colItem}</th>
                <th className="px-2">{t.cc.colCategory}</th>
                <th className="px-2">{t.cc.colAction}</th>
                <th className="px-2">{t.cc.colState}</th>
                <th className="px-2">{t.cc.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2 pr-2 max-w-[220px]">
                    <Link href={`/dashboard/action-queue/${it.id}`} className="block truncate font-medium hover:underline">{texts.get(it.itemId) ?? "—"}</Link>
                  </td>
                  <td className="px-2">{tEnum(t, "autoProtectCategory", it.category)}</td>
                  <td className="px-2 text-xs">{it.proposedAction.replace(/_/g, " ")}</td>
                  <td className="px-2"><Badge tone={STATE_TONE[it.queueState] ?? "neutral"}>{tEnum(t, "queueState", it.queueState)}</Badge></td>
                  <td className="px-2 text-[11px] text-[var(--color-muted)] max-w-[240px]"><span className="line-clamp-2">{it.reason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
