import { MarketingPage } from "@/components/marketing-page";
import { IllusShield, IllusNetwork, IllusChart, IllusApproval } from "@/components/illustrations";
import type { Dictionary, Locale } from "@/i18n";

const ICONS = [<IllusShield key="s" size={72} />, <IllusNetwork key="n" size={72} />, <IllusApproval key="a" size={72} />, <IllusChart key="c" size={72} />];

export function CaseStudiesContent({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.caseStudies;
  return (
    <MarketingPage eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} dict={dict} locale={locale} width="wide" cta>
      <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
        {t.exampleBadge}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {t.cases.map((c, i) => (
          <article key={c.tag} className="rounded-3xl border border-[var(--color-border)] bg-white p-7 shadow-[0_10px_30px_rgba(15,23,42,.04)] md:p-8">
            <div className="flex items-center gap-4">
              <span className="text-[var(--color-brand)]">{ICONS[i]}</span>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.exampleLabel}</span>
                <h3 className="text-xl font-semibold">{c.tag}</h3>
              </div>
            </div>
            <dl className="mt-6 space-y-4 border-t border-[var(--color-border)] pt-6 text-[14.5px] leading-relaxed">
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

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-[var(--color-muted)]">{t.footerNote}</p>
    </MarketingPage>
  );
}
