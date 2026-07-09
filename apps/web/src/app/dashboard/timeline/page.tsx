import Link from "next/link";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const EVENT_TONE: Record<string, string> = {
  "sync.completed": "ok", "sync.failed": "danger",
  "incident.created": "danger", "approval.approved": "ok", "approval.rejected": "warn",
  "auto_protect.would_auto_hide": "neutral", "platform_action.blocked": "neutral",
  "platform_action.dry_run": "warn", "platform_action.executed": "danger",
  "control_policy.updated": "brand", "autonomy_mode.changed": "warn", "preset.applied": "brand",
  "feedback.created": "neutral",
};

// Events the timeline surfaces (operational, not noise).
const TIMELINE_EVENTS = [
  "sync.completed", "sync.failed", "auto_protect.would_auto_hide", "incident.created",
  "approval.approved", "approval.rejected", "control_policy.updated", "autonomy_mode.changed",
  "preset.applied", "feedback.created", "platform_action.blocked", "platform_action.dry_run",
  "platform_action.executed", "classifier.brand_memory_used",
];

export default async function TimelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const eventFilter = sp.event && TIMELINE_EVENTS.includes(sp.event) ? sp.event : undefined;

  const events = await prisma.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      ...(realMode.isRealMode && realMode.realBrandIds.length ? { OR: [{ brandId: { in: realMode.realBrandIds } }, { brandId: null }] } : {}),
      event: eventFilter ? { equals: eventFilter } : { in: TIMELINE_EVENTS },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, event: true, createdAt: true, targetType: true, targetId: true, metadata: true },
  });

  const chips = [{ key: "", label: t.cc.filterAll }, ...TIMELINE_EVENTS.map((e) => ({ key: e, label: e }))];

  return (
    <>
      <PageHeader title={t.cc.timelineTitle} description={t.cc.timelineSubtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">{t.cc.filterEvent}:</span>
        {chips.slice(0, 10).map((c) => {
          const active = (eventFilter ?? "") === c.key;
          return (
            <Link key={c.key || "all"} href={`/dashboard/timeline${c.key ? `?event=${c.key}` : ""}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${active ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>
              {c.label}
            </Link>
          );
        })}
      </div>

      {events.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">{t.cc.timelineEmpty}</Card>
      ) : (
        <Card>
          <ol className="relative space-y-3 border-l border-[var(--color-border)] pl-4">
            {events.map((e) => {
              const cat = (e.metadata as { category?: string } | null)?.category;
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-border-strong)]" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge tone={EVENT_TONE[e.event] ?? "neutral"}>{e.event}</Badge>
                      {cat ? <span className="text-xs text-[var(--color-muted)]">{cat}</span> : null}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">{formatDateTime(e.createdAt)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </>
  );
}
