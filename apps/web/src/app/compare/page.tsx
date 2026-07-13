import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";

export const metadata: Metadata = {
  title: "Compare Tamanor — approach comparisons",
  description:
    "Truthful comparisons of moderation approaches — manual moderation, separate per-platform tools, autonomous AI, unified inbox, and a neutral evaluation checklist. No competitor claims, no invented numbers.",
  alternates: { canonical: "/compare" },
  openGraph: { title: "Compare Tamanor — approach comparisons", description: "How Tamanor's approach compares — honestly.", url: "/compare", type: "website" },
  twitter: { card: "summary_large_image", title: "Compare Tamanor", description: "Truthful approach comparisons — no competitor claims." },
};

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
