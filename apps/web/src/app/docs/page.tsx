import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";
import { INDEX_COPY } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = INDEX_COPY[locale]?.["docs"];
  const title = `${copy?.title ?? "Documentation"} — Tamanor`;
  const description =
    copy?.subtitle ??
    "Getting started, connecting Facebook and Instagram, roles and permissions, webhooks and a security overview.";
  return {
    title,
    description,
    alternates: { canonical: "/docs" },
  };
}

export default async function DocsIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="docs"
      title="Documentation"
      subtitle="Connect accounts and understand how Tamanor keeps you in control."
      dict={t}
      locale={locale}
    />
  );
}
