import type { ReactNode } from "react";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/** Shared dark wrapper for public marketing / legal pages. */
export function MarketingPage({
  title,
  subtitle,
  eyebrow,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <main className="gu-dark min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SiteHeader />
      <section className="gu-hero border-b border-[var(--color-border)]">
        <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
          {eyebrow ? (
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-2xl text-lg text-[var(--color-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-6 py-14">{children}</section>
      <SiteFooter />
    </main>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[var(--color-muted)]">
        {children}
      </div>
    </div>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>
          </span>
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

export function DraftNote() {
  return (
    <div className="mb-10 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4 text-sm text-[var(--color-muted)]">
      This is early-product wording provided for transparency. It is not legal
      advice and will be finalized before general availability.
    </div>
  );
}
