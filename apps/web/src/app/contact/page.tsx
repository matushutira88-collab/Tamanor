import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { submitLead } from "../book-demo/actions";

export const metadata: Metadata = {
  title: "Contact — Tamanor",
  description: "Get in touch with the Tamanor team, or book a personalized demo.",
};

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none transition focus:border-[var(--color-brand)]";

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const _lp = await getTL();
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const error = sp.error;

  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale} eyebrow="Contact" title="Talk to the Tamanor team." subtitle="Questions, partnerships, or a personalized walkthrough — we're here.">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <p className="text-sm font-semibold">Email</p>
            <a href="mailto:hello@guardora.ai" className="mt-1 block text-[var(--color-brand)] hover:underline">hello@guardora.ai</a>
            <p className="mt-4 text-sm font-semibold">Security</p>
            <a href="mailto:security@guardora.ai" className="mt-1 block text-[var(--color-brand)] hover:underline">security@guardora.ai</a>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <p className="text-sm font-semibold">Prefer a live walkthrough?</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">See Tamanor protect a brand in read-only mode.</p>
            <Link href="/book-demo" className="mt-3 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
              Book a demo
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8">
          {sent ? (
            <div>
              <p className="text-lg font-semibold">Message received.</p>
              <p className="mt-2 text-[var(--color-muted)]">Thanks for reaching out — your message was saved and we&rsquo;ll get back to you shortly.</p>
            </div>
          ) : (
            <form action={submitLead} className="space-y-5">
              <input type="hidden" name="source" value="contact" />
              {error ? (
                <p className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-2.5 text-sm text-[var(--color-danger)]">{error}</p>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Name *</span>
                <input name="name" required placeholder="Your name" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Work email *</span>
                <input name="email" type="email" required placeholder="you@company.com" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Message</span>
                <textarea name="message" rows={4} placeholder="How can we help?" className={inputClass} />
              </label>
              <label className="flex items-start gap-2.5 text-sm text-[var(--color-muted)]">
                <input type="checkbox" name="consent" className="mt-0.5 accent-[var(--color-brand)]" />
                <span>I agree to be contacted and accept the <a href="/privacy" className="text-[var(--color-brand)] hover:underline">privacy notice</a>.</span>
              </label>
              <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto">
                Send message
              </button>
            </form>
          )}
        </div>
      </div>
    </MarketingPage>
  );
}
