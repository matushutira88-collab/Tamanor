import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";
import { INDEX_COPY } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = INDEX_COPY[locale]?.["compare"];
  const title = `${copy?.title ?? "Compare Tamanor"} — Tamanor`;
  const description =
    copy?.subtitle ??
    "Truthful comparisons of moderation approaches — manual moderation, separate per-platform tools, autonomous AI, unified inbox, and a neutral evaluation checklist. No competitor claims, no invented numbers.";
  return {
    title,
    description,
    alternates: { canonical: "/compare" },
    openGraph: { title, description, url: "/compare", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CompareIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="compare"
      title="Compare Tamanor"
      subtitle="How Tamanor's approach compares — by working model, not by naming competitors."
      dict={t}
      locale={locale}
    />
  );
}
