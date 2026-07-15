import Link from "next/link";
import { Platform, publicPricingProjection } from "@guardora/core";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroMock } from "@/components/hero-mock";
import { ShieldEmblem } from "@/components/logo";
import { InboxMock, RiskDetailMock, ApprovalMock, TrendsMock } from "./app-mocks";
import { PricingPlans } from "./pricing-plans";
import { BrandIcon } from "@/components/dashboard/platform-icon";
import { IllusShield } from "@/components/illustrations";
import { JsonLd } from "@/components/json-ld";
import { faqLd } from "@/lib/jsonld";
import { localePrefix, type Dictionary, type Locale } from "@/i18n";


/** Brand figures — principle-based, verifiable facts (no fabricated KPIs). */
const STATS: { value: string; label: string; note: string }[] = [
  { value: "2", label: "Platforms live", note: "Facebook protection and Instagram monitoring. More platforms planned." },
  { value: "0", label: "Platform passwords stored", note: "Social accounts connect via official OAuth — we never see or store your Facebook, Instagram or Google passwords." },
  { value: "100%", label: "Actions audited", note: "Every automated action is logged in a complete audit trail." },
];

// V1.38.2 — the SoftwareApplication/Organization/WebSite JSON-LD is now emitted once,
// sitewide, from the root layout (canonical origin tamanor.com), so every locale of the
// landing page inherits a single consistent entity graph instead of a duplicated block.

/** Editorial eyebrow with a short brand rule — a small human touch that reads
 *  as a label rather than another line of body text. */
function Eyebrow({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <p className={`flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-brand)] ${center ? "justify-center" : ""}`}>
      <span className="h-px w-6 shrink-0 bg-gradient-to-r from-transparent to-[var(--color-brand)]" />
      <span>{children}</span>
      {center ? <span className="h-px w-6 shrink-0 bg-gradient-to-l from-transparent to-[var(--color-brand)]" /> : null}
    </p>
  );
}

