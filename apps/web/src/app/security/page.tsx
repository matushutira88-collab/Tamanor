import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section, Bullets } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, collectionLd } from "@/lib/jsonld";
import { entriesIn, pathForEntry } from "@/content/knowledge";

const META: Record<
  Locale,
  { title: string; description: string; ogDescription: string; twitterDescription: string }
> = {
  en: {
    title: "Security — Tamanor",
    description:
      "How Tamanor protects your accounts and data: official OAuth only, no scraping, no client passwords, approval workflow, audit log, and read-only by default.",
    ogDescription:
      "Official OAuth only, read-only by default, encrypted tokens, RLS tenant isolation, append-only audit.",
    twitterDescription: "Safe by design.",
  },
  sk: {
    title: "Bezpečnosť — Tamanor",
    description:
      "Ako Tamanor chráni vaše účty a dáta: iba oficiálny OAuth, žiadny scraping, žiadne klientske heslá, schvaľovací proces, auditný log a predvolene iba na čítanie.",
    ogDescription:
      "Iba oficiálny OAuth, predvolene iba na čítanie, šifrované tokeny, izolácia nájomcov cez RLS, len pridávaný audit.",
    twitterDescription: "Bezpečné už v základe.",
  },
  de: {
    title: "Sicherheit — Tamanor",
    description:
      "Wie Tamanor Ihre Konten und Daten schützt: ausschließlich offizielles OAuth, kein Scraping, keine Kundenpasswörter, Freigabe-Workflow, Audit-Log und standardmäßig schreibgeschützt.",
    ogDescription:
      "Ausschließlich offizielles OAuth, standardmäßig schreibgeschützt, verschlüsselte Tokens, RLS-Mandantenisolierung, nur anhängendes Audit.",
    twitterDescription: "Sicher durch Design.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const m = META[locale];
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: "/security" },
    openGraph: {
      title: m.title,
      description: m.ogDescription,
      url: "/security",
      type: "website",
    },
    twitter: { card: "summary_large_image", title: m.title, description: m.twitterDescription },
  };
}

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    connectionsTitle: string;
    connectionsBody: string;
    connectionsBullets: string[];
    tokensTitle: string;
    tokensBody: string;
    actionsTitle: string;
    actionsBody: string;
    actionsBullets: string[];
    topicsTitle: string;
    topicsBody: string;
    disclosureTitle: string;
    disclosurePre: string;
    contactPage: string;
    disclosureMid: string;
    securityDisclosure: string;
    disclosurePost: string;
  }
