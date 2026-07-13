import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTL } from "@/i18n/server";
import { KnowledgeArticle } from "@/components/knowledge-view";
import { entriesIn, getEntry, pathForEntry } from "@/content/knowledge";

export function generateStaticParams() {
  return entriesIn("features").map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntry("features", slug);
  if (!entry) return {};
  return {
    title: entry.metaTitle,
    description: entry.summary,
    keywords: entry.keywords,
    alternates: { canonical: pathForEntry(entry) },
    openGraph: { title: entry.metaTitle, description: entry.summary, url: pathForEntry(entry), type: "article" },
  };
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getEntry("features", slug);
  if (!entry) notFound();
  const { t, locale } = await getTL();
  return <KnowledgeArticle entry={entry} dict={t} locale={locale} />;
}
