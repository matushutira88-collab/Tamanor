import { getWatchedAccountsView, accountProtectionScore, previewMonitoredAccountLimit, type WatchedAccountView } from "@guardora/db";
import { PlatformIcon } from "./platform-icon";

/**
 * V1.59 phase 2 — the Watched Accounts overview, driven ENTIRELY by real data from the V1.59 backend
 * (getWatchedAccountsView + the server-computed protection score + the monitored-account limit). Each
 * Facebook Page and each Instagram account is its OWN card (never merged). A value the DB cannot supply
 * is shown as "Unavailable via current permissions", never a fabricated number.
 */
const PLATFORM_LABEL: Record<string, string> = { facebook_page: "Facebook Page", instagram_business: "Instagram Professional" };

const PROBLEM: Record<string, { label: string; tone: string }> = {
  none: { label: "Active", tone: "ok" },
  monitoring_off: { label: "Monitoring off", tone: "neutral" },
  permissions_expired: { label: "Permissions expired", tone: "danger" },
  needs_reconnect: { label: "Needs reconnect", tone: "warn" },
  sync_failed: { label: "Sync failed", tone: "warn" },
};
const TONE: Record<string, string> = {
  ok: "border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)]",
  warn: "border-[var(--color-warn)] text-[var(--color-warn)] bg-[var(--color-warn-soft)]",
  danger: "border-[var(--color-danger)] text-[var(--color-danger)] bg-[var(--color-danger-soft)]",
  neutral: "border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface-2)]",
};
const SCORE_TONE = (level: string) => (level === "strong" || level === "good" ? "ok" : level === "fair" ? "warn" : "danger");

function fmt(d: Date | null): string { return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Unavailable via current permissions"; }

function Card({ view, parentName }: { view: WatchedAccountView; parentName: string | null }) {
  const p = PROBLEM[view.problem] ?? PROBLEM.none;
  const score = accountProtectionScore(view);
  return (
    <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={view.platform as never} />
          <div>
            <span className="block text-sm font-semibold">{view.externalName ?? "Unnamed account"}</span>
            <span className="block text-xs text-[var(--color-muted)]">{PLATFORM_LABEL[view.platform] ?? view.platform}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[p!.tone]}`}>{p!.label}</span>
      </div>

      {view.platform === "instagram_business" ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          {parentName ? `Connected via Facebook Page: ${parentName}` : "Instagram Professional account (independent monitored account)"}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-[var(--color-muted)]">Monitoring</dt><dd className="font-medium">{view.monitoringEnabled ? "On" : "Off"}</dd></div>
        <div><dt className="text-[var(--color-muted)]">Comments (30d)</dt><dd className="font-medium tabular-nums">{view.commentsInWindow}</dd></div>
        <div><dt className="text-[var(--color-muted)]">Risk (30d)</dt><dd className="font-medium tabular-nums">{view.riskCommentsInWindow}</dd></div>
        <div><dt className="text-[var(--color-muted)]">Auto-hide</dt><dd className="font-medium">{view.protection.autoHideEnabled && view.protection.autoHideMode === "automatic" ? "Automatic" : view.protection.autoHideMode === "manual_approval" ? "Manual approval" : "Recommend"}</dd></div>
        <div className="col-span-2"><dt className="text-[var(--color-muted)]">Last successful sync</dt><dd className="font-medium">{fmt(view.lastSuccessfulSyncAt)}</dd></div>
      </dl>

      <div className="mt-3 flex items-center justify-between">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[SCORE_TONE(score.level)]}`}>Protection setup: {score.score}/100</span>
        <a href={`/dashboard/accounts/${view.id}`} className="text-xs font-medium text-[var(--color-brand)] hover:underline">Open account →</a>
      </div>
    </li>
  );
}

export async function WatchedAccountsSection({ tenantId }: { tenantId: string }) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [view, usage] = await Promise.all([
    getWatchedAccountsView(tenantId, since),
    previewMonitoredAccountLimit(tenantId, 0),
  ]);
  const nameById = new Map(view.map((v) => [v.id, v.externalName]));
  const limitLabel = usage.limit < 0 ? `${usage.used} monitored` : `${usage.used} / ${usage.limit} monitored accounts`;

  return (
    <section aria-labelledby="watched-accounts-heading" className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 id="watched-accounts-heading" className="text-sm font-semibold">Watched accounts</h2>
          <p className="text-xs text-[var(--color-muted)]">{limitLabel}</p>
        </div>
        <a href="/dashboard/accounts/meta/select" className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">Connect account</a>
      </div>
      {view.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center">
          <p className="text-sm text-[var(--color-muted)]">No accounts connected yet.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {view.map((v) => <Card key={v.id} view={v} parentName={v.parentAccountId ? (nameById.get(v.parentAccountId) ?? null) : null} />)}
        </ul>
      )}
    </section>
  );
}