> = {
  en: {
    eyebrow: "Trust & safety",
    title: "Safe by design.",
    subtitle:
      "Tamanor is built to protect your brand without ever putting your accounts or your customers at risk.",
    connectionsTitle: "Connections",
    connectionsBody:
      "Tamanor connects to platforms exclusively through their official OAuth and API integrations. We never scrape, and we never ask for or store your social passwords.",
    connectionsBullets: [
      "Official OAuth / API connectors only",
      "No scraping of any platform",
      "No client passwords — ever",
      "Read-only mode by default",
      "Platform capability checks before any action is offered",
    ],
    tokensTitle: "Tokens",
    tokensBody:
      "Access tokens obtained through OAuth are stored server-side only. They are never shown in the interface, never written to logs, and never included in the audit trail. Our production architecture is designed for encrypted-at-rest token storage backed by a key management service.",
    actionsTitle: "Actions & control",
    actionsBody:
      "Sensitive actions (reply, hide, delete) are approval-gated. AI can quickly classify and propose, but nothing is executed without an authorized human review, and every decision is recorded.",
    actionsBullets: [
      "Human approval workflow for sensitive actions",
      "Complete, append-only audit log",
      "Role-based permissions across the workspace",
      "No automatic execution of moderation actions",
    ],
    topicsTitle: "Security topics",
    topicsBody: "Detailed, honest write-ups of Tamanor's security posture:",
    disclosureTitle: "Responsible disclosure",
    disclosurePre: "If you believe you have found a security issue, please reach us through the",
    contactPage: "contact page",
    disclosureMid:
      ". A dedicated security mailbox is configurable before production and will be announced when live — we do not publish a placeholder address that is not monitored. See",
    securityDisclosure: "security disclosure",
    disclosurePost: "for details.",
  },
  sk: {
    eyebrow: "Dôvera a bezpečnosť",
    title: "Bezpečné už v základe.",
    subtitle:
      "Tamanor je vytvorený tak, aby chránil vašu značku bez toho, aby kedykoľvek ohrozil vaše účty alebo vašich zákazníkov.",
    connectionsTitle: "Pripojenia",
    connectionsBody:
      "Tamanor sa pripája k platformám výhradne prostredníctvom ich oficiálnych integrácií OAuth a API. Nikdy nescrapujeme a nikdy nežiadame ani neukladáme vaše heslá k sociálnym sieťam.",
    connectionsBullets: [
      "Iba oficiálne konektory OAuth / API",
      "Žiadny scraping žiadnej platformy",
      "Žiadne klientske heslá — nikdy",
      "Predvolene režim iba na čítanie",
      "Kontrola možností platformy pred ponúknutím akejkoľvek akcie",
    ],
    tokensTitle: "Tokeny",
    tokensBody:
      "Prístupové tokeny získané cez OAuth sa ukladajú výhradne na strane servera. Nikdy sa nezobrazujú v rozhraní, nikdy sa nezapisujú do logov a nikdy nie sú súčasťou auditného logu. Naša produkčná architektúra je navrhnutá pre šifrované ukladanie tokenov v pokoji s podporou služby na správu kľúčov.",
    actionsTitle: "Akcie a kontrola",
    actionsBody:
      "Citlivé akcie (odpoveď, skrytie, vymazanie) podliehajú schváleniu. AI dokáže rýchlo klasifikovať a navrhovať, no nič sa nevykoná bez preskúmania oprávnenou osobou a každé rozhodnutie sa zaznamenáva.",
    actionsBullets: [
      "Ľudský schvaľovací proces pre citlivé akcie",
      "Kompletný, len pridávaný auditný log",
      "Oprávnenia podľa rolí naprieč pracovným priestorom",
      "Žiadne automatické vykonávanie moderátorských akcií",
    ],
    topicsTitle: "Bezpečnostné témy",
    topicsBody: "Podrobné a čestné rozbory bezpečnostného postoja Tamanoru:",
    disclosureTitle: "Zodpovedné nahlasovanie",
    disclosurePre: "Ak sa domnievate, že ste našli bezpečnostný problém, kontaktujte nás prostredníctvom",
    contactPage: "kontaktnej stránky",
    disclosureMid:
      ". Vyhradená bezpečnostná schránka sa dá nakonfigurovať pred nasadením do produkcie a bude oznámená, keď bude aktívna — nezverejňujeme zastupujúcu adresu, ktorá nie je monitorovaná. Podrobnosti nájdete v",
    securityDisclosure: "bezpečnostnom nahlasovaní",
    disclosurePost: ".",
  },
  de: {
    eyebrow: "Vertrauen & Sicherheit",
    title: "Sicher durch Design.",
    subtitle:
      "Tamanor ist so gebaut, dass es Ihre Marke schützt, ohne jemals Ihre Konten oder Ihre Kunden zu gefährden.",
    connectionsTitle: "Verbindungen",
    connectionsBody:
      "Tamanor verbindet sich mit Plattformen ausschließlich über deren offizielle OAuth- und API-Integrationen. Wir betreiben niemals Scraping und fragen niemals nach Ihren Social-Media-Passwörtern oder speichern sie.",
    connectionsBullets: [
      "Ausschließlich offizielle OAuth-/API-Konnektoren",
      "Kein Scraping irgendeiner Plattform",
      "Keine Kundenpasswörter — niemals",
      "Standardmäßig schreibgeschützter Modus",
      "Prüfung der Plattformfähigkeiten, bevor eine Aktion angeboten wird",
    ],
    tokensTitle: "Tokens",
    tokensBody:
      "Über OAuth erhaltene Zugriffstokens werden ausschließlich serverseitig gespeichert. Sie werden niemals in der Oberfläche angezeigt, niemals in Logs geschrieben und niemals in den Audit-Verlauf aufgenommen. Unsere Produktionsarchitektur ist auf verschlüsselte Token-Speicherung im Ruhezustand ausgelegt, gestützt durch einen Key-Management-Dienst.",
    actionsTitle: "Aktionen & Kontrolle",
    actionsBody:
      "Sensible Aktionen (Antworten, Ausblenden, Löschen) sind freigabepflichtig. KI kann schnell klassifizieren und vorschlagen, aber nichts wird ohne autorisierte menschliche Prüfung ausgeführt, und jede Entscheidung wird protokolliert.",
    actionsBullets: [
      "Menschlicher Freigabe-Workflow für sensible Aktionen",
      "Vollständiges, nur anhängendes Audit-Log",
      "Rollenbasierte Berechtigungen im gesamten Arbeitsbereich",
      "Keine automatische Ausführung von Moderationsaktionen",
    ],
    topicsTitle: "Sicherheitsthemen",
    topicsBody: "Detaillierte, ehrliche Ausführungen zur Sicherheitshaltung von Tamanor:",
    disclosureTitle: "Verantwortungsvolle Offenlegung",
    disclosurePre:
      "Wenn Sie glauben, ein Sicherheitsproblem gefunden zu haben, kontaktieren Sie uns bitte über die",
    contactPage: "Kontaktseite",
    disclosureMid:
      ". Ein eigenes Sicherheitspostfach ist vor der Produktion konfigurierbar und wird bekannt gegeben, sobald es aktiv ist — wir veröffentlichen keine Platzhalteradresse, die nicht überwacht wird. Weitere Einzelheiten finden Sie unter",
    securityDisclosure: "Sicherheitsoffenlegung",
    disclosurePost: ".",
  },
};

export default async function SecurityPage() {
  const _lp = await getTL();
  const c = COPY[_lp.locale];
  const securityPages = entriesIn("security");
  const ld = [
    breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Security", path: "/security" },
    ]),
    collectionLd("Tamanor Security Center", "/security", securityPages.map((e) => ({ name: e.title, path: pathForEntry(e) }))),
  ];
  return (
    <>
      <JsonLd data={ld} />
      <MarketingPage dict={_lp.t} locale={_lp.locale}
        eyebrow={c.eyebrow}
        title={c.title}
        subtitle={c.subtitle}
      >
        <Section title={c.connectionsTitle}>
          <p>{c.connectionsBody}</p>
          <Bullets items={c.connectionsBullets} />
        </Section>

        <Section title={c.tokensTitle}>
          <p>{c.tokensBody}</p>
        </Section>

        <Section title={c.actionsTitle}>
          <p>{c.actionsBody}</p>
          <Bullets items={c.actionsBullets} />
        </Section>

        <Section title={c.topicsTitle}>
          <p>{c.topicsBody}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {securityPages.map((e) => (
              <li key={e.slug}>
                <Link href={pathForEntry(e)} className="text-[var(--color-brand)] hover:underline">
                  {e.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={c.disclosureTitle}>
          <p>
            {c.disclosurePre}{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/contact">
              {c.contactPage}
            </Link>
            {c.disclosureMid}{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/security/disclosure">
              {c.securityDisclosure}
            </Link>{" "}
            {c.disclosurePost}
          </p>
        </Section>
      </MarketingPage>
    </>
  );
}
