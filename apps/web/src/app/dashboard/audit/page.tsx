import Link from "next/link";
import { ActorKind, Permission } from "@guardora/core";
import { PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/audit");

const ACTOR_TONE: Record<string, string> = {
  ai: "brand",
  human: "ok",
  rule: "warn",
  system: "neutral",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission(Permission.AuditView);
  const sp = await searchParams;

  const brandId = sp.brand || undefined;
  const actor =
    sp.actor && (Object.values(ActorKind) as string[]).includes(sp.actor)
      ? sp.actor
      : undefined;
  const q = sp.q?.trim() || undefined;

  const [brands, logs] = await Promise.all([
    prisma.brand.findMany({
      where: { tenantId: session.tenantId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: {
        tenantId: session.tenantId,
        ...(brandId ? { brandId } : {}),
        ...(actor ? { actorKind: actor as ActorKind } : {}),
        ...(q ? { event: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const brandOptions = [
    { value: "", label: "All brands" },
    ...brands.map((b) => ({ value: b.id, label: b.name })),
  ];
  const actorOptions = [
    { value: "", label: "All actors" },
    ...Object.values(ActorKind).map((v) => ({ value: v, label: humanize(v) })),
  ];

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <form className="mb-5 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Brand</span>
          <select name="brand" defaultValue={brandId ?? ""} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]">
            {brandOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Actor</span>
          <select name="actor" defaultValue={actor ?? ""} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]">
            {actorOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Event contains</span>
          <input name="q" defaultValue={q ?? ""} placeholder="e.g. moderation" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]" />
        </label>
        <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white">
          Apply
        </button>
        <Link href="/dashboard/audit" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">
          Clear
        </Link>
      </form>

      <div className="gu-card overflow-hidden">
        <div className="grid grid-cols-[1.3fr_1.6fr_0.9fr_1.4fr] gap-3 border-b border-[var(--color-border)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--color-muted)]">
          <span>Time</span>
          <span>Event</span>
          <span>Actor</span>
          <span>Target</span>
        </div>
        {logs.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-[var(--color-muted)]">
            No audit entries match these filters.
          </div>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[1.3fr_1.6fr_0.9fr_1.4fr] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm last:border-0"
            >
              <span className="text-xs text-[var(--color-muted)]">
                {formatDateTime(l.createdAt)}
              </span>
              <span className="font-mono text-xs">{l.event}</span>
              <span>
                <Badge tone={ACTOR_TONE[l.actorKind] ?? "neutral"}>
                  {humanize(l.actorKind)}
                </Badge>
              </span>
              <span className="truncate text-xs text-[var(--color-muted)]">
                {l.targetType ? `${humanize(l.targetType)} · ${l.targetId ?? "—"}` : "—"}
              </span>
            </div>
          ))
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Append-only · showing {logs.length} entr{logs.length === 1 ? "y" : "ies"} · max 200.
      </p>
    </>
  );
}
