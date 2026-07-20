"use client";

import Link from "next/link";
import { useId, useState } from "react";

/**
 * V1.66 — the live setup checklist.
 *
 * Every item's done/not-done comes from the SERVER, derived from real workspace state (connected accounts,
 * monitoring flags, sync results, this member's own review audit). Nothing here can tick a step off — the
 * component only renders what the server derived, so the list can never claim progress that did not happen.
 *
 * It is collapsible and never blocks the dashboard. Progress is measured over the REQUIRED steps; the
 * recommended follow-up is listed but marked, so a workspace that has not yet seen a risky comment can
 * still reach 100%.
 */

export interface ChecklistItemView {
  key: string;
  done: boolean;
  required: boolean;
  label: string;
  body: string;
  cta?: string;
  href?: string;
}

export function OnboardingChecklist({
  copy,
  items,
  completedCount,
  totalCount,
  progressPct,
  nextKey,
}: {
  copy: {
    title: string; subtitle: string; progress: string; next: string; doneLabel: string;
    recommended: string; recommendedNote: string; collapse: string; expand: string;
  };
  items: ChecklistItemView[];
  completedCount: number;
  totalCount: number;
  progressPct: number;
  nextKey: string | null;
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const progressText = copy.progress.replace("{done}", String(completedCount)).replace("{total}", String(totalCount));

  return (
    <section className="mt-6 rounded-2xl border border-[var(--color-brand)] bg-[var(--color-surface)] p-5" aria-labelledby={`${listId}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${listId}-title`} className="text-base font-semibold">{copy.title}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className="shrink-0 rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2"
        >
          {open ? copy.collapse : copy.expand}
        </button>
      </div>

      {/* Progress: the bar is decorative; the same information is always present as text. */}
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{progressText}</p>
        <p aria-hidden className="text-xs font-semibold tabular-nums text-[var(--color-muted)]">{progressPct}%</p>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={completedCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-valuetext={progressText}
      >
        <div
          className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {open ? (
        <ul id={listId} className="mt-4 space-y-3">
          {items.map((item) => {
            const isNext = item.key === nextKey;
            return (
              <li
                key={item.key}
                // The optional step is set apart structurally, not by a new colour: a dashed border and a
                // muted surface read as "aside" next to the solid required rows.
                className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between ${
                  isNext
                    ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]/40"
                    : item.required
                      ? "border-[var(--color-border)]"
                      : "border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                }`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <StepMark done={item.done} required={item.required} />
                  <div className="min-w-0">
                    <p className={`text-sm ${item.required ? "font-medium" : "font-normal text-[var(--color-muted)]"}`}>
                      {item.label}
                      {/* Outline badge — lighter than the filled chips used for required state elsewhere. */}
                      {!item.required ? (
                        <span className="ml-2 whitespace-nowrap rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 align-middle text-[11px] font-medium text-[var(--color-muted)]">
                          {copy.recommended}
                        </span>
                      ) : null}
                      {/* Announce the recommended action for screen readers; sighted users get the highlight. */}
                      {isNext ? <span className="sr-only"> — {copy.next}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {item.body}
                      {!item.required && !item.done ? ` ${copy.recommendedNote}` : ""}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 sm:pl-3">
                  {item.done ? (
                    <span className="text-xs font-semibold text-[var(--color-ok)]">{copy.doneLabel}</span>
                  ) : item.cta && item.href ? (
                    <Link
                      href={item.href}
                      className={`inline-block whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 ${
                        isNext
                          ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]"
                          : "border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      {item.cta}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** Required-and-pending gets a solid ring; the optional step gets a dashed, lighter one. */
function StepMark({ done, required }: { done: boolean; required: boolean }) {
  if (done) {
    return (
      <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-ok)] text-white">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`mt-0.5 h-5 w-5 shrink-0 rounded-full ${
        required ? "border-2 border-[var(--color-border-strong)]" : "border border-dashed border-[var(--color-border-strong)]"
      }`}
    />
  );
}
