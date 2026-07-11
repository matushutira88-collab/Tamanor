import Link from "next/link";
import { Platform } from "@guardora/core";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroMock } from "@/components/hero-mock";
import { ShieldEmblem } from "@/components/logo";
import { InboxMock, RiskDetailMock, ApprovalMock, TrendsMock } from "./app-mocks";
import { BrandIcon } from "@/components/dashboard/platform-icon";
import { IllusShield } from "@/components/illustrations";
import type { Dictionary, Locale } from "@/i18n";


const FEATURE_ICONS = [<IconShield key="s" />, <IconChart key="c" />, <IconReply key="r" />, <IconCheck key="k" />];

/** Brand figures — principle-based, verifiable facts (no fabricated KPIs). */
const STATS: { value: string; label: string; note: string }[] = [
  { value: "2", label: "Platforms live", note: "Facebook protection and Instagram monitoring. More platforms planned." },
  { value: "0", label: "Passwords stored", note: "Official OAuth / API connectors only — never client credentials." },
  { value: "100%", label: "Actions audited", note: "Every automated action is logged in a complete audit trail." },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Tamanor",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Tamanor — Social Account Firewall. Protect social accounts from spam, scams, harmful comments and repeated risky behavior with AI risk detection, human approval and a full audit log.",
  url: "https://guardora.ai",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free trial" },
};

