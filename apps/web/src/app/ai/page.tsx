import type { Metadata } from "next";
import Link from "next/link";
import { getTL } from "@/i18n/server";
import { MarketingPage, Section } from "@/components/marketing-page";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, collectionLd } from "@/lib/jsonld";
import { CAPABILITY_SIGNALS } from "@/lib/entities";

export const metadata: Metadata = {
  title: "AI discoverability — Tamanor capabilities & signals",
  description:
    "Machine-readable facts about Tamanor for AI search engines and LLMs: verified capability signals, honest platform status, and links to llms.txt, ai-index.json and the entity map.",
  alternates: { canonical: "/ai" },
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
        eyebrow="For AI search & LLMs"
        title="Tamanor AI discoverability"
        subtitle="Verified, machine-readable facts about what Tamanor can and cannot do — no marketing claims."
      >
        <Section title="Capability signals (verified against the codebase)">
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

        <Section title="Machine-readable resources">
          <ul className="grid gap-2 sm:grid-cols-2">
            {RESOURCES.map((r) => (
              <li key={r.path}>
                <Link href={r.path} className="text-[var(--color-brand)] hover:underline">{r.name}</Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Ground truth">
          <p>
            Tamanor is read-only by default, connects only through official OAuth, and never executes a
            moderation action without human approval. It advertises only the platforms and capabilities it
            genuinely supports today.
          </p>
        </Section>
      </MarketingPage>
    </>
  );
}
