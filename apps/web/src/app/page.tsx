import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroMock } from "@/components/hero-mock";
import { IllusShield } from "@/components/illustrations";

export const metadata: Metadata = {
  title: "Guardora.ai — AI Reputation Firewall for modern brands",
  description:
    "Guardora monitors comments, reviews and audience feedback across Facebook, Instagram, YouTube, LinkedIn, TikTok and Google — detects risk, prepares safe actions and keeps humans in control.",
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Guardora.ai",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI Reputation Firewall for modern brands. Protect comments, reviews and reputation across social platforms with AI risk detection, human approval and a full audit log.",
  url: "https://guardora.ai",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free trial" },
};

const PLATFORMS = [
  { short: "Fb", tint: "#4267ff", label: "Facebook Page" },
  { short: "Ig", tint: "#e1476f", label: "Instagram Business" },
  { short: "Yt", tint: "#ff5c72", label: "YouTube" },
  { short: "In", tint: "#3ea6ff", label: "LinkedIn Company Page" },
  { short: "Tk", tint: "#19c39a", label: "TikTok" },
  { short: "G", tint: "#f3b657", label: "Google Business Profile" },
  { short: "{ }", tint: "#8aa8a2", label: "API" },
];

const FEATURES = [
  {
    tag: "Protect",
    body: "Detect spam, scams, hate, vulgarity, misinformation and brand attacks before they damage trust.",
    icon: <IconShield />,
  },
  {
    tag: "Analyze",
    body: "Understand sentiment, risk trends, topics, posts and recurring customer concerns across all platforms.",
    icon: <IconChart />,
  },
  {
    tag: "Respond",
    body: "Generate safe suggested replies in your brand tone, ready for human review.",
    icon: <IconReply />,
  },
  {
    tag: "Approve",
    body: "Every sensitive action goes through a controlled approval workflow with a full audit trail.",
    icon: <IconCheck />,
  },
];

const AUDIENCES = [
  "Agencies",
  "Real estate brands",
  "E-commerce",
  "Media",
  "Hospitality",
  "Public institutions",
  "Sports clubs",
  "Local businesses",
];

const SAFETY = [
  "Official OAuth / API connectors only",
  "No scraping",
  "No client passwords",
  "Token-safe architecture",
  "Approval workflow",
  "Audit log",
  "Read-only mode by default",
  "Platform capability checks",
];

const FLOW = ["Comment", "AI risk analysis", "Proposed action", "Human approval", "Audit log"];

const PRICING = [
  { name: "Starter", tagline: "For getting started", note: "Coming soon" },
  { name: "Business", tagline: "For growing brands", note: "Coming soon", highlight: true },
  { name: "Agency", tagline: "For multi-brand teams", note: "Coming soon" },
  { name: "Enterprise", tagline: "For scale & compliance", note: "Talk to us" },
];

