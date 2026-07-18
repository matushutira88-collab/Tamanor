import Link from "next/link";
import type { Route } from "next";
import { BrandIcon } from "./platform-icon";
import { Badge } from "./ui";

/**
 * V1.60 — watched-account card (mockup): platform glyph + handle, a small stat
 * grid (comments / risky / auto-hide state), a health badge, and a footer line
 * with the last-sync relative time. Purely presentational — counts are computed
 * by the page from real records.
 */
export function AccountCard({
  platform,
  name,
  metaLabel,
  comments,
  risky,
  autoHideLabel,
  autoHideOn,
  state,
  footer,
  href,
  strings,
}: {
  platform: string;
  name: string;
  metaLabel: string;
  comments: number;
  risky: number;
  autoHideLabel: string;
  autoHideOn: boolean;
  state: { tone: string; label: string };
  footer: string;
  href: Route;
  strings: { comments: string; risky: string; autoHide: string };
}) {
  return (
    <Link href={href} className="gu-card group flex flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted)]">
        <BrandIcon platform={platform} size={16} />
        {metaLabel}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <BrandIcon platform={platform} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{name}</p>
          <div className="mt-1"><Badge tone={state.tone}>{state.label}</Badge></div>
        </div>
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-[var(--color-border)] pt-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">{strings.comments}</dt>
          <dd className="font-semibold text-[var(--color-fg)]">{comments}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">{strings.risky}</dt>
          <dd className={`font-semibold ${risky > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]"}`}>{risky}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-muted)]">{strings.autoHide}</dt>
          <dd className={`font-semibold ${autoHideOn ? "text-[var(--color-ok)]" : "text-[var(--color-muted)]"}`}>{autoHideLabel}</dd>
        </div>
      </dl>

      <p className={`mt-3 border-t border-[var(--color-border)] pt-3 text-xs ${state.tone === "danger" || state.tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]"}`}>
        {footer}
      </p>
    </Link>
  );
}
