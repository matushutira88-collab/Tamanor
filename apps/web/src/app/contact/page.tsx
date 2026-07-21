import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { submitLead } from "../book-demo/actions";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Contact — Tamanor",
    description: "Get in touch with the Tamanor team, or book a personalized demo.",
  },
  sk: {
    title: "Kontakt — Tamanor",
    description: "Spojte sa s tímom Tamanor alebo si rezervujte personalizované demo.",
  },
  de: {
    title: "Kontakt — Tamanor",
    description: "Nehmen Sie Kontakt mit dem Tamanor-Team auf oder buchen Sie eine persönliche Demo.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return META[locale];
}

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none transition focus:border-[var(--color-brand)]";

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    emailLabel: string;
    securityLabel: string;
    liveWalkthroughTitle: string;
    liveWalkthroughBody: string;
    startFree: string;
    sentTitle: string;
    sentBody: string;
    nameLabel: string;
    namePlaceholder: string;
    emailFieldLabel: string;
    emailPlaceholder: string;
    messageLabel: string;
    messagePlaceholder: string;
    consentPre: string;
    privacyNotice: string;
    consentPost: string;
    sendMessage: string;
  }
> = {
  en: {
    eyebrow: "Contact",
    title: "Talk to the Tamanor team.",
    subtitle: "Questions, partnerships, or a personalized walkthrough — we're here.",
    emailLabel: "Email",
    securityLabel: "Security",
    liveWalkthroughTitle: "Prefer to explore it yourself?",
    liveWalkthroughBody: "Create a free workspace and a 14-day trial in a couple of minutes.",
    startFree: "Start free",
    sentTitle: "Message received.",
    sentBody:
      "Thanks for reaching out — your message was saved and we’ll get back to you shortly.",
    nameLabel: "Name *",
    namePlaceholder: "Your name",
    emailFieldLabel: "Work email *",
    emailPlaceholder: "you@company.com",
    messageLabel: "Message",
    messagePlaceholder: "How can we help?",
    consentPre: "I agree to be contacted and accept the ",
    privacyNotice: "privacy notice",
    consentPost: ".",
    sendMessage: "Send message",
  },
  sk: {
    eyebrow: "Kontakt",
    title: "Napíšte tímu Tamanor.",
    subtitle: "Otázky, partnerstvá alebo personalizovaná prehliadka — sme tu pre vás.",
    emailLabel: "E-mail",
    securityLabel: "Bezpečnosť",
    liveWalkthroughTitle: "Chcete si to vyskúšať sami?",
    liveWalkthroughBody: "Vytvorte si pracovný priestor a 14-dňovú skúšobnú verziu za pár minút.",
    startFree: "Začať zdarma",
    sentTitle: "Správa prijatá.",
    sentBody: "Ďakujeme, že ste nás kontaktovali — vaša správa bola uložená a čoskoro sa vám ozveme.",
    nameLabel: "Meno *",
    namePlaceholder: "Vaše meno",
    emailFieldLabel: "Pracovný e-mail *",
    emailPlaceholder: "vy@firma.com",
    messageLabel: "Správa",
    messagePlaceholder: "Ako vám môžeme pomôcť?",
    consentPre: "Súhlasím s tým, aby ma kontaktovali, a akceptujem ",
    privacyNotice: "zásady ochrany súkromia",
    consentPost: ".",
    sendMessage: "Odoslať správu",
  },
  de: {
    eyebrow: "Kontakt",
    title: "Sprechen Sie mit dem Tamanor-Team.",
    subtitle: "Fragen, Partnerschaften oder eine persönliche Vorführung — wir sind für Sie da.",
    emailLabel: "E-Mail",
    securityLabel: "Sicherheit",
    liveWalkthroughTitle: "Lieber selbst ausprobieren?",
    liveWalkthroughBody: "Erstellen Sie in wenigen Minuten einen Arbeitsbereich und eine 14-tägige Testphase.",
    startFree: "Kostenlos starten",
    sentTitle: "Nachricht erhalten.",
    sentBody:
      "Danke für Ihre Kontaktaufnahme — Ihre Nachricht wurde gespeichert und wir melden uns in Kürze bei Ihnen.",
    nameLabel: "Name *",
    namePlaceholder: "Ihr Name",
    emailFieldLabel: "Geschäftliche E-Mail *",
    emailPlaceholder: "sie@firma.com",
    messageLabel: "Nachricht",
    messagePlaceholder: "Wie können wir helfen?",
    consentPre: "Ich bin damit einverstanden, kontaktiert zu werden, und akzeptiere die ",
    privacyNotice: "Datenschutzhinweise",
    consentPost: ".",
    sendMessage: "Nachricht senden",
  },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const _lp = await getTL();
  const c = COPY[_lp.locale];
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const error = sp.error;

  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale} eyebrow={c.eyebrow} title={c.title} subtitle={c.subtitle}>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <p className="text-sm font-semibold">{c.emailLabel}</p>
            <a href="mailto:hello@tamanor.com" className="mt-1 block text-[var(--color-brand)] hover:underline">hello@tamanor.com</a>
            <p className="mt-4 text-sm font-semibold">{c.securityLabel}</p>
            <a href="mailto:security@tamanor.com" className="mt-1 block text-[var(--color-brand)] hover:underline">security@tamanor.com</a>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <p className="text-sm font-semibold">{c.liveWalkthroughTitle}</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{c.liveWalkthroughBody}</p>
            <Link href="/register" className="mt-3 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
              {c.startFree}
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 md:p-8">
          {sent ? (
            <div>
              <p className="text-lg font-semibold">{c.sentTitle}</p>
              <p className="mt-2 text-[var(--color-muted)]">{c.sentBody}</p>
            </div>
          ) : (
            <form action={submitLead} className="space-y-5">
              <input type="hidden" name="source" value="contact" />
              {error ? (
                <p className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-2.5 text-sm text-[var(--color-danger)]">{error}</p>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.nameLabel}</span>
                <input name="name" required placeholder={c.namePlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.emailFieldLabel}</span>
                <input name="email" type="email" required placeholder={c.emailPlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.messageLabel}</span>
                <textarea name="message" rows={4} placeholder={c.messagePlaceholder} className={inputClass} />
              </label>
              <label className="flex items-start gap-2.5 text-sm text-[var(--color-muted)]">
                <input type="checkbox" name="consent" className="mt-0.5 accent-[var(--color-brand)]" />
                <span>{c.consentPre}<a href="/privacy" className="text-[var(--color-brand)] hover:underline">{c.privacyNotice}</a>{c.consentPost}</span>
              </label>
              <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto">
                {c.sendMessage}
              </button>
            </form>
          )}
        </div>
      </div>
    </MarketingPage>
  );
}
