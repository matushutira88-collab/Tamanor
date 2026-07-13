import Link from "next/link";
import type { Dictionary, Locale } from "@/i18n";
import { MarketingPage, Section } from "@/components/marketing-page";
import { JsonLd } from "@/components/json-ld";
import {
  entriesIn,
  pathForEntry,
  pathForSlug,
  collectionBasePath,
  type KnowledgeCollection,
  type KnowledgeEntry,
} from "@/content/knowledge";
import { breadcrumbLd, faqLd, techArticleLd, collectionLd } from "@/lib/jsonld";
import { providerStatusFor, PROVIDER_STATUS_LABEL } from "@/lib/provider-status";

export const COLLECTION_LABEL: Record<KnowledgeCollection, string> = {
  platform: "Platform",
  features: "Features",
  integrations: "Integrations",
  docs: "Docs",
  compare: "Compare",
  security: "Security",
};

/** Truthful provider-status badge label for an entry (integrations only). */
function statusLabelFor(entry: KnowledgeEntry): string | null {
  const ps = providerStatusFor(entry.platformKey);
  return ps ? PROVIDER_STATUS_LABEL[ps.status] : null;
}

/** Related internal links (the internal link graph) resolved to real routes. */
function RelatedLinks({ entry }: { entry: KnowledgeEntry }) {
  const links = entry.related
    .map((slug) => ({ slug, path: pathForSlug(slug) }))
    .filter((l): l is { slug: string; path: string } => Boolean(l.path));
  if (!links.length) return null;
  return (
    <div className="mt-12 border-t border-[var(--color-border)] pt-8">
      <h2 className="text-lg font-semibold">Related</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.slug}>
            <Link href={l.path} className="text-[var(--color-brand)] hover:underline">
              {l.slug.replace(/-/g, " ")}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeArticle({
  entry,
  dict,
  locale,
}: {
  entry: KnowledgeEntry;
  dict: Dictionary;
  locale: Locale;
}) {
  const base = collectionBasePath(entry.collection);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: COLLECTION_LABEL[entry.collection], path: base },
    { name: entry.title, path: pathForEntry(entry) },
  ];
  const ld: unknown[] = [breadcrumbLd(crumbs), techArticleLd(entry)];
  if (entry.faqs.length) ld.push(faqLd(entry.faqs));

  return (
    <>
      <JsonLd data={ld} />
      <MarketingPage
        dict={dict}
        locale={locale}
        eyebrow={COLLECTION_LABEL[entry.collection]}
        title={entry.title}
        subtitle={entry.summary}
      >
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--color-muted)]">
          <Link href="/" className="hover:underline">Home</Link>
          {" / "}
          <Link href={base} className="hover:underline">{COLLECTION_LABEL[entry.collection]}</Link>
          {" / "}
          <span className="text-[var(--color-fg)]">{entry.title}</span>
        </nav>

        {statusLabelFor(entry) ? (
          <p className="mb-8 inline-block rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs tracking-wide text-[var(--color-muted)]">
            Status: {statusLabelFor(entry)}
          </p>
        ) : null}

        {entry.sections.map((s) => (
          <Section key={s.heading} title={s.heading}>
            {s.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </Section>
        ))}

        {entry.faqs.length ? (
          <div className="mt-10">
            <h2 className="text-xl font-semibold">Frequently asked questions</h2>
            <dl className="mt-4 space-y-5">
              {entry.faqs.map((f) => (
                <div key={f.q}>
                  <dt className="font-semibold text-[var(--color-fg)]">{f.q}</dt>
                  <dd className="mt-1 text-[var(--color-muted)]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <RelatedLinks entry={entry} />
      </MarketingPage>
    </>
  );
}

export function SectionIndex({
  collection,
  title,
  subtitle,
  dict,
  locale,
}: {
  collection: KnowledgeCollection;
  title: string;
  subtitle: string;
  dict: Dictionary;
  locale: Locale;
}) {
  const entries = entriesIn(collection);
  const base = collectionBasePath(collection);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: COLLECTION_LABEL[collection], path: base },
  ];
  const ld = [
    breadcrumbLd(crumbs),
    collectionLd(title, base, entries.map((e) => ({ name: e.title, path: pathForEntry(e) }))),
  ];
  return (
    <>
      <JsonLd data={ld} />
      <MarketingPage dict={dict} locale={locale} eyebrow={COLLECTION_LABEL[collection]} title={title} subtitle={subtitle}>
        <ul className="grid gap-6 sm:grid-cols-2">
          {entries.map((e) => (
            <li key={e.slug} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <Link href={pathForEntry(e)} className="text-lg font-semibold text-[var(--color-fg)] hover:text-[var(--color-brand)]">
                {e.title}
              </Link>
              {statusLabelFor(e) ? (
                <span className="ml-2 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[10px] tracking-wide text-[var(--color-muted)]">{statusLabelFor(e)}</span>
              ) : null}
              <p className="mt-2 text-sm text-[var(--color-muted)]">{e.summary}</p>
            </li>
          ))}
        </ul>
      </MarketingPage>
    </>
  );
}