export function LandingContent({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict;
  return (
    <main className="gu-dark min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteHeader dict={dict} locale={locale} />

      {/* Hero */}
      <section className="gu-hero relative overflow-hidden">
        <div className="gu-gridwave pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <div className="mb-7 lg:hidden">
              <ShieldEmblem size={88} />
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] shadow-[0_0_10px_var(--color-brand)]" />
              {t.hero.badge}
            </span>
            <h1 className="gu-display mt-6 text-4xl leading-[1.08] md:text-[54px]">
              {t.hero.titleBefore}{" "}
              <span className="bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-accent)] bg-clip-text text-transparent">
                {t.hero.titleHighlight}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
              {t.hero.subtitle}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/book-demo" className="rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)]">
                {t.common.requestBetaAccess}
              </Link>
              <Link href="/book-demo" className="rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]">
                {t.common.bookDemo}
              </Link>
            </div>
            <p className="mt-6 text-xs text-[var(--color-muted)]">{t.common.readOnlyTagline}</p>
          </div>
          <div className="lg:pl-6">
            <div className="mb-8 hidden justify-center lg:flex">
              <ShieldEmblem size={128} />
            </div>
            <HeroMock />
          </div>
        </div>
      </section>

      {/* Stats band — brand principles as figures. Honest, verifiable facts
          only (no fabricated KPIs, per Tamanor ground rules). */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="grid gap-8 sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.label} className="text-center sm:border-r sm:border-[var(--color-border)] sm:last:border-r-0">
                <div className="gu-stat text-6xl md:text-7xl">{s.value}</div>
                <p className="mt-3 text-sm font-medium text-[var(--color-fg)]">{s.label}</p>
                <p className="mx-auto mt-1 max-w-[13rem] text-xs leading-relaxed text-[var(--color-muted)]">{s.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.beta.whoEyebrow}</p>
            <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.beta.whoTitle}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.beta.whoBody}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {t.beta.whoSegments.map((s) => (
              <div key={s} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-5 text-sm font-medium transition hover:border-[var(--color-brand)]">{s}</div>
            ))}
          </div>
        </div>
      </section>

      {/* What Tamanor protects */}
      <section id="protects" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="max-w-2xl gu-display text-3xl md:text-4xl">{t.beta.protectsTitle}</h2>
          <div className="mt-10 flex flex-wrap gap-3">
            {t.beta.protectsItems.map((p) => (
              <span key={p} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />{p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.beta.howEyebrow}</p>
            <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.beta.howTitle}</h2>
          </div>
          <div className="flex flex-wrap items-stretch justify-center gap-3">
            {t.beta.howSteps.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="max-w-[220px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-center">
                  <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--color-muted)]">{t.control.step} {i + 1}</span>
                  <p className="mt-1 text-sm font-semibold">{step}</p>
                </div>
                {i < t.beta.howSteps.length - 1 ? <span className="text-[var(--color-brand)]">→</span> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Not censorship */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="gu-display text-2xl md:text-3xl">{t.beta.notCensorshipTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.beta.notCensorshipBody}</p>
          <p className="mx-auto mt-6 max-w-xl text-sm font-semibold">{t.beta.selfServiceTitle}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">{t.beta.selfServiceBody}</p>
        </div>
      </section>

      {/* Current platform support — honest about what's live today */}
      <section id="platforms" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.beta.platformEyebrow}</p>
            <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.beta.platformTitle}</h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.platformsSection.subtitle}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-[var(--color-brand)] bg-[var(--color-surface)] p-6">
              <div className="flex items-center gap-3">
                <BrandIcon platform={Platform.FacebookPage} size={32} />
                <span className="text-lg font-semibold">{t.beta.fbTitle}</span>
                <span className="ml-auto rounded-full bg-[var(--color-brand-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand)]">{t.beta.fbBadge}</span>
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{t.beta.fbBody}</p>
            </div>
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <div className="flex items-center gap-3">
                <BrandIcon platform={Platform.InstagramBusiness} size={32} />
                <span className="text-lg font-semibold">{t.beta.igTitle}</span>
                <span className="ml-auto rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-muted)]">{t.beta.igBadge}</span>
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{t.beta.igBody}</p>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">{t.beta.plannedNote}</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.features.eyebrow}</p>
            <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.features.title}</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {t.features.items.map((f, i) => (
              <article key={f.tag} className="group rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 transition hover:border-[var(--color-brand)]">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">{FEATURE_ICONS[i]}</span>
                <h3 className="mt-5 text-xl font-semibold">{f.tag}</h3>
                <p className="mt-2 leading-relaxed text-[var(--color-muted)]">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Product scenarios — illustrative, code-rendered UI mocks (demo data). */}
      <section id="product" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">
              {t.productMocks.eyebrow}
            </p>
            <h2 className="gu-display mt-3 text-3xl md:text-4xl">{t.productMocks.title}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.productMocks.subtitle}</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <InboxMock dict={dict} />
            <RiskDetailMock dict={dict} />
            <ApprovalMock dict={dict} />
            <TrendsMock dict={dict} />
          </div>

          <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
            {t.productMocks.disclaimer}
          </p>
        </div>
      </section>

      {/* AI + Human */}
      <section id="control" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="gu-display text-3xl md:text-4xl">{t.control.title}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.control.subtitle}</p>
          </div>
          <div className="mt-14 flex flex-wrap items-stretch justify-center gap-3">
            {t.control.flow.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-center">
                  <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--color-muted)]">{t.control.step} {i + 1}</span>
                  <p className="mt-1 text-sm font-semibold">{step}</p>
                </div>
                {i < t.control.flow.length - 1 ? <span className="text-[var(--color-brand)]">→</span> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="max-w-2xl gu-display text-3xl md:text-4xl">{t.audience.title}</h2>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {t.audience.items.map((a) => (
              <div key={a} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-6 text-sm font-medium transition hover:border-[var(--color-brand)]">{a}</div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.safety.eyebrow}</p>
              <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.safety.title}</h2>
              <p className="mt-4 max-w-md text-[var(--color-muted)]">{t.safety.subtitle}</p>
              <div className="mt-6 text-[var(--color-brand)]"><IllusShield size={120} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.safety.items.map((s) => (
                <div key={s} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><IconCheckSmall /></span>
                  <span className="text-sm">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Beta pricing — cards only, no billing and no payment flow */}
      <section id="pricing" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{t.beta.accessEyebrow}</p>
            <h2 className="mt-3 gu-display text-3xl md:text-4xl">{t.beta.pricingTitle}</h2>
            <p className="mt-3 text-[var(--color-muted)]">{t.beta.pricingSubtitle}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {t.beta.plans.map((p, i) => {
              const highlight = i === 1;
              return (
                <div key={p.name} className={`flex flex-col rounded-3xl border bg-[var(--color-surface)] p-6 ${highlight ? "border-[var(--color-brand)] shadow-[0_0_40px_rgba(25,195,154,0.18)]" : "border-[var(--color-border)]"}`}>
                  {highlight ? <span className="mb-2 inline-block rounded-full bg-[var(--color-brand-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand)]">{t.beta.mostPopular}</span> : null}
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  <p className="mt-3"><span className="text-3xl font-semibold text-[var(--color-brand)]">{p.price}</span><span className="text-sm text-[var(--color-muted)]">{t.beta.perMonth}</span></p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{p.tagline}</p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                    {p.features.map((f) => (<li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-[var(--color-brand)]"><IconCheckSmall /></span>{f}</li>))}
                  </ul>
                  <Link href="/book-demo" className={`mt-5 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${highlight ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]" : "border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"}`}>{t.common.requestBetaAccess}</Link>
                </div>
              );
            })}
            <div className="flex flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <h3 className="text-xl font-semibold">{t.beta.enterpriseName}</h3>
              <p className="mt-3 text-2xl font-semibold text-[var(--color-brand)]">{t.pricing.talkToUs}</p>
              <p className="mt-2 flex-1 text-sm text-[var(--color-muted)]">{t.beta.enterpriseTagline}</p>
              <Link href="/contact" className="mt-5 block rounded-xl border border-[var(--color-border-strong)] px-4 py-2.5 text-center text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">{t.beta.enterpriseCta}</Link>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">{t.beta.betaNote}</p>
        </div>
      </section>

      {/* CTA band */}
      <section id="demo" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="gu-hero relative overflow-hidden rounded-[32px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-8 py-14 text-center">
            <div className="gu-gridwave pointer-events-none absolute inset-0 opacity-60" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl gu-display text-3xl md:text-4xl">{t.cta.title}</h2>
              <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.cta.subtitle}</p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/book-demo" className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto">{t.common.requestBetaAccess}</Link>
                <Link href="/book-demo" className="w-full rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:w-auto">{t.common.bookDemo}</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter dict={dict} locale={locale} />
    </main>
  );
}

/* icons */
function IconShield() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>; }
function IconChart() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>; }
function IconReply() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7a4 4 0 0 1 0-8h9M13 5l-4 4 4 4" /><path d="M20 15v2a4 4 0 0 1-4 4H8" /></svg>; }
function IconCheck() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>; }
function IconCheckSmall() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>; }
