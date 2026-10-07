import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, btnPrimary, btnSecondary } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "About — Tamanor",
    description:
      "Tamanor is a Social Account Firewall that helps modern brands protect their reputation across social media, comments and reviews.",
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
  return { ...META[locale], alternates: { canonical: "/about" } };
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
    title: "A Social Account Firewall for modern brands.",
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
  const pillars = [
    { title: c.whyTitle, body: c.whyBody, icon: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" },
    { title: c.approachTitle, body: c.approachBody, icon: "M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" },
    { title: c.whereTitle, body: c.whereBody, icon: "M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  ];
  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      width="wide"
      cta
      eyebrow={c.eyebrow}
      title={c.title}
      subtitle={c.subtitle}
      actions={
        <>
          <Link href="/register" className={btnPrimary}>{c.startFree} →</Link>
          <a href="mailto:hello@tamanor.com" className={btnSecondary}>hello@tamanor.com</a>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-3">
        {pillars.map((p, i) => (
          <article key={p.title} className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-white p-7 shadow-[0_10px_30px_rgba(15,23,42,.04)]">
            <div className="flex items-start justify-between">
              <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={p.icon} /></svg>
              </span>
              <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-[var(--color-muted)]">0{i + 1}</span>
            </div>
            <h2 className="mt-6 text-xl font-bold tracking-[-0.02em]">{p.title}</h2>
            <p className="mt-3 text-[15px] leading-[1.75] text-[var(--color-muted)]">{p.body}</p>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
