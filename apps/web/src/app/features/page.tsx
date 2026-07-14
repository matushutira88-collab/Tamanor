import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";
import { INDEX_COPY } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = INDEX_COPY[locale]?.["features"];
  const title = `${copy?.title ?? "Features"} — Tamanor`;
  const description =
    copy?.subtitle ??
    "Comment monitoring, reputation analytics, actor risk, action queue, approval workflow, auto-protection, control center, unified inbox and AI risk detection.";
  return {
    title,
    description,
    alternates: { canonical: "/features" },
  };
}

export default async function FeaturesIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="features"
      title="Features"
      subtitle="What Tamanor does to protect your social presence."
      dict={t}
      locale={locale}
    />
  );
}
