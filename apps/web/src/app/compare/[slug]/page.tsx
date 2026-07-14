import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTL } from "@/i18n/server";
import { KnowledgeArticle } from "@/components/knowledge-view";
import { entriesIn, getEntry, pathForEntry } from "@/content/knowledge";
import { localizeEntry } from "@/content/knowledge-l10n";
import { getLocale } from "@/i18n/locale-server";

export function generateStaticParams() {
  return entriesIn("compare").map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntry("compare", slug);
  if (!entry) return {};
  const locale = await getLocale();
  const e = localizeEntry(entry, locale);
  return {
    title: e.metaTitle,
    description: e.summary,
    keywords: e.keywords,
    alternates: { canonical: pathForEntry(entry) },
    openGraph: { title: e.metaTitle, description: e.summary, url: pathForEntry(entry), type: "article" },
    twitter: { card: "summary_large_image", title: e.metaTitle, description: e.summary },
  };
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getEntry("compare", slug);
  if (!entry) notFound();
  const { t, locale } = await getTL();
  return <KnowledgeArticle entry={entry} dict={t} locale={locale} />;
}