export default function LandingPage() {
  return (
    <main className="gu-dark min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <SiteHeader />

      {/* ---------------------------------------------------------------- Hero */}
      <section className="gu-hero relative overflow-hidden">
        <div className="gu-gridwave pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] shadow-[0_0_10px_var(--color-brand)]" />
              AI Reputation Firewall
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight md:text-[54px]">
              Protect your brand before harmful comments become a{" "}
              <span className="bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-accent)] bg-clip-text text-transparent">
                crisis
              </span>
              .
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
              Guardora monitors comments, reviews and audience feedback across
              Facebook, Instagram, YouTube, LinkedIn, TikTok and Google —
              detects risk, prepares safe actions and keeps humans in control.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/login"
                className="rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)]"
              >
                Start free trial
              </Link>
              <Link
                href="/book-demo"
                className="rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
              >
                Book a demo
              </Link>
            </div>
            <p className="mt-6 text-xs text-[var(--color-muted)]">
              Read-only by default · Official OAuth only · No scraping
            </p>
          </div>

          <div className="lg:pl-6">
            <HeroMock />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Platforms */}
      <section id="platforms" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
            One reputation inbox for every public channel.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">
            Connect official OAuth / API integrations. No scraping. No shared
            passwords.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {PLATFORMS.map((p) => (
              <div
                key={p.label}
                className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold text-[#04120f]"
                  style={{ backgroundColor: p.tint }}
                >
                  {p.short}
                </span>
                <span className="text-sm">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- Features */}
      <section id="features" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">
              What Guardora does
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              From noisy feedback to controlled action.
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {FEATURES.map((f) => (
              <article
                key={f.tag}
                className="group rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 transition hover:border-[var(--color-brand)]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  {f.icon}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{f.tag}</h3>
                <p className="mt-2 leading-relaxed text-[var(--color-muted)]">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- AI + Human */}
      <section id="control" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              AI speed. Human control. Full audit.
            </h2>
            <p className="mt-4 text-[var(--color-muted)]">
              Guardora can classify thousands of comments quickly, but sensitive
              actions remain approval-gated. Teams can approve, reject, escalate
              or resolve items with a complete audit log.
            </p>
          </div>

          {/* Flow */}
          <div className="mt-14 flex flex-wrap items-stretch justify-center gap-3">
            {FLOW.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-center">
                  <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--color-muted)]">
                    Step {i + 1}
                  </span>
                  <p className="mt-1 text-sm font-semibold">{step}</p>
                </div>
                {i < FLOW.length - 1 ? (
                  <span className="text-[var(--color-brand)]">→</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- Audience */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
            Built for brands that cannot afford reputation chaos.
          </h2>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {AUDIENCES.map((a) => (
              <div
                key={a}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-6 text-sm font-medium transition hover:border-[var(--color-brand)]"
              >
                {a}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Safety */}
      <section id="safety" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">
                Trust &amp; safety
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Safe by design.
              </h2>
              <p className="mt-4 max-w-md text-[var(--color-muted)]">
                Guardora is built to protect your brand without ever putting your
                accounts or your customers at risk.
              </p>
              <div className="mt-6 text-[var(--color-brand)]">
                <IllusShield size={120} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SAFETY.map((s) => (
                <div
                  key={s}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                    <IconCheckSmall />
                  </span>
                  <span className="text-sm">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Pricing */}
      <section id="pricing" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Simple plans for every stage.
            </h2>
            <p className="mt-3 text-[var(--color-muted)]">
              Pricing is being finalized. Start free today.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`rounded-3xl border bg-[var(--color-surface)] p-6 ${
                  p.highlight
                    ? "border-[var(--color-brand)] shadow-[0_0_40px_rgba(25,195,154,0.18)]"
                    : "border-[var(--color-border)]"
                }`}
              >
                {p.highlight ? (
                  <span className="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand)]">
                    Popular
                  </span>
                ) : (
                  <span className="text-xs text-[var(--color-muted)]">{p.tagline}</span>
                )}
                <h3 className="mt-3 text-xl font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{p.tagline}</p>
                <p className="mt-6 text-2xl font-semibold text-[var(--color-brand)]">
                  {p.note}
                </p>
                <Link
                  href={p.note === "Talk to us" ? "/contact" : "/book-demo"}
                  className={`mt-5 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                    p.highlight
                      ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]"
                      : "border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {p.note === "Talk to us" ? "Contact sales" : "Get notified"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- CTA band */}
      <section id="demo" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="gu-hero relative overflow-hidden rounded-[32px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-8 py-14 text-center">
            <div className="gu-gridwave pointer-events-none absolute inset-0 opacity-60" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
                Put a firewall in front of your brand&rsquo;s reputation.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[var(--color-muted)]">
                Start in read-only mode. Connect your channels. Keep every action
                under human control.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.4)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto"
                >
                  Start free trial
                </Link>
                <Link
                  href="/book-demo"
                  className="w-full rounded-xl border border-[var(--color-border-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:w-auto"
                >
                  Book a demo
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Footer */}
      <SiteFooter />
    </main>
  );
}

/* ------------------------------------------------------------------ icons */
function IconShield() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>;
}
function IconChart() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
}
function IconReply() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7a4 4 0 0 1 0-8h9M13 5l-4 4 4 4" /><path d="M20 15v2a4 4 0 0 1-4 4H8" /></svg>;
}
function IconCheck() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>;
}
function IconCheckSmall() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10" /></svg>;
}
