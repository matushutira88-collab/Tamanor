import Link from "next/link";
import { ConnectorStatus, Platform } from "@guardora/core";
import { getMetaSetupStatus, loadEnv } from "@guardora/config";
import { tokenStorageStatus } from "@guardora/db";
import { PageHeader, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { humanize, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type CheckState = "pass" | "warn" | "fail" | "info";
const STATE_TONE: Record<CheckState, string> = {
  pass: "ok",
  warn: "warn",
  fail: "danger",
  info: "neutral",
};

// Map env setup statuses to checklist states.
const SETUP_STATE: Record<string, CheckState> = {
  configured: "pass",
  on: "pass",
  off: "info",
  missing: "fail",
  invalid: "fail",
};

interface Item {
  label: string;
  state: CheckState;
  detail?: string;
}

export default async function MetaTestPage() {
  const session = await requireSession();
  const setup = getMetaSetupStatus();

  const [brandCount, metaAccounts, lastRun] = await withTenant(session.tenantId, (db) => Promise.all([
    db.brand.count({ where: { tenantId: session.tenantId } }),
    db.connectedAccount.findMany({
      where: {
        tenantId: session.tenantId,
        platform: { in: [Platform.FacebookPage, Platform.InstagramBusiness] },
        status: ConnectorStatus.Active,
      },
      select: {
        id: true,
        platform: true,
        health: true,
        tokenExpiresAt: true,
        lastSuccessfulSyncAt: true,
      },
    }),
    db.syncRun.findFirst({
      where: { tenantId: session.tenantId },
      orderBy: { startedAt: "desc" },
      select: { status: true, mock: true, fetched: true, created: true, deduped: true, startedAt: true },
    }),
  ]));

  // Env checks (no secret values).
  const envItems: Item[] = setup.checks.map((c) => ({
    label: c.label,
    state: SETUP_STATE[c.status] ?? "info",
    detail: c.note,
  }));

  const degraded = metaAccounts.filter((a) => a.health !== "healthy").length;

  // Runtime readiness checks.
  const runtimeItems: Item[] = [
    {
      label: "At least one brand exists",
      state: brandCount > 0 ? "pass" : "fail",
      detail: `${brandCount} brand(s)`,
    },
    {
      label: "At least one Meta account connected",
      state: metaAccounts.length > 0 ? "pass" : "warn",
      detail: `${metaAccounts.length} active`,
    },
    {
      label: "Token health",
      state: metaAccounts.length === 0 ? "info" : degraded > 0 ? "warn" : "pass",
      detail:
        metaAccounts.length === 0
          ? "no connected accounts"
          : degraded > 0
            ? `${degraded} need reconnect`
            : "all healthy",
    },
    {
      label: "Last sync result",
      state: !lastRun
        ? "info"
        : lastRun.status === "completed"
          ? "pass"
          : lastRun.status === "failed"
            ? "warn"
            : "info",
      detail: lastRun
        ? `${humanize(lastRun.status)} · ${lastRun.mock ? "mock" : "live"} · fetched ${lastRun.fetched}, new ${lastRun.created}, deduped ${lastRun.deduped} · ${formatDateTime(lastRun.startedAt)}`
        : "no sync yet",
    },
  ];

  const readyForLive =
    setup.ready && brandCount > 0 && metaAccounts.length > 0 && degraded === 0;

  // Production readiness checks (no secret values).
  const env = loadEnv();
  const token = tokenStorageStatus();
  const isProd = env.NODE_ENV === "production";
  const appUrlIsLocal = /localhost|127\.0\.0\.1/.test(env.APP_URL);
  const productionItems: Item[] = [
    {
      label: "Domain / APP_URL",
      state: appUrlIsLocal ? "warn" : "pass",
      detail: appUrlIsLocal ? "using localhost — set a real domain for launch" : "custom domain set",
    },
    {
      label: "Token storage mode",
      state: token.productionSafe ? "pass" : isProd ? "fail" : "warn",
      detail: `${token.mode}${token.mode === "aes-gcm" ? (token.keyConfigured ? " · key set" : " · key MISSING") : ""}${token.mode === "plaintext" ? " · dev only, blocked in production" : ""}`,
    },
    {
      label: "Webhook verify token",
      state: setup.checks.find((c) => c.key === "META_WEBHOOK_VERIFY_TOKEN")?.status === "configured" ? "pass" : "warn",
      detail: "required for webhooks",
    },
    {
      label: "Public trust pages",
      state: "pass",
      detail: "privacy · terms · security · contact",
    },
    {
      label: "Email contacts",
      state: "info",
      detail: "Configure hello@ / security@ / privacy@ tamanor.com before production",
    },
    {
      label: "Backups & incident response",
      state: "info",
      detail: "configure with your host — see PRODUCTION_READINESS.md",
    },
  ];

  return (
    <>
      <PageHeader
        title="Meta live test checklist"
        description="Everything needed before a real Meta App read-only test. No secret values are shown."
        action={
          <Badge tone={readyForLive ? "ok" : "warn"}>
            {readyForLive ? "Ready for live test" : "Not ready"}
          </Badge>
        }
      />

      <Link
        href="/dashboard/accounts"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        ← Connected accounts
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Environment" items={envItems} />
        <Section title="Runtime readiness" items={runtimeItems} />
      </div>

      <div className="mt-6">
        <Section title="Production readiness" items={productionItems} />
      </div>

      <div className="mt-6 gu-card p-5 text-xs text-[var(--color-muted)]">
        <p className="font-semibold text-[var(--color-fg)]">How to run the live test</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Complete the environment checks (see <code>docs/META_SETUP.md</code>).</li>
          <li>Connect a real Facebook Page via <em>Connect with Meta</em> and select it.</li>
          <li>Set <code>META_LIVE_SYNC=true</code> and restart.</li>
          <li>Post a test comment on the Page, then run a read-only sync.</li>
          <li>Confirm it appears in the Reputation Inbox. No moderation action is taken.</li>
        </ol>
      </div>
    </>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="gu-card p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {it.label}
              {it.detail ? (
                <span className="ml-2 text-xs text-[var(--color-muted)]">{it.detail}</span>
              ) : null}
            </span>
            <Badge tone={STATE_TONE[it.state]}>{it.state}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
