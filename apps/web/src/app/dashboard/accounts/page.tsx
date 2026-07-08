import Link from "next/link";
import {
  ALL_PLATFORMS,
  ConnectorStatus,
  CONNECTOR_MODE_META,
  PLATFORM_META,
  Permission,
  Platform,
  can,
} from "@guardora/core";
import { getMetaConfig, getMetaSetupStatus } from "@guardora/config";
import { PageHeader, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize } from "@/lib/format";
import { CONNECTOR_TONE } from "@/lib/ui-maps";
import { connectMock, disconnect } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/accounts");

const META_PLATFORMS = new Set<string>([
  Platform.FacebookPage,
  Platform.InstagramBusiness,
]);

const CHECK_TONE: Record<string, string> = {
  configured: "ok",
  on: "ok",
  off: "neutral",
  missing: "warn",
  invalid: "danger",
};

const META_NOTICES: Record<string, { tone: string; text: string }> = {
  config_missing: { tone: "warn", text: "Meta OAuth is not configured. Set the required env vars below." },
  denied: { tone: "danger", text: "You do not have permission to connect accounts." },
  bad_brand: { tone: "danger", text: "Could not start Meta OAuth: brand not found." },
  oauth_denied: { tone: "warn", text: "Meta sign-in was cancelled." },
  invalid_state: { tone: "danger", text: "Meta OAuth failed: invalid state (possible CSRF). Try again." },
  token_exchange_failed: { tone: "danger", text: "Meta token exchange failed. No account was connected." },
  discovery_failed: { tone: "danger", text: "Could not read your Facebook Pages from Meta. No account was connected." },
  no_pages: { tone: "warn", text: "No Facebook Pages were available on that Meta account." },
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const manage = can(session.role, Permission.ConnectorManage);
  const meta = getMetaConfig();
  const setup = getMetaSetupStatus();
  const sp = await searchParams;
  const metaNotice = sp.meta ? META_NOTICES[sp.meta] : undefined;

  const brands = await prisma.brand.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
    include: { connectedAccounts: true },
  });

  return (
    <>
      <PageHeader
        title={nav.label}
        description={nav.description}
        action={
          <Badge tone={meta.configured ? "ok" : "warn"}>
            Meta OAuth: {meta.configured ? "configured" : "not configured"}
          </Badge>
        }
      />

      {metaNotice ? (
        <div className="mb-5" role="status">
          <Badge tone={metaNotice.tone}>Meta</Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{metaNotice.text}</span>
        </div>
      ) : null}

      {/* Meta setup checklist — configured / missing / invalid, no secret values */}
      <div className={`mb-6 gu-card p-5 ${setup.ready ? "" : "border-[var(--color-warn)]"}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Meta setup checklist</h3>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/accounts/meta/test"
              className="text-xs text-[var(--color-brand)] hover:underline"
            >
              Live test checklist →
            </Link>
            <Badge tone={setup.ready ? "ok" : "warn"}>
              {setup.ready ? "Ready" : "Incomplete"}
            </Badge>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Values are never displayed. Full walkthrough: <code>docs/META_SETUP.md</code>.
        </p>
        <ul className="mt-3 space-y-1.5">
          {setup.checks.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <code className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">
                  {c.key}
                </code>
                {c.note ? (
                  <span className="text-xs text-[var(--color-muted)]">{c.note}</span>
                ) : null}
              </span>
              <Badge tone={CHECK_TONE[c.status]}>{c.status}</Badge>
            </li>
          ))}
        </ul>
      </div>

      {brands.length === 0 ? (
        <div className="gu-card p-6 text-sm text-[var(--color-muted)]">
          Create a brand first, then connect platforms to it.
        </div>
      ) : (
        <div className="space-y-8">
          {brands.map((brand) => {
            const byPlatform = new Map(
              brand.connectedAccounts.map((a) => [a.platform, a]),
            );
            return (
              <section key={brand.id}>
                <h2 className="mb-3 text-sm font-semibold">{brand.name}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ALL_PLATFORMS.map((p) => {
                    const pMeta = PLATFORM_META[p];
                    const account = byPlatform.get(p);
                    const connected =
                      account?.status === ConnectorStatus.MockConnected ||
                      account?.status === ConnectorStatus.Active;
                    const isMeta = META_PLATFORMS.has(p);
                    return (
                      <div key={p} className="gu-card p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold">{pMeta.label}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge
                                tone={
                                  account
                                    ? CONNECTOR_TONE[account.status as keyof typeof CONNECTOR_TONE] ?? "neutral"
                                    : "neutral"
                                }
                              >
                                {account ? humanize(account.status) : "Not connected"}
                              </Badge>
                              {account ? (
                                <Badge tone="neutral">
                                  {CONNECTOR_MODE_META[account.mode as keyof typeof CONNECTOR_MODE_META]?.label ?? account.mode}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          {manage ? (
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              {isMeta && meta.configured && !connected ? (
                                <a
                                  href={`/api/connectors/meta/start?brandId=${brand.id}`}
                                  className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white"
                                >
                                  Connect with Meta
                                </a>
                              ) : isMeta && !meta.configured && !connected ? (
                                <span className="rounded-lg border border-[var(--color-warn)] px-3 py-1.5 text-xs text-[var(--color-warn)]">
                                  Config missing
                                </span>
                              ) : null}

                              {connected ? (
                                <>
                                  <Link
                                    href={`/dashboard/accounts/${account!.id}`}
                                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs transition hover:border-[var(--color-brand)]"
                                  >
                                    Details
                                  </Link>
                                  <form action={disconnect.bind(null, account!.id)}>
                                    <button
                                      type="submit"
                                      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                                    >
                                      Disconnect
                                    </button>
                                  </form>
                                </>
                              ) : (
                                <form action={connectMock.bind(null, brand.id, p as Platform)}>
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
                                  >
                                    Connect (mock)
                                  </button>
                                </form>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {pMeta.supportsReviews ? <Badge tone="ok">Reviews</Badge> : null}
                          <Badge tone="ok">Comments</Badge>
                          {pMeta.supportsReply ? <Badge>Reply</Badge> : null}
                          {pMeta.supportsHide ? (
                            <Badge>Hide</Badge>
                          ) : (
                            <Badge tone="warn">No API hide</Badge>
                          )}
                          {pMeta.supportsDelete ? <Badge>Delete</Badge> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
