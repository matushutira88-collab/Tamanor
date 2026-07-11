import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { submitLead } from "./actions";

export const metadata: Metadata = {
  title: "Request beta access — Tamanor",
  description:
    "Request Tamanor beta access. Tell us about your brand and channels and we'll set up a personalized, read-only walkthrough.",
};

export const dynamic = "force-dynamic";

const PLATFORMS = ["Facebook", "Instagram", "TikTok", "YouTube", "LinkedIn", "Google Business", "Other"];
const SEGMENTS = ["Agency", "E-shop / brand", "Influencer / creator", "Public figure", "Real estate / developer", "Hotel / restaurant / service", "Other"];

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none transition focus:border-[var(--color-brand)]";

export default async function BookDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const _lp = await getTL();
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const error = sp.error;

  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow="Beta pilot"
      title="Request Tamanor beta access."
      subtitle="Tamanor is in beta pilot. Tell us about your brand and channels — we'll set up a personalized, read-only walkthrough."
    >
      {sent ? (
        <div className="rounded-2xl border border-[var(--color-brand)] bg-[var(--color-surface)] p-6">
          <p className="text-lg font-semibold">Thanks — we&rsquo;ve got your beta request.</p>
          <p className="mt-2 text-[var(--color-muted)]">
            Your details were saved and our team will reach out about beta
            access. No spam, ever.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8">
          {error ? (
            <p className="mb-5 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-2.5 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}

          <form action={submitLead} className="space-y-5">
            <input type="hidden" name="source" value="book_demo" />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Name *</span>
                <input name="name" required placeholder="Your name" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Work email *</span>
                <input name="email" type="email" required placeholder="you@company.com" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Company</span>
                <input name="company" placeholder="Company name" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Website</span>
                <input name="website" placeholder="https://…" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">You are a…</span>
                <select name="segment" defaultValue="" className={inputClass}>
                  <option value="" disabled>Select a segment</option>
                  {SEGMENTS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Number of social accounts</span>
                <input name="accounts" placeholder="e.g. 3" className={inputClass} />
              </label>
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium">Platforms used</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-3 py-1.5 text-sm">
                    <input type="checkbox" name="platforms" value={p} className="accent-[var(--color-brand)]" />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Message</span>
              <textarea name="message" rows={4} placeholder="What would you like to protect?" className={inputClass} />
            </label>

            <label className="flex items-start gap-2.5 text-sm text-[var(--color-muted)]">
              <input type="checkbox" name="consent" className="mt-0.5 accent-[var(--color-brand)]" />
              <span>
                I agree to be contacted about Tamanor and accept the{" "}
                <a href="/privacy" className="text-[var(--color-brand)] hover:underline">privacy notice</a>.
              </span>
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto"
            >
              Request beta access
            </button>
          </form>
        </div>
      )}
    </MarketingPage>
  );
}
