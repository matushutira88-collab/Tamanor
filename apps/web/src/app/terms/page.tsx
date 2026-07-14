import type { Metadata } from "next";
import { MarketingPage, Section, DraftNote } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Terms — Tamanor",
    description: "The terms that govern use of Tamanor during its early-access period.",
  },
  sk: {
    title: "Podmienky — Tamanor",
    description: "Podmienky upravujúce používanie Tamanoru počas obdobia skorého prístupu.",
  },
  de: {
    title: "Nutzungsbedingungen — Tamanor",
    description: "Die Bedingungen für die Nutzung von Tamanor während der Early-Access-Phase.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return META[locale];
}

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    usingTitle: string;
    usingBody: string;
    connectedTitle: string;
    connectedBody: string;
    acceptableTitle: string;
    acceptableBody: string;
    availabilityTitle: string;
    availabilityBody: string;
    contactTitle: string;
    contactPre: string;
    contactPost: string;
  }
> = {
  en: {
    eyebrow: "Legal",
    title: "Terms of Service",
    subtitle: "The basics of using Tamanor during early access.",
    usingTitle: "Using the service",
    usingBody:
      "Tamanor is provided for legitimate brand reputation management. You agree to use it in compliance with the terms and policies of the platforms you connect, and with applicable law. You are responsible for the actions you approve inside Tamanor.",
    connectedTitle: "Connected accounts",
    connectedBody:
      "You may only connect accounts you are authorized to manage. Connections use official OAuth and can be revoked by you at any time from the platform or from Tamanor.",
    acceptableTitle: "Acceptable use",
    acceptableBody:
      "Tamanor may not be used to harass, deceive, or evade platform rules. Tamanor operates in read-only mode by default and gates sensitive actions behind human approval; you agree not to attempt to circumvent these controls.",
    availabilityTitle: "Availability & changes",
    availabilityBody:
      "During early access the service is provided “as is” and may change. We will give reasonable notice of material changes to these terms. Final terms will be published before general availability.",
    contactTitle: "Contact",
    contactPre: "Questions about these terms? Email",
    contactPost: ".",
  },
  sk: {
    eyebrow: "Právne",
    title: "Podmienky služby",
    subtitle: "Základy používania Tamanoru počas skorého prístupu.",
    usingTitle: "Používanie služby",
    usingBody:
      "Tamanor sa poskytuje na legitímnu správu reputácie značky. Súhlasíte s tým, že ho budete používať v súlade s podmienkami a pravidlami platforiem, ktoré pripájate, a s platnými právnymi predpismi. Za akcie, ktoré v Tamanore schválite, zodpovedáte vy.",
    connectedTitle: "Pripojené účty",
    connectedBody:
      "Pripojiť môžete iba účty, na správu ktorých máte oprávnenie. Pripojenia využívajú oficiálny OAuth a môžete ich kedykoľvek zrušiť z platformy alebo z Tamanoru.",
    acceptableTitle: "Prijateľné použitie",
    acceptableBody:
      "Tamanor sa nesmie používať na obťažovanie, klamanie ani obchádzanie pravidiel platforiem. Tamanor predvolene funguje v režime iba na čítanie a citlivé akcie podmieňuje ľudským schválením; súhlasíte s tým, že sa tieto kontroly nebudete pokúšať obchádzať.",
    availabilityTitle: "Dostupnosť a zmeny",
    availabilityBody:
      "Počas skorého prístupu sa služba poskytuje „tak, ako je“ a môže sa meniť. O podstatných zmenách týchto podmienok vás primerane vopred upozorníme. Konečné podmienky budú zverejnené pred všeobecnou dostupnosťou.",
    contactTitle: "Kontakt",
    contactPre: "Otázky k týmto podmienkam? Napíšte na",
    contactPost: ".",
  },
  de: {
    eyebrow: "Rechtliches",
    title: "Nutzungsbedingungen",
    subtitle: "Die Grundlagen zur Nutzung von Tamanor während des Early Access.",
    usingTitle: "Nutzung des Dienstes",
    usingBody:
      "Tamanor wird für ein legitimes Reputationsmanagement von Marken bereitgestellt. Sie stimmen zu, es im Einklang mit den Bedingungen und Richtlinien der von Ihnen verbundenen Plattformen sowie mit geltendem Recht zu nutzen. Für die Aktionen, die Sie innerhalb von Tamanor freigeben, sind Sie verantwortlich.",
    connectedTitle: "Verbundene Konten",
    connectedBody:
      "Sie dürfen nur Konten verbinden, zu deren Verwaltung Sie berechtigt sind. Verbindungen nutzen offizielles OAuth und können von Ihnen jederzeit über die Plattform oder über Tamanor widerrufen werden.",
    acceptableTitle: "Zulässige Nutzung",
    acceptableBody:
      "Tamanor darf nicht genutzt werden, um zu belästigen, zu täuschen oder Plattformregeln zu umgehen. Tamanor arbeitet standardmäßig im schreibgeschützten Modus und setzt für sensible Aktionen eine menschliche Freigabe voraus; Sie stimmen zu, nicht zu versuchen, diese Kontrollen zu umgehen.",
    availabilityTitle: "Verfügbarkeit & Änderungen",
    availabilityBody:
      "Während des Early Access wird der Dienst „wie besehen“ bereitgestellt und kann sich ändern. Wesentliche Änderungen an diesen Bedingungen kündigen wir angemessen an. Endgültige Bedingungen werden vor der allgemeinen Verfügbarkeit veröffentlicht.",
    contactTitle: "Kontakt",
    contactPre: "Fragen zu diesen Bedingungen? Schreiben Sie an",
    contactPost: ".",
  },
};

export default async function TermsPage() {
  const _lp = await getTL();
  const c = COPY[_lp.locale];
  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow={c.eyebrow}
      title={c.title}
      subtitle={c.subtitle}
    >
      <DraftNote />

      <Section title={c.usingTitle}>
        <p>{c.usingBody}</p>
      </Section>

      <Section title={c.connectedTitle}>
        <p>{c.connectedBody}</p>
      </Section>

      <Section title={c.acceptableTitle}>
        <p>{c.acceptableBody}</p>
      </Section>

      <Section title={c.availabilityTitle}>
        <p>{c.availabilityBody}</p>
      </Section>

      <Section title={c.contactTitle}>
        <p>
          {c.contactPre}{" "}
          <a className="text-[var(--color-brand)] hover:underline" href="mailto:legal@guardora.ai">
            legal@guardora.ai
          </a>
          {c.contactPost}
        </p>
      </Section>
    </MarketingPage>
  );
}
