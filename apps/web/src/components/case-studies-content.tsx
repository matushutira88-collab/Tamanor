import Link from "next/link";
import { MarketingPage } from "@/components/marketing-page";
import { IllusShield, IllusNetwork, IllusChart, IllusApproval } from "@/components/illustrations";
import type { Dictionary, Locale } from "@/i18n";

const ICONS = [<IllusShield key="s" size={72} />, <IllusNetwork key="n" size={72} />, <IllusApproval key="a" size={72} />, <IllusChart key="c" size={72} />];

export function CaseStudiesContent({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.caseStudies;
  return (
    <MarketingPage eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} dict={dict} locale={locale}>
      <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
        {t.exampleBadge}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {t.cases.map((c, i) => (
          <article key={c.tag} className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7">
            <div className="flex items-center gap-4">
              <span className="text-[var(--color-brand)]">{ICONS[i]}</span>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.exampleLabel}</span>
                <h3 className="text-xl font-semibold">{c.tag}</h3>
              </div>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">{t.problemLabel}</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.problem}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">{t.helpsLabel}</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.solution}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">{t.outcomeLabel}</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.outcome}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 text-center">
        <p className="text-sm text-[var(--color-muted)]">{t.footerNote}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
            {dict.common.startFree}
          </Link>
          <Link href="/login" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">
            {dict.common.logIn}
          </Link>
        </div>
      </div>
    </MarketingPage>
  );
}
