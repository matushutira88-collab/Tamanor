import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";
import { INDEX_COPY } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = INDEX_COPY[locale]?.["integrations"];
  const title = `${copy?.title ?? "Integrations"} — Tamanor`;
  const description =
    copy?.subtitle ??
    "Facebook Page protection and Instagram monitoring are live; Google Business review monitoring is a foundation; YouTube, LinkedIn and TikTok are planned.";
  return {
    title,
    description,
    alternates: { canonical: "/integrations" },
  };
}

export default async function IntegrationsIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="integrations"
      title="Integrations"
      subtitle="The platforms Tamanor connects to — with honest status for each."
      dict={t}
      locale={locale}
    />
  );
}
