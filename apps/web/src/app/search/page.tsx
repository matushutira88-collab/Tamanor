import type { Metadata } from "next";
import Link from "next/link";
import { getTL } from "@/i18n/server";
import { MarketingPage } from "@/components/marketing-page";
import { KNOWLEDGE, pathForEntry } from "@/content/knowledge";
import { providerStatusFor } from "@/lib/provider-status";

export const metadata: Metadata = {
  title: "Search — Tamanor",
  description: "Search the Tamanor knowledge base: platform, features, integrations and documentation.",
  // A functional search tool, not indexable content.
  robots: { index: false, follow: true },
  alternates: { canonical: "/search" },
};

/** Real full-text-ish search over the knowledge base (title + summary + keywords). */
function searchKnowledge(q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return KNOWLEDGE.filter((e) => {
    const ps = providerStatusFor(e.platformKey);
    const hay = [e.title, e.summary, e.keywords.join(" "), e.slug, e.collection, ps ? `${ps.status} ${ps.publicStatement}` : ""].join(" ").toLowerCase();
    return needle.split(/\s+/).every((tok) => hay.includes(tok));
  });
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { t, locale } = await getTL();
  const results = searchKnowledge(q);
  return (
    <MarketingPage dict={t} locale={locale} eyebrow="Knowledge base" title="Search" subtitle={q ? `Results for “${q}”` : "Search the Tamanor knowledge base."}>
      <form action="/search" method="get" className="mb-8">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search features, integrations, security…"
          className="w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-fg)]"
        />
      </form>
      {q ? (
        results.length ? (
          <ul className="space-y-5">
            {results.map((e) => (
              <li key={`${e.collection}/${e.slug}`}>
                <Link href={pathForEntry(e)} className="text-lg font-semibold text-[var(--color-fg)] hover:text-[var(--color-brand)]">
                  {e.title}
                </Link>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{e.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[var(--color-muted)]">No results. Try a broader term.</p>
        )
      ) : null}
    </MarketingPage>
  );
}
