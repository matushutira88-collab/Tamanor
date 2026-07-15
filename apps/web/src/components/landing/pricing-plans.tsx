"use client";

import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/i18n";

type Plan = { name: string; price: string; tagline: string; features: string[] };

type Enterprise = {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  cta: string;
};

type Labels = {
  mostPopular: string;
  perMonth: string;
  perYear: string;
  monthly: string;
  yearly: string;
  startFree: string;
};

/** Yearly discount, applied silently (not advertised) — 10% off 12 months. */
const YEARLY_DISCOUNT = 0.9;

/** Split a localized price like "€49" or "49 €" into symbol parts + amount. */
function parsePrice(price: string): { prefix: string; amount: number; suffix: string } | null {
  const m = price.match(/^(\D*?)([\d.,\s]+)(\D*)$/);
  if (!m) return null;
  const amount = Number((m[2] ?? "").replace(/[.,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { prefix: m[1] ?? "", amount, suffix: m[3] ?? "" };
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

export function PricingPlans({
  plans,
  enterprise,
  labels,
  locale,
}: {
  plans: Plan[];
  enterprise: Enterprise;
  labels: Labels;
  locale: Locale;
}) {
  const [yearly, setYearly] = useState(false);
  const fmt = new Intl.NumberFormat(locale);

  function displayPrice(price: string): { amount: string; suffix: string } {
    const parsed = parsePrice(price);
    if (!parsed) return { amount: price, suffix: "" };
    if (!yearly) return { amount: price, suffix: labels.perMonth };
    const yearAmount = Math.round(parsed.amount * 12 * YEARLY_DISCOUNT);
    return { amount: `${parsed.prefix}${fmt.format(yearAmount)}${parsed.suffix}`, suffix: labels.perYear };
  }

  return (
    <>
      {/* Billing period toggle — sliding pill. The yearly discount is baked into
          the amount, not shown as a separate badge. */}
      <div className="mb-10 flex justify-center">
        <div
          role="group"
          aria-label={`${labels.monthly} / ${labels.yearly}`}
          className="relative inline-grid grid-cols-2 overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm"
        >
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1/2 bg-[var(--color-brand)] transition-transform duration-200 ease-out ${yearly ? "translate-x-full" : ""}`}
          />
          <button
            type="button"
            onClick={() => setYearly(false)}
            aria-pressed={!yearly}
            className={`relative z-10 px-6 py-2 font-semibold transition-colors ${!yearly ? "text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
          >
            {labels.monthly}
          </button>
          <button
            type="button"
            onClick={() => setYearly(true)}
            aria-pressed={yearly}
            className={`relative z-10 px-6 py-2 font-semibold transition-colors ${yearly ? "text-[var(--color-brand-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
          >
            {labels.yearly}
          </button>
        </div>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p, i) => {
          const highlight = i === 1;
          const price = displayPrice(p.price);
          return (
            <div key={p.name} className={`relative flex flex-col rounded-3xl border bg-[var(--color-surface)] p-6 ${highlight ? "gu-elevate border-[var(--color-brand)]" : "gu-lift border-[var(--color-border)]"}`}>
              {highlight ? <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-brand)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand-fg)]">{labels.mostPopular}</span> : null}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <p className="mt-3 flex min-h-[2.75rem] items-baseline gap-1">
                <span className="gu-display text-3xl font-semibold text-[var(--color-brand)]">{price.amount}</span>
                <span className="text-sm text-[var(--color-muted)]">{price.suffix}</span>
              </p>
              <p className="mt-2 min-h-[2.5rem] text-sm text-[var(--color-muted)]">{p.tagline}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-[var(--color-brand)]"><IconCheck /></span>{f}</li>
                ))}
              </ul>
              <Link href="/register" className={`mt-6 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${highlight ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]" : "border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"}`}>{labels.startFree}</Link>
            </div>
          );
        })}
        <div className="gu-lift relative flex flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h3 className="text-xl font-semibold">{enterprise.name}</h3>
          <p className="mt-3 flex min-h-[2.75rem] items-baseline gu-display text-2xl font-semibold text-[var(--color-brand)]">{enterprise.price}</p>
          <p className="mt-2 min-h-[2.5rem] text-sm text-[var(--color-muted)]">{enterprise.tagline}</p>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm">
            {enterprise.features.map((f) => (
              <li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-[var(--color-brand)]"><IconCheck /></span>{f}</li>
            ))}
          </ul>
          <Link href="/contact" className="mt-6 block rounded-xl border border-[var(--color-border-strong)] px-4 py-2.5 text-center text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">{enterprise.cta}</Link>
        </div>
      </div>
    </>
  );
}