export function LandingContent({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict;
  const trustChips = [t.common.oauthOnly, t.common.noScraping, t.common.humanApproval];

  return (
    <main className="gu-dark min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SiteHeader dict={dict} locale={locale} />

      {/* Hero */}
      <section className="gu-hero relative overflow-hidden">
        <div className="gu-gridwave pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 pt-20 pb-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-28 lg:pb-36">
          <div>
            <div className="mb-7 lg:hidden">
              <ShieldEmblem size={88} />
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-3 py-1 text-xs text-[var(--color-muted)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] shadow-[0_0_10px_var(--color-brand)]" />
              {t.hero.badge}
            </span>
            <h1 className="gu-display mt-6 text-4xl leading-[1.06] md:text-[56px]">
              {t.hero.titleBefore}{" "}
              <span className="bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-accent)] bg-clip-text text-transparent">
                {t.hero.titleHighlight}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
              {t.hero.subtitle}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/register" className="rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)]">
                {t.common.startFree}
              </Link>
              <Link href={`${localePrefix(locale)}/security`} className="rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]">
                {t.common.reviewSecurity}
              </Link>
            </div>
            {/* Trust chips — real, verifiable principles instead of a single grey line. */}
            <div className="mt-7 flex flex-wrap gap-2">
              {trustChips.map((chip) => (
                <span key={chip} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-1 text-xs text-[var(--color-muted)]">
                  <span className="text-[var(--color-brand)]"><IconCheckSmall /></span>
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div className="lg:pl-6">
            <div className="mb-8 hidden justify-center lg:flex">
              <ShieldEmblem size={128} />
            </div>
            <HeroMock availableLabel={t.beta.providersAvailable} researchLabel={t.beta.providersResearch} />
          </div>
        </div>
      </section>

      {/* Stats band — floats up to overlap the hero, tying the fold together.
          Honest, verifiable figures only (no fabricated KPIs). */}
      <section className="relative z-10 -mt-16 lg:-mt-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="gu-elevate grid gap-px overflow-hidden rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-border)] sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.label} className="bg-[var(--color-surface)] px-6 py-8 text-center">
                <div className="gu-stat text-5xl md:text-6xl">{s.value}</div>
                <p className="mt-3 text-sm font-semibold text-[var(--color-fg)]">{s.label}</p>
                <p className="mx-auto mt-1.5 max-w-[15rem] text-xs leading-relaxed text-[var(--color-muted)]">{s.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="mb-10 max-w-2xl">
            <Eyebrow>{t.beta.whoEyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.beta.whoTitle}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.beta.whoBody}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {t.beta.whoSegments.map((s) => (
              <div key={s} className="gu-lift rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-5 text-sm font-medium">{s}</div>
            ))}
          </div>
        </div>
      </section>

      {/* What Tamanor protects */}
      <section id="protects" className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <h2 className="gu-display text-3xl md:text-4xl">{t.beta.protectsTitle}</h2>
            <div className="flex flex-wrap gap-2.5">
              {t.beta.protectsItems.map((p) => (
                <span key={p} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" />{p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      {/* V1.49D — operating model: Connect → Monitor → Review → Decide → Act → Improve.
          Six real, in-product steps; ordering (not colour) carries the sequence. */}
      <section id="how" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="mb-12 mx-auto max-w-2xl text-center">
            <Eyebrow center>{t.landing.operating.eyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.landing.operating.title}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.landing.operating.subtitle}</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.landing.operating.steps.map((step, i) => (
              <li key={step.name} className="gu-lift group relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                <span className="gu-display absolute right-5 top-4 text-4xl text-[var(--color-border-strong)] transition-colors group-hover:text-[var(--color-brand-soft)]">{i + 1 < 10 ? `0${i + 1}` : i + 1}</span>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-sm font-semibold text-[var(--color-brand)]">{i + 1}</span>
                  <h3 className="text-base font-semibold">{step.name}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Not censorship — set apart as a quiet editorial statement panel. */}
      <section className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <span className="gu-display text-5xl leading-none text-[var(--color-brand-soft)]">&ldquo;</span>
          <h2 className="gu-display -mt-4 text-2xl md:text-3xl">{t.beta.notCensorshipTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.beta.notCensorshipBody}</p>
          <div className="mx-auto mt-8 h-px w-16 bg-[var(--color-border-strong)]" />
          <p className="mx-auto mt-6 max-w-xl text-sm font-semibold">{t.beta.selfServiceTitle}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">{t.beta.selfServiceBody}</p>
        </div>
      </section>

      {/* Current platform support — honest about what's live today */}
      <section id="platforms" className="scroll-mt-20">
        <div className="mx-auto max-w-5xl px-6 py-20 lg:py-24">
          <div className="mb-10 text-center">
            <Eyebrow center>{t.beta.platformEyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.beta.platformTitle}</h2>
            <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.platformsSection.subtitle}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="gu-lift rounded-3xl border border-[var(--color-brand)] bg-gradient-to-b from-[var(--color-brand-soft)]/40 to-[var(--color-surface)] p-6">
              <div className="flex items-center gap-3">
                <BrandIcon platform={Platform.FacebookPage} size={32} />
                <span className="text-lg font-semibold">{t.beta.fbTitle}</span>
                <span className="ml-auto rounded-full bg-[var(--color-brand)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand-fg)]">{t.beta.fbBadge}</span>
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{t.beta.fbBody}</p>
            </div>
            <div className="gu-lift rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <div className="flex items-center gap-3">
                <BrandIcon platform={Platform.InstagramBusiness} size={32} />
                <span className="text-lg font-semibold">{t.beta.igTitle}</span>
                <span className="ml-auto rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-muted)]">{t.beta.igBadge}</span>
              </div>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{t.beta.igBody}</p>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">{t.beta.plannedNote}</p>
          <p className="mt-1 text-center text-xs text-[var(--color-muted)]">{t.beta.googleConnectorNote}</p>
        </div>
      </section>

      {/* V1.49D — system architecture: the real path a provider signal follows,
          from OAuth-verified connection through human-approved, audited decision. */}
      <section id="architecture" className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Eyebrow>{t.landing.architecture.eyebrow}</Eyebrow>
              <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.landing.architecture.title}</h2>
              <p className="mt-4 text-[var(--color-muted)]">{t.landing.architecture.subtitle}</p>
              <p className="mt-6 text-xs leading-relaxed text-[var(--color-muted)]">{t.landing.architecture.note}</p>
            </div>
            <ol className="relative">
              {t.landing.architecture.stages.map((stage, i) => (
                <li key={stage.name} className="relative flex gap-4 pb-7 last:pb-0">
                  {i < t.landing.architecture.stages.length - 1 ? (
                    <span aria-hidden="true" className="absolute left-4 top-9 h-[calc(100%-1.25rem)] w-px bg-gradient-to-b from-[var(--color-brand-soft)] to-[var(--color-border)]" />
                  ) : null}
                  <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] text-sm font-semibold text-[var(--color-brand)]">{i + 1}</span>
                  <div className="pt-1">
                    <h3 className="text-base font-semibold">{stage.name}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted)]">{stage.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* V1.49D — capability groups: six areas grouped by how teams work. */}
      <section id="features" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="mb-12 max-w-2xl">
            <Eyebrow>{t.landing.capabilities.eyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.landing.capabilities.title}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.landing.capabilities.subtitle}</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {t.landing.capabilities.groups.map((g) => (
              <article key={g.name} className="gu-lift rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                <h3 className="flex items-center gap-2.5 text-lg font-semibold">
                  <span className="h-4 w-1 rounded-full bg-[var(--color-brand)]" />
                  {g.name}
                </h3>
                <ul className="mt-4 space-y-2 text-sm text-[var(--color-muted)]">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-[var(--color-brand)]"><IconCheckSmall /></span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Product scenarios — illustrative, code-rendered UI mocks (demo data). */}
      <section id="product" className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="mb-12 max-w-2xl">
            <Eyebrow>{t.productMocks.eyebrow}</Eyebrow>
            <h2 className="gu-display mt-4 text-3xl md:text-4xl">{t.productMocks.title}</h2>
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
      <section id="control" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="gu-display text-3xl md:text-4xl">{t.control.title}</h2>
            <p className="mt-4 text-[var(--color-muted)]">{t.control.subtitle}</p>
          </div>
          <div className="mt-14 flex flex-wrap items-stretch justify-center gap-3">
            {t.control.flow.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-center transition hover:border-[var(--color-brand)]">
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
      <section className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <h2 className="max-w-2xl gu-display text-3xl md:text-4xl">{t.audience.title}</h2>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {t.audience.items.map((a) => (
              <div key={a} className="gu-lift rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-6 text-sm font-medium">{a}</div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <Eyebrow>{t.safety.eyebrow}</Eyebrow>
              <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.safety.title}</h2>
              <p className="mt-4 max-w-md text-[var(--color-muted)]">{t.safety.subtitle}</p>
              <div className="mt-6 text-[var(--color-brand)]"><IllusShield size={120} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.safety.items.map((s) => (
                <div key={s} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 transition hover:border-[var(--color-brand)]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><IconCheckSmall /></span>
                  <span className="text-sm">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* V1.49D — buyer FAQ. The visible questions/answers are the single source
          of truth; the FAQPage JSON-LD below is generated from the same array. */}
      <section id="faq" className="gu-band scroll-mt-20">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <div className="mb-10 text-center">
            <Eyebrow center>{t.landing.faq.eyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.landing.faq.title}</h2>
          </div>
          <div className="space-y-3">
            {t.landing.faq.items.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 transition open:border-[var(--color-border-strong)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span aria-hidden="true" className="shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
        <JsonLd data={faqLd(t.landing.faq.items)} />
      </section>

      {/* Beta pricing — cards only, no billing and no payment flow */}
      <section id="pricing" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="mb-12 text-center">
            <Eyebrow center>{t.beta.accessEyebrow}</Eyebrow>
            <h2 className="mt-4 gu-display text-3xl md:text-4xl">{t.beta.pricingTitle}</h2>
            <p className="mt-3 text-[var(--color-muted)]">{t.beta.pricingSubtitle}</p>
          </div>
          {/* V1.50F — prices + plan NAMES come from the single canonical catalogue (publicPricingProjection);
              the translation dictionary supplies only localized taglines + feature labels. There is no
              parallel numeric plan array — a translator can never change a commercial price/limit. */}
          <PricingPlans
            plans={publicPricingProjection().plans.map((card, i) => ({
              name: card.name,
              price: `€${card.priceMonthly}`,
              tagline: t.beta.plans[i]?.tagline ?? card.tagline,
              features: t.beta.plans[i]?.features ?? card.features,
            }))}
            enterprise={{
              name: publicPricingProjection().enterprise.name,
              price: t.pricing.talkToUs,
              tagline: t.beta.enterpriseTagline,
              features: t.beta.enterpriseFeatures,
              cta: t.beta.enterpriseCta,
            }}
            labels={{
              mostPopular: t.beta.mostPopular,
              perMonth: t.beta.perMonth,
              perYear: t.beta.perYear,
              monthly: t.beta.billingMonthly,
              yearly: t.beta.billingYearly,
              startFree: t.common.startFree,
            }}
            locale={locale}
          />
          <p className="mt-6 text-center text-xs text-[var(--color-muted)]">{t.beta.betaNote}</p>
        </div>
      </section>

      {/* CTA band */}
      <section id="demo" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-6 pb-24 pt-4">
          <div className="gu-hero relative overflow-hidden rounded-[32px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-8 py-16 text-center">
            <div className="gu-gridwave pointer-events-none absolute inset-0 opacity-60" />
            <div className="relative">
              <div className="mx-auto mb-6 w-fit"><ShieldEmblem size={64} /></div>
              <h2 className="mx-auto max-w-2xl gu-display text-3xl md:text-4xl">{t.cta.title}</h2>
              <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">{t.cta.subtitle}</p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/register" className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto">{t.common.startFree}</Link>
                <Link href="/login" className="w-full rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:w-auto">{t.common.logIn}</Link>
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
function IconCheckSmall() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>; }
