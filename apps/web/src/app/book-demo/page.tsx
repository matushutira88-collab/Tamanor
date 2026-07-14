import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { submitLead } from "./actions";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Request beta access — Tamanor",
    description:
      "Request Tamanor beta access. Tell us about your brand and channels and we'll set up a personalized, read-only walkthrough.",
  },
  sk: {
    title: "Požiadať o prístup k beta verzii — Tamanor",
    description:
      "Požiadajte o prístup k beta verzii Tamanoru. Povedzte nám o svojej značke a kanáloch a pripravíme personalizovanú prehliadku v režime iba na čítanie.",
  },
  de: {
    title: "Beta-Zugang anfragen — Tamanor",
    description:
      "Fordern Sie den Beta-Zugang zu Tamanor an. Erzählen Sie uns von Ihrer Marke und Ihren Kanälen, und wir richten eine persönliche, schreibgeschützte Vorführung ein.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return META[locale];
}

export const dynamic = "force-dynamic";

const PLATFORMS = ["Facebook", "Instagram", "TikTok", "YouTube", "LinkedIn", "Google Business", "Other"];

// Stable segment values (never change — used as form values) with localized labels.
const SEGMENT_VALUES = [
  "Agency",
  "E-shop / brand",
  "Influencer / creator",
  "Public figure",
  "Real estate / developer",
  "Hotel / restaurant / service",
  "Other",
] as const;

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] px-3.5 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)] outline-none transition focus:border-[var(--color-brand)]";

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    sentTitle: string;
    sentBody: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    companyLabel: string;
    companyPlaceholder: string;
    websiteLabel: string;
    websitePlaceholder: string;
    segmentLabel: string;
    segmentPlaceholder: string;
    segmentLabels: string[];
    accountsLabel: string;
    accountsPlaceholder: string;
    platformsLabel: string;
    messageLabel: string;
    messagePlaceholder: string;
    consentPre: string;
    privacyNotice: string;
    consentPost: string;
    submit: string;
  }
> = {
  en: {
    eyebrow: "Beta pilot",
    title: "Request Tamanor beta access.",
    subtitle:
      "Tamanor is in beta pilot. Tell us about your brand and channels — we'll set up a personalized, read-only walkthrough.",
    sentTitle: "Thanks — we’ve got your beta request.",
    sentBody:
      "Your details were saved and our team will reach out about beta access. No spam, ever.",
    nameLabel: "Name *",
    namePlaceholder: "Your name",
    emailLabel: "Work email *",
    emailPlaceholder: "you@company.com",
    companyLabel: "Company",
    companyPlaceholder: "Company name",
    websiteLabel: "Website",
    websitePlaceholder: "https://…",
    segmentLabel: "You are a…",
    segmentPlaceholder: "Select a segment",
    segmentLabels: [
      "Agency",
      "E-shop / brand",
      "Influencer / creator",
      "Public figure",
      "Real estate / developer",
      "Hotel / restaurant / service",
      "Other",
    ],
    accountsLabel: "Number of social accounts",
    accountsPlaceholder: "e.g. 3",
    platformsLabel: "Platforms used",
    messageLabel: "Message",
    messagePlaceholder: "What would you like to protect?",
    consentPre: "I agree to be contacted about Tamanor and accept the ",
    privacyNotice: "privacy notice",
    consentPost: ".",
    submit: "Request beta access",
  },
  sk: {
    eyebrow: "Beta pilot",
    title: "Požiadajte o prístup k beta verzii Tamanoru.",
    subtitle:
      "Tamanor je v beta pilote. Povedzte nám o svojej značke a kanáloch — pripravíme personalizovanú prehliadku v režime iba na čítanie.",
    sentTitle: "Ďakujeme — vašu žiadosť o beta verziu sme prijali.",
    sentBody:
      "Vaše údaje boli uložené a náš tím vás bude kontaktovať ohľadom prístupu k beta verzii. Žiadny spam, nikdy.",
    nameLabel: "Meno *",
    namePlaceholder: "Vaše meno",
    emailLabel: "Pracovný e-mail *",
    emailPlaceholder: "vy@firma.com",
    companyLabel: "Spoločnosť",
    companyPlaceholder: "Názov spoločnosti",
    websiteLabel: "Webová stránka",
    websitePlaceholder: "https://…",
    segmentLabel: "Ste…",
    segmentPlaceholder: "Vyberte segment",
    segmentLabels: [
      "Agentúra",
      "E-shop / značka",
      "Influencer / tvorca",
      "Verejne známa osoba",
      "Reality / developer",
      "Hotel / reštaurácia / služba",
      "Iné",
    ],
    accountsLabel: "Počet sociálnych účtov",
    accountsPlaceholder: "napr. 3",
    platformsLabel: "Používané platformy",
    messageLabel: "Správa",
    messagePlaceholder: "Čo by ste chceli chrániť?",
    consentPre: "Súhlasím s tým, aby ma kontaktovali ohľadom Tamanoru, a akceptujem ",
    privacyNotice: "zásady ochrany súkromia",
    consentPost: ".",
    submit: "Požiadať o prístup k beta verzii",
  },
  de: {
    eyebrow: "Beta-Pilot",
    title: "Beta-Zugang zu Tamanor anfragen.",
    subtitle:
      "Tamanor befindet sich im Beta-Pilot. Erzählen Sie uns von Ihrer Marke und Ihren Kanälen — wir richten eine persönliche, schreibgeschützte Vorführung ein.",
    sentTitle: "Danke — wir haben Ihre Beta-Anfrage erhalten.",
    sentBody:
      "Ihre Angaben wurden gespeichert und unser Team wird sich zum Beta-Zugang bei Ihnen melden. Niemals Spam.",
    nameLabel: "Name *",
    namePlaceholder: "Ihr Name",
    emailLabel: "Geschäftliche E-Mail *",
    emailPlaceholder: "sie@firma.com",
    companyLabel: "Unternehmen",
    companyPlaceholder: "Name des Unternehmens",
    websiteLabel: "Website",
    websitePlaceholder: "https://…",
    segmentLabel: "Sie sind…",
    segmentPlaceholder: "Segment auswählen",
    segmentLabels: [
      "Agentur",
      "E-Shop / Marke",
      "Influencer / Creator",
      "Person des öffentlichen Lebens",
      "Immobilien / Entwickler",
      "Hotel / Restaurant / Dienstleistung",
      "Andere",
    ],
    accountsLabel: "Anzahl der Social-Media-Konten",
    accountsPlaceholder: "z. B. 3",
    platformsLabel: "Genutzte Plattformen",
    messageLabel: "Nachricht",
    messagePlaceholder: "Was möchten Sie schützen?",
    consentPre: "Ich bin damit einverstanden, zu Tamanor kontaktiert zu werden, und akzeptiere die ",
    privacyNotice: "Datenschutzhinweise",
    consentPost: ".",
    submit: "Beta-Zugang anfragen",
  },
};

