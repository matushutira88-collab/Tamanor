import Link from "next/link";
import { PageHeader, Badge, PrimaryButton } from "@/components/dashboard/ui";
import { requirePermission } from "@/server/auth";
import { Permission } from "@guardora/core";
import { loadOnboardingForUi } from "@/server/meta-onboarding";
import { confirmMetaSelection, cancelMetaSelection } from "../actions";

export const dynamic = "force-dynamic";

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default async function MetaSelectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission(Permission.ConnectorManage);
  const sp = await searchParams;
  const onboarding = await loadOnboardingForUi(session);

  if (!onboarding) {
    return (
      <>
        <PageHeader
          title="Select a Facebook Page"
          description="Choose which Page (and optionally Instagram) to connect."
        />
        <div className="gu-card p-6">
          <Badge tone="warn">Flow expired</Badge>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {sp.flow === "bad_page"
              ? "That Page is no longer available in this onboarding session."
              : "This onboarding session has expired or is missing. Start the Meta connection again."}
          </p>
          <Link
            href="/dashboard/accounts"
            className="mt-4 inline-block rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-brand)]"
          >
            ← Back to connected accounts
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Select a Facebook Page"
        description={`Connecting to brand: ${onboarding.brandName}. Read-only — no moderation actions.`}
        action={<Badge tone="ok">OAuth completed</Badge>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <span className="text-xs text-[var(--color-muted)]">Granted scopes:</span>
        {onboarding.grantedScopes.map((s) => (
          <Badge key={s} tone="ok">{s}</Badge>
        ))}
      </div>

      <form action={confirmMetaSelection.bind(null, onboarding.id)} className="space-y-3">
        {onboarding.pages.map((p, i) => (
          <label
            key={p.pageId}
            className="gu-card flex cursor-pointer items-start gap-3 p-4 transition hover:border-[var(--color-brand)]"
          >
            <input
              type="radio"
              name="pageId"
              value={p.pageId}
              defaultChecked={i === 0}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge tone="brand">Read-only</Badge>
                {p.category ? <Badge>{p.category}</Badge> : null}
              </div>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-muted)]">
                Page ID {shortId(p.pageId)}
              </p>
              <p className="mt-1 text-xs">
                {p.hasInstagram ? (
                  <span className="text-[var(--color-ok)]">
                    ✓ Instagram Business linked
                    {p.igUsername ? ` (@${p.igUsername})` : ""}
                  </span>
                ) : (
                  <span className="text-[var(--color-muted)]">
                    No Instagram Business account linked
                  </span>
                )}
              </p>
            </div>
          </label>
        ))}

        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" name="connectIg" defaultChecked />
          <span className="text-[var(--color-muted)]">
            Also connect the linked Instagram Business account (when available)
          </span>
        </label>

        <div className="flex items-center gap-2 pt-2">
          <PrimaryButton type="submit">Connect selected Page</PrimaryButton>
          <button
            type="submit"
            formAction={cancelMetaSelection.bind(null, onboarding.id)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Tokens obtained during OAuth are stored server-side only and are never
        shown here or logged.
      </p>
    </>
  );
}
