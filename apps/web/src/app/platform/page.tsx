import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";
import { INDEX_COPY } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = INDEX_COPY[locale]?.["platform"];
  const title = `${copy?.title ?? "Platform & architecture"} — Tamanor`;
  const description =
    copy?.subtitle ??
    "How Tamanor works: architecture, security, row-level security, audit, permissions, webhooks, worker, AI moderation, automation and roadmap.";
  return {
    title,
    description,
    alternates: { canonical: "/platform" },
  };
}

export default async function PlatformIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="platform"
      title="Platform & architecture"
      subtitle="How Tamanor works under the hood — and what it honestly does today."
      dict={t}
      locale={locale}
    />
  );
}