export default async function BookDemoPage({
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
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow={c.eyebrow}
      title={c.title}
      subtitle={c.subtitle}
    >
      {sent ? (
        <div className="rounded-2xl border border-[var(--color-brand)] bg-[var(--color-surface)] p-6">
          <p className="text-lg font-semibold">{c.sentTitle}</p>
          <p className="mt-2 text-[var(--color-muted)]">{c.sentBody}</p>
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
                <span className="mb-1.5 block text-sm font-medium">{c.nameLabel}</span>
                <input name="name" required placeholder={c.namePlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.emailLabel}</span>
                <input name="email" type="email" required placeholder={c.emailPlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.companyLabel}</span>
                <input name="company" placeholder={c.companyPlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.websiteLabel}</span>
                <input name="website" placeholder={c.websitePlaceholder} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.segmentLabel}</span>
                <select name="segment" defaultValue="" className={inputClass}>
                  <option value="" disabled>{c.segmentPlaceholder}</option>
                  {SEGMENT_VALUES.map((s, i) => (<option key={s} value={s}>{c.segmentLabels[i]}</option>))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{c.accountsLabel}</span>
                <input name="accounts" placeholder={c.accountsPlaceholder} className={inputClass} />
              </label>
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium">{c.platformsLabel}</span>
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
              <span className="mb-1.5 block text-sm font-medium">{c.messageLabel}</span>
              <textarea name="message" rows={4} placeholder={c.messagePlaceholder} className={inputClass} />
            </label>

            <label className="flex items-start gap-2.5 text-sm text-[var(--color-muted)]">
              <input type="checkbox" name="consent" className="mt-0.5 accent-[var(--color-brand)]" />
              <span>
                {c.consentPre}
                <a href="/privacy" className="text-[var(--color-brand)] hover:underline">{c.privacyNotice}</a>{c.consentPost}
              </span>
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_30px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto"
            >
              {c.submit}
            </button>
          </form>
        </div>
      )}
    </MarketingPage>
  );
}
