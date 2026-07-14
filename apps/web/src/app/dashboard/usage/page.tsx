import { requireSession } from "@/server/auth";
import { withTenant, getUsageSummary, getUsageDiagnostic, type UsageStatus } from "@guardora/db";
import { getPaidAiFuseConfig } from "@guardora/config";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<UsageStatus, "ok" | "warn" | "danger"> = { normal: "ok", warning: "warn", critical: "warn", exhausted: "danger" };
const STATUS_LABEL: Record<UsageStatus, string> = { normal: "Normal", warning: "Warning", critical: "Critical", exhausted: "Exhausted" };
const euros = (micros: bigint) => `€${(Number(micros) / 1_000_000).toFixed(2)}`;
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function Meter({ label, used, limit, percent, testid, suffix }: { label: string; used: string; limit: string; percent: number; testid: string; suffix?: string }) {
  const tone = percent >= 100 ? "var(--color-danger)" : percent >= 80 ? "var(--color-warn)" : "var(--color-brand)";
  return (
    <div data-testid={testid} data-percent={percent}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-[var(--color-muted)]">{used} / {limit}{suffix ?? ""}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: tone }} />
      </div>
    </div>
  );
}

export default async function UsagePage() {
  const session = await requireSession();
  const tenant = await withTenant(session.tenantId, (db) => db.tenant.findUnique({ where: { id: session.tenantId }, select: { plan: true } }));
  const plan = tenant?.plan ?? "free";
  const summary = await getUsageSummary(session.tenantId, plan);
  const fuse = getPaidAiFuseConfig();
  const isAdmin = session.role === "owner" || session.role === "admin";
  const diag = isAdmin ? await getUsageDiagnostic(session.tenantId, plan) : null;

  return (
    <>
      <PageHeader eyebrow="Plan" title="Usage" description="Your monthly AI usage and limits. Your inbox always remains available." />

      <div data-testid="usage-card" data-status={summary.status}>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold capitalize" data-testid="usage-plan">{summary.plan} plan</span>
            <span data-testid="usage-status"><Badge tone={STATUS_TONE[summary.status]}>{STATUS_LABEL[summary.status]}</Badge></span>
          </div>
          <span className="text-xs text-[var(--color-muted)]" data-testid="usage-period">
            {fmtDate(summary.periodStart)} – {fmtDate(summary.periodEnd)} · resets {fmtDate(summary.nextReset)}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <Meter testid="usage-basic" label="Basic AI checks" used={String(summary.basic.used)} limit={summary.basic.limit === null ? "∞" : String(summary.basic.limit)} percent={summary.basic.percent} />
          <Meter testid="usage-premium-calls" label="Advanced AI analyses" used={String(summary.premiumCalls.used)} limit={summary.premiumCalls.limit === null ? "∞" : String(summary.premiumCalls.limit)} percent={summary.premiumCalls.percent} />
          <Meter testid="usage-premium-cost" label="Advanced AI budget" used={euros(summary.premiumCost.usedMicros)} limit={summary.premiumCost.limitMicros === null ? "∞" : euros(summary.premiumCost.limitMicros)} percent={summary.premiumCost.percent} />
        </div>

        <p className="mt-4 text-xs text-[var(--color-muted)]" data-testid="usage-copy">
          Advanced AI pauses when the monthly limit is reached. Your inbox remains available.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs" data-testid="usage-paid-enabled" data-enabled={fuse.effectiveEnabled ? "true" : "false"}>
          <span className={`inline-block h-2 w-2 rounded-full ${fuse.effectiveEnabled ? "bg-[var(--color-ok)]" : "bg-[var(--color-muted)]"}`} />
          <span className="text-[var(--color-muted)]">Advanced (paid) AI is {fuse.effectiveEnabled ? "enabled" : "disabled"}.</span>
        </p>
      </Card>
      </div>

      {diag ? (
        <div data-testid="usage-diagnostic" className="mt-4">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Diagnostic <span className="font-normal text-[var(--color-muted)]">· admin only</span></h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <D label="Effective plan">{diag.policy.plan}</D>
            <D label="Paid fallback allowed">{String(diag.policy.allowPaidFallback)}</D>
            <D label="Generated replies">{String(diag.policy.allowGeneratedReplies)}</D>
            <D label="Open reservations">{String(diag.reservations)}</D>
            <D label="Stale reservations">{String(diag.staleReservations)}</D>
            <D label="Denied (period)">{String(diag.deniedCount)}</D>
            <D label="Cache hit rate">{`${Math.round(diag.cacheHitRate * 100)}%`}</D>
            <D label="Paid AI enabled">{String(fuse.effectiveEnabled)}</D>
            <D label="Global daily calls cap">{String(fuse.globalDailyCallLimit)}</D>
            <D label="Global daily cost cap">{euros(BigInt(fuse.globalDailyCostLimitMicros))}</D>
            <D label="Max concurrency">{String(fuse.maxConcurrency)}</D>
            <D label="RPM limit">{String(fuse.rpmLimit)}</D>
          </dl>
        </Card>
        </div>
      ) : null}
    </>
  );
}

function D({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
