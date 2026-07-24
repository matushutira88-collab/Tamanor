import Link from "next/link";
import type { ReactNode } from "react";
import { FamilyIllus, type FamilyIllustration } from "./family-illustrations";

/**
 * FAMILY-UI-02 — Family-local UI primitives.
 *
 * Deliberately NOT added to `components/dashboard/ui.tsx`: that module is shared with the
 * Business console, and the Family console must stay separable from it. Anything here is
 * Family-only and safe to change without touching Business.
 *
 * These are the single source of truth for Family spacing, radius, CTA styling and focus
 * treatment, so the pages stop drifting apart.
 */

/** One focus ring for every interactive Family element — visible on keyboard, not on mouse. */
export const FAMILY_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]";

/** Primary call to action. One height, one radius, one weight across every Family page. */
export const FAMILY_CTA_PRIMARY =
  `inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] shadow-sm transition hover:bg-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:opacity-50 ${FAMILY_FOCUS}`;

/** Secondary action — same box, quieter surface. */
export const FAMILY_CTA_SECONDARY =
  `inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${FAMILY_FOCUS}`;

/** Inline "go to …" link used in section headers. */
export const FAMILY_LINK =
  `rounded text-xs font-medium text-[var(--color-brand-strong)] transition hover:underline ${FAMILY_FOCUS}`;

interface Cta { href: string; label: string }

/**
 * The one empty state for the whole Family console: illustration, short title, brief body,
 * a primary action and — where one genuinely exists — a secondary link. Never a bare table.
 *
 * `body` explains *why* it is empty, not just *that* it is empty: in this product an empty
 * list is usually the correct, healthy state, so the copy has to reassure rather than nag.
 */
export function FamilyEmptyState({
  illustration,
  title,
  body,
  hint,
  primary,
  secondary,
}: {
  illustration: FamilyIllustration;
  title: string;
  body: string;
  hint?: string;
  primary?: Cta;
  secondary?: Cta;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center sm:py-14">
      <span className="text-[var(--color-brand)]" aria-hidden>
        <FamilyIllus name={illustration} size={88} />
      </span>
      <h3 className="mt-5 text-base font-semibold text-[var(--color-fg)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
      {hint ? <p className="mt-2 max-w-md text-xs leading-relaxed text-[var(--color-muted)]">{hint}</p> : null}
      {primary || secondary ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {primary ? <Link href={primary.href} className={FAMILY_CTA_PRIMARY}>{primary.label}</Link> : null}
          {secondary ? <Link href={secondary.href} className={FAMILY_CTA_SECONDARY}>{secondary.label}</Link> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Empty state rendered inside its own card — the default for list routes, so an empty
 * list occupies the same visual slot the table would have.
 */
export function FamilyEmptyCard(props: Parameters<typeof FamilyEmptyState>[0]) {
  return (
    <div className="gu-card">
      <FamilyEmptyState {...props} />
    </div>
  );
}

/**
 * Post-action feedback banner (success / failure) for server-action redirects.
 *
 * Tone classes are written out in full on purpose: Tailwind extracts class names
 * statically, so an interpolated `bg-[var(--color-${tone}-soft)]` produces NO css at all.
 * Three Family pages previously did exactly that, which is why their confirmation
 * banners rendered unstyled.
 *
 * `role="status"` (polite) for success and `role="alert"` (assertive) for failure, so a
 * screen reader announces the outcome of an action without the user hunting for it.
 */
export function FamilyStatusBanner({ tone, message }: { tone: "ok" | "danger"; message?: string }) {
  // Callers resolve the text through dictionary lookups, which are `string | undefined` under
  // `noUncheckedIndexedAccess`. No text means no banner — never an empty coloured box.
  if (!message) return null;
  const toneClass =
    tone === "danger"
      ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : "border-[var(--color-ok)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]";
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm font-medium ${toneClass}`}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {tone === "danger" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5h.01" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" />
          </svg>
        )}
      </span>
      <span className="min-w-0">{message}</span>
    </p>
  );
}

/**
 * Read-only notice card — used where a page is reachable but the data is not available to
 * this member. Same shape as the empty state so the console never shows a naked sentence.
 */
export function FamilyNoticeCard({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="gu-card p-6">
      <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
