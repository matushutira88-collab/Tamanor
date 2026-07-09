import Link from "next/link";
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

export default async function ActionQueuePage() {
  const t = await getT();
  const session = await requireSession();
  const realMode = await getRealModeFilter(session.tenantId);
  const where = { tenantId: session.tenantId, ...realMode.brandWhere };

  const items = await prisma.actionQueueItem.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const itemIds = items.map((i) => i.itemId);
  const texts = new Map(
    (await prisma.reputationItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, contentItem: { select: { text: true } } } }))
      .map((r) => [r.id, r.contentItem.text]),
  );

  return (
    <>
      <PageHeader title={t.cc.queueTitle} description={t.cc.queueSubtitle} action={<Badge tone="neutral">{t.cc.noLiveAction}</Badge>} />

      {items.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">{t.cc.queueEmpty}</Card>
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
