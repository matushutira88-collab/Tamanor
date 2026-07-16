import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "About — Tamanor",
    description:
      "Tamanor is an Social Account Firewall that helps modern brands protect their reputation across social media, comments and reviews.",
  },
  sk: {
    title: "O nás — Tamanor",
    description:
      "Tamanor je Social Account Firewall, ktorý pomáha moderným značkám chrániť ich reputáciu naprieč sociálnymi sieťami, komentármi a recenziami.",
  },
  de: {
    title: "Über uns — Tamanor",
    description:
      "Tamanor ist eine Social Account Firewall, die modernen Marken hilft, ihre Reputation über soziale Medien, Kommentare und Bewertungen hinweg zu schützen.",
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
    whyTitle: string;
    whyBody: string;
    approachTitle: string;
    approachBody: string;
    whereTitle: string;
    whereBody: string;
    startFree: string;
    reachUsPre: string;
    reachUsPost: string;
  }
> = {
  en: {
    eyebrow: "About",
    title: "An Social Account Firewall for modern brands.",
    subtitle:
      "Tamanor helps brands protect their reputation across social media, comments and reviews — with AI speed and human control.",
    whyTitle: "Why Tamanor",
    whyBody:
      "Public feedback moves fast. A single harmful comment, scam or coordinated attack can damage trust before a team even notices. Tamanor brings comments, reviews and mentions from every public channel into one place, detects risk, and prepares safe actions — while keeping humans firmly in control.",
    approachTitle: "Our approach",
    approachBody:
      "We believe reputation tooling should be powerful and safe. That means official integrations only, no scraping, no shortcuts around a platform’s rules, and an approval workflow so nothing sensitive happens automatically. Speed from AI, accountability from people.",
    whereTitle: "Where we are",
    whereBody:
      "Tamanor is a European reputation-security platform, operated within the EU by Infotech Solutions, s. r. o. We build in close collaboration with the organisations that rely on it — if public-conversation risk matters to your team, we’d like to talk.",
    startFree: "Start free",
    reachUsPre: "or reach us at",
    reachUsPost: ".",
  },
  sk: {
    eyebrow: "O nás",
    title: "Social Account Firewall pre moderné značky.",
    subtitle:
      "Tamanor pomáha značkám chrániť ich reputáciu naprieč sociálnymi sieťami, komentármi a recenziami — s rýchlosťou AI a ľudskou kontrolou.",
    whyTitle: "Prečo Tamanor",
    whyBody:
      "Verejná spätná väzba sa šíri rýchlo. Jediný škodlivý komentár, podvod alebo koordinovaný útok môže poškodiť dôveru skôr, než si to tím vôbec všimne. Tamanor zhromažďuje komentáre, recenzie a zmienky zo všetkých verejných kanálov na jednom mieste, rozpoznáva riziko a pripravuje bezpečné akcie — pričom ľudia zostávajú pevne pod kontrolou.",
    approachTitle: "Náš prístup",
    approachBody:
      "Veríme, že nástroje na správu reputácie majú byť výkonné aj bezpečné. To znamená iba oficiálne integrácie, žiadny scraping, žiadne obchádzanie pravidiel platforiem a schvaľovací proces, aby sa nič citlivé nedialo automaticky. Rýchlosť od AI, zodpovednosť od ľudí.",
    whereTitle: "Kde sa nachádzame",
    whereBody:
      "Tamanor je európska platforma pre reputačnú bezpečnosť, ktorú v rámci EÚ prevádzkuje Infotech Solutions, s. r. o. Vyvíjame ju v úzkej spolupráci s organizáciami, ktoré sa na ňu spoliehajú — ak váš tím berie riziko verejnej komunikácie vážne, radi sa porozprávame.",
    startFree: "Začať zdarma",
    reachUsPre: "alebo nás kontaktujte na",
    reachUsPost: ".",
  },
  de: {
    eyebrow: "Über uns",
    title: "Eine Social Account Firewall für moderne Marken.",
    subtitle:
      "Tamanor hilft Marken, ihre Reputation über soziale Medien, Kommentare und Bewertungen hinweg zu schützen — mit der Geschwindigkeit von KI und menschlicher Kontrolle.",
    whyTitle: "Warum Tamanor",
    whyBody:
      "Öffentliches Feedback verbreitet sich schnell. Ein einziger schädlicher Kommentar, Betrug oder koordinierter Angriff kann das Vertrauen beschädigen, bevor ein Team es überhaupt bemerkt. Tamanor führt Kommentare, Bewertungen und Erwähnungen aus allen öffentlichen Kanälen an einem Ort zusammen, erkennt Risiko und bereitet sichere Aktionen vor — während Menschen fest die Kontrolle behalten.",
    approachTitle: "Unser Ansatz",
    approachBody:
      "Wir sind überzeugt, dass Werkzeuge für das Reputationsmanagement leistungsstark und sicher sein sollten. Das bedeutet ausschließlich offizielle Integrationen, kein Scraping, keine Umgehung der Regeln einer Plattform und einen Freigabe-Workflow, damit nichts Sensibles automatisch geschieht. Geschwindigkeit durch KI, Verantwortung durch Menschen.",
    whereTitle: "Wo wir stehen",
    whereBody:
      "Tamanor ist eine europäische Plattform für Reputationssicherheit, betrieben innerhalb der EU von Infotech Solutions, s. r. o. Wir entwickeln sie in enger Zusammenarbeit mit den Organisationen, die sich auf sie verlassen — wenn das Risiko öffentlicher Kommunikation für Ihr Team zählt, sprechen wir gerne mit Ihnen.",
    startFree: "Kostenlos starten",
    reachUsPre: "oder erreichen Sie uns unter",
    reachUsPost: ".",
  },
};

export default async function AboutPage() {
  const _lp = await getTL();
  const c = COPY[_lp.locale];
  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow={c.eyebrow}
      title={c.title}
      subtitle={c.subtitle}
    >
      <Section title={c.whyTitle}>
        <p>{c.whyBody}</p>
      </Section>

      <Section title={c.approachTitle}>
        <p>{c.approachBody}</p>
      </Section>

      <Section title={c.whereTitle}>
        <p>{c.whereBody}</p>
        <p>
          <Link href="/register" className="text-[var(--color-brand)] hover:underline">
            {c.startFree}
          </Link>{" "}
          {c.reachUsPre}{" "}
          <a href="mailto:hello@guardora.ai" className="text-[var(--color-brand)] hover:underline">
            hello@guardora.ai
          </a>
          {c.reachUsPost}
        </p>
      </Section>
    </MarketingPage>
  );
}
