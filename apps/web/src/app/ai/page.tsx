import type { Metadata } from "next";
import Link from "next/link";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { MarketingPage, Section } from "@/components/marketing-page";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, collectionLd } from "@/lib/jsonld";
import { CAPABILITY_SIGNALS } from "@/lib/entities";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "AI discoverability — Tamanor capabilities & signals",
    description:
      "Machine-readable facts about Tamanor for AI search engines and LLMs: verified capability signals, honest platform status, and links to llms.txt, ai-index.json and the entity map.",
  },
  sk: {
    title: "Zistiteľnosť pre AI — možnosti a signály Tamanoru",
    description:
      "Strojovo čitateľné fakty o Tamanore pre AI vyhľadávače a LLM: overené signály možností, čestný stav platforiem a odkazy na llms.txt, ai-index.json a mapu entít.",
  },
  de: {
    title: "KI-Auffindbarkeit — Fähigkeiten & Signale von Tamanor",
    description:
      "Maschinenlesbare Fakten über Tamanor für KI-Suchmaschinen und LLMs: verifizierte Fähigkeitssignale, ehrlicher Plattformstatus und Links zu llms.txt, ai-index.json und der Entitätskarte.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { ...META[locale], alternates: { canonical: "/ai" } };
}

const COPY: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    signalsTitle: string;
    resourcesTitle: string;
    groundTruthTitle: string;
    groundTruthBody: string;
  }
> = {
  en: {
    eyebrow: "For AI search & LLMs",
    title: "Tamanor AI discoverability",
    subtitle:
      "Verified, machine-readable facts about what Tamanor can and cannot do — no marketing claims.",
    signalsTitle: "Capability signals (verified against the codebase)",
    resourcesTitle: "Machine-readable resources",
    groundTruthTitle: "Ground truth",
    groundTruthBody:
      "Tamanor is read-only by default, connects only through official OAuth, and never executes a moderation action without human approval. It advertises only the platforms and capabilities it genuinely supports today.",
  },
  sk: {
    eyebrow: "Pre AI vyhľadávanie a LLM",
    title: "Zistiteľnosť Tamanoru pre AI",
    subtitle:
      "Overené, strojovo čitateľné fakty o tom, čo Tamanor dokáže a čo nie — žiadne marketingové tvrdenia.",
    signalsTitle: "Signály možností (overené voči zdrojovému kódu)",
    resourcesTitle: "Strojovo čitateľné zdroje",
    groundTruthTitle: "Overená skutočnosť",
    groundTruthBody:
      "Tamanor je predvolene iba na čítanie, pripája sa výhradne cez oficiálny OAuth a nikdy nevykoná moderátorskú akciu bez ľudského schválenia. Uvádza iba platformy a možnosti, ktoré dnes skutočne podporuje.",
  },
  de: {
    eyebrow: "Für KI-Suche & LLMs",
    title: "KI-Auffindbarkeit von Tamanor",
    subtitle:
      "Verifizierte, maschinenlesbare Fakten darüber, was Tamanor kann und was nicht — keine Marketingaussagen.",
    signalsTitle: "Fähigkeitssignale (gegen den Quellcode verifiziert)",
    resourcesTitle: "Maschinenlesbare Ressourcen",
    groundTruthTitle: "Faktenbasis",
    groundTruthBody:
      "Tamanor ist standardmäßig schreibgeschützt, verbindet sich ausschließlich über offizielles OAuth und führt niemals eine Moderationsaktion ohne menschliche Freigabe aus. Es bewirbt nur die Plattformen und Fähigkeiten, die es heute tatsächlich unterstützt.",
  },
};

const RESOURCES = [
  { name: "llms.txt", path: "/llms.txt" },
  { name: "llms-full.txt", path: "/llms-full.txt" },
  { name: "ai-index.json", path: "/ai-index.json" },
  { name: "capabilities.json", path: "/capabilities.json" },
  { name: "entity-map.json", path: "/entity-map.json" },
  { name: "topics.json", path: "/topics.json" },
  { name: "integration-map.json", path: "/integration-map.json" },
  { name: "feature-map.json", path: "/feature-map.json" },
  { name: "product-map.json", path: "/product-map.json" },
  { name: "knowledge-map.json", path: "/knowledge-map.json" },
  { name: "trust-map.json", path: "/trust-map.json" },
  { name: "sitemap.xml", path: "/sitemap.xml" },
  { name: "feed.xml", path: "/feed.xml" },
];

export default async function AiPage() {
  const { t, locale } = await getTL();
  const c = COPY[locale];
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "AI", path: "/ai" },
  ];
  return (
    <>
      <JsonLd
        data={[
          breadcrumbLd(crumbs),
          collectionLd("AI discoverability resources", "/ai", RESOURCES.map((r) => ({ name: r.name, path: r.path }))),
        ]}
      />
      <MarketingPage
        dict={t}
        locale={locale}
        eyebrow={c.eyebrow}
        title={c.title}
        subtitle={c.subtitle}
      >
        <Section title={c.signalsTitle}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {CAPABILITY_SIGNALS.map((s) => (
              <li key={s.key} className="flex items-start gap-2">
                <span className={s.supported ? "text-[var(--color-brand)]" : "text-[var(--color-muted)]"}>
                  {s.supported ? "✓" : "—"}
                </span>
                <span className="text-sm">
                  <code className="text-[13px]">{s.key}</code>: {s.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={c.resourcesTitle}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {RESOURCES.map((r) => (
              <li key={r.path}>
                <Link href={r.path} className="text-[var(--color-brand)] hover:underline">{r.name}</Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={c.groundTruthTitle}>
          <p>{c.groundTruthBody}</p>
        </Section>
      </MarketingPage>
    </>
  );
}
