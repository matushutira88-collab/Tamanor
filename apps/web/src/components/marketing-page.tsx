import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { defaultLocale, type Dictionary, type Locale } from "@/i18n";
import type { LegalDoc, LegalBlock } from "@/content/legal";

/*
 * Public marketing / legal page shell. Visually aligned with the landing (landing-v2): soft
 * blue hero with blurred glow, heavy display headline, generous whitespace and a closing CTA band.
 *
 *   width="prose" (default) — long-form reading column (legal, trust pages, articles).
 *   width="wide"            — card grids and custom layouts (knowledge indexes, about, contact).
 *   cta                     — closing "start free / talk to us" band; off for legal pages.
 */

const CTA_COPY: Record<Locale, { title: string; titleAccent: string; body: string; primary: string; secondary: string }> = {
  en: { title: "Protect what you've", titleAccent: "built.", body: "Start free in minutes — official OAuth only, a human in control of every sensitive action. No card required.", primary: "Start for free", secondary: "Talk to us" },
  sk: { title: "Ochráňte, čo ste", titleAccent: "vybudovali.", body: "Začnite zdarma za pár minút — len oficiálny OAuth a človek rozhoduje o každej citlivej akcii. Bez platobnej karty.", primary: "Začať zdarma", secondary: "Napíšte nám" },
  de: { title: "Schütze, was du", titleAccent: "aufgebaut hast.", body: "In wenigen Minuten kostenlos starten — nur offizielles OAuth, ein Mensch entscheidet jede sensible Aktion. Keine Karte nötig.", primary: "Kostenlos starten", secondary: "Sprich mit uns" },
};

export function MarketingPage({
  title,
  subtitle,
  eyebrow,
  dict,
  locale = defaultLocale,
  width = "prose",
  breadcrumb,
  actions,
  cta = false,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  dict?: Dictionary;
  locale?: Locale;
  width?: "prose" | "wide";
  /** Rendered above the eyebrow (e.g. a breadcrumb trail). */
  breadcrumb?: ReactNode;
  /** Buttons under the subtitle. */
  actions?: ReactNode;
  cta?: boolean;
  children: ReactNode;
}) {
  const body = width === "wide" ? "max-w-6xl" : "max-w-3xl";
  return (
    <main className="min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SiteHeader dict={dict} locale={locale} />
      <PageHero eyebrow={eyebrow} title={title} subtitle={subtitle} breadcrumb={breadcrumb} actions={actions} wide={width === "wide"} />
      <section className={`mx-auto ${body} px-5 py-14 sm:px-6 md:py-20`}>{children}</section>
      {cta ? <CtaBand locale={locale} /> : null}
      <SiteFooter dict={dict} locale={locale} />
    </main>
  );
}

function PageHero({ eyebrow, title, subtitle, breadcrumb, actions, wide }: { eyebrow?: string; title: string; subtitle?: string; breadcrumb?: ReactNode; actions?: ReactNode; wide: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--color-border)] bg-[linear-gradient(180deg,#f5f8fd,#ffffff)]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[10vw] -top-[18vw] h-[44vw] w-[44vw] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,.20),transparent_62%)] blur-[80px]" />
        <div className="absolute -right-[8vw] -top-[8vw] h-[34vw] w-[34vw] rounded-full bg-[radial-gradient(circle,rgba(96,165,250,.20),transparent_60%)] blur-[80px]" />
      </div>
      <div className={`relative mx-auto ${wide ? "max-w-6xl" : "max-w-3xl"} px-5 py-16 sm:px-6 md:py-24`}>
        {breadcrumb ? <div className="mb-6 text-sm text-[var(--color-muted)]">{breadcrumb}</div> : null}
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand-strong)]">{eyebrow}</p>
        ) : null}
        <h1 className="mt-4 max-w-4xl text-balance text-[clamp(34px,5vw,58px)] font-extrabold leading-[1.04] tracking-[-0.035em]">{title}</h1>
        {subtitle ? <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-[var(--color-muted)]">{subtitle}</p> : null}
        {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </section>
  );
}

/** Primary / secondary button styles shared by marketing pages (match the landing CTAs). */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#60a5fa,#2563eb)] px-6 py-3.5 text-[13px] font-bold uppercase tracking-[0.07em] text-white shadow-[0_8px_22px_rgba(37,99,235,.34)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-white px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.07em] text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2";

export function CtaBand({ locale = defaultLocale }: { locale?: Locale }) {
  const c = CTA_COPY[locale] ?? CTA_COPY.en;
  return (
    <section className="px-5 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#0b1220] px-6 py-14 text-center sm:px-12 md:py-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_18rem_at_50%_120%,rgba(37,99,235,.45),transparent_70%)]" />
        <div className="relative">
          <h2 className="mx-auto max-w-[20ch] text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.05] tracking-[-0.035em] text-white">
            {c.title} <span className="italic text-[#60a5fa]">{c.titleAccent}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-[#93a2ba]">{c.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className={btnPrimary}>{c.primary} →</Link>
            <Link href="/contact" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.07em] text-white transition hover:bg-white/10">{c.secondary}</Link>
          </div>
        </div>
      </div>
    </section>
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
    <div className="mb-12 last:mb-0">
      <h2 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15.5px] leading-[1.75] text-[var(--color-muted)]">
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

/** "Last updated: …" line for legal pages. */
export function LastUpdated({ text }: { text: string }) {
  return (
    <p className="mb-8 text-sm text-[var(--color-muted)]">{text}</p>
  );
}

/** Render a table inside a legal section (e.g. cookies or legal bases). */
export function LegalTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold text-[var(--color-fg)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--color-border)] last:border-0 align-top">
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-3 text-[var(--color-muted)]">
                  {ci === 0 ? (
                    <span className="font-medium text-[var(--color-fg)]">{cell}</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.type === "p") return <p>{block.text}</p>;
  if (block.type === "bullets") return <Bullets items={block.items} />;
  return <LegalTable headers={block.headers} rows={block.rows} />;
}

/** Render a full structured legal document (privacy / cookie policy). */
export function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <LastUpdated text={doc.updated} />
      <DraftNote />
      {doc.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.blocks.map((block, i) => (
            <LegalBlockView key={i} block={block} />
          ))}
        </Section>
      ))}
    </>
  );
}

export function DraftNote() {
  return (
    <div className="mb-12 rounded-2xl border border-[var(--color-warn-soft)] bg-[#fffbeb] px-5 py-4 text-sm leading-relaxed text-[#92400e]">
      This is early-product wording provided for transparency. It is not legal
      advice and will be finalized before general availability.
    </div>
  );
}
