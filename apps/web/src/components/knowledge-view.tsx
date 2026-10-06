import Link from "next/link";
import type { Dictionary, Locale } from "@/i18n";
import { MarketingPage, Section, btnPrimary } from "@/components/marketing-page";
import { JsonLd } from "@/components/json-ld";
import {
  entriesIn,
  getEntryBySlug,
  pathForEntry,
  pathForSlug,
  collectionBasePath,
  type KnowledgeCollection,
  type KnowledgeEntry,
} from "@/content/knowledge";
import {
  localizeEntry,
  KB_UI,
  COLLECTION_LABEL_L10N,
  INDEX_COPY,
} from "@/content/knowledge-l10n";
import { breadcrumbLd, faqLd, techArticleLd, collectionLd } from "@/lib/jsonld";
import { providerStatusFor, PROVIDER_STATUS_LABEL, type ProviderStatus } from "@/lib/provider-status";

/** UI strings introduced by the V2 knowledge layout (kept local, like KB_UI). */
const KV_UI: Record<Locale, { readMore: string; onThisPage: string; ctaTitle: string; ctaBody: string; ctaBtn: string; articles: string }> = {
  en: { readMore: "Read more", onThisPage: "On this page", ctaTitle: "Try Tamanor free", ctaBody: "Connect a page in minutes. Official OAuth only — no passwords, no scraping.", ctaBtn: "Start for free", articles: "articles" },
  sk: { readMore: "Čítať viac", onThisPage: "Na tejto stránke", ctaTitle: "Vyskúšajte Tamanor zdarma", ctaBody: "Pripojte stránku za pár minút. Len oficiálny OAuth — žiadne heslá, žiadne scrapovanie.", ctaBtn: "Začať zdarma", articles: "článkov" },
  de: { readMore: "Weiterlesen", onThisPage: "Auf dieser Seite", ctaTitle: "Tamanor kostenlos testen", ctaBody: "Verbinde eine Seite in Minuten. Nur offizielles OAuth — keine Passwörter, kein Scraping.", ctaBtn: "Kostenlos starten", articles: "Artikel" },
};

/** Badge tone for a provider status: live = green, built-but-pending = amber, research = grey. */
function statusTone(status: ProviderStatus | undefined): string {
  if (status === "live_verified") return "border-[var(--color-ok-soft)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]";
  if (status === "unsupported" || status === "research") return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  return "border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] text-[var(--color-warn)]";
}

function StatusBadge({ entry }: { entry: KnowledgeEntry }) {
  const ps = providerStatusFor(entry.platformKey);
  if (!ps) return null;
  return (
    <span className={`inline-flex max-w-full items-start gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold leading-tight ${statusTone(ps.status)}`}>
      <span aria-hidden className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {PROVIDER_STATUS_LABEL[ps.status]}
    </span>
  );
}

/** Integrations get the platform's own colour + initial instead of a generic icon. */
const PLATFORM_MARK: Record<string, { bg: string; label: string }> = {
  facebook: { bg: "#1877f2", label: "f" },
  instagram: { bg: "linear-gradient(135deg,#f58529,#dd2a7b 55%,#8134af)", label: "IG" },
  google_business: { bg: "#34a853", label: "G" },
  youtube: { bg: "#ff0000", label: "▶" },
  linkedin: { bg: "#0a66c2", label: "in" },
  tiktok: { bg: "#111111", label: "♪" },
};

/** Per-entry line icons (features / security); everything else falls back to the collection icon. */
const ENTRY_ICON: Record<string, string> = {
  "comment-monitoring": "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  "reputation-analytics": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "actor-risk": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 13-6.2M19 15v3M19 21h.01",
  "action-queue": "M4 6h16M4 12h16M4 18h10",
  "approval-workflow": "M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z",
  "auto-protection": "M13 2 4 14h7l-1 8 9-12h-7z",
  "control-center": "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  "unified-inbox": "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  "ai-risk-detection": "M12 3a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v1a3 3 0 0 0 1 5.8V18a3 3 0 0 0 5 2 3 3 0 0 0 5-2v-1.2A3 3 0 0 0 18 11v-1a3 3 0 0 0-3-3V6a3 3 0 0 0-3-3z",
};

function EntryIcon({ entry, collection }: { entry: KnowledgeEntry; collection: KnowledgeCollection }) {
  const mark = collection === "integrations" ? PLATFORM_MARK[entry.platformKey ?? entry.slug] ?? PLATFORM_MARK[entry.slug] : undefined;
  if (mark) {
    return (
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(15,23,42,.18)]" style={{ background: mark.bg }}>
        {mark.label}
      </span>
    );
  }
  return <CollectionIcon collection={collection} path={ENTRY_ICON[entry.slug]} />;
}

/** One simple line icon per collection — gives the card grids a visual anchor. */
function CollectionIcon({ collection, path }: { collection: KnowledgeCollection; path?: string }) {
  const paths: Record<string, string> = {
    features: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z",
    platform: "M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
    integrations: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5",
    docs: "M5 4h9l5 5v11H5zM14 4v5h5M8 13h8M8 17h6",
    compare: "M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z",
    security: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z",
  };
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path ?? paths[collection] ?? paths.docs} /></svg>
    </span>
  );
}

/** Stable in-page anchor for a section heading (letters incl. diacritics, digits, dashes). */
function anchorFor(heading: string): string {
  return heading.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Truthful provider-status badge label for an entry (integrations only). */
function statusLabelFor(entry: KnowledgeEntry): string | null {
  const ps = providerStatusFor(entry.platformKey);
  return ps ? PROVIDER_STATUS_LABEL[ps.status] : null;
}

/** Related internal links (the internal link graph) resolved to real routes. */
function RelatedLinks({ entry, locale }: { entry: KnowledgeEntry; locale: Locale }) {
  const links = entry.related
    .map((slug) => {
      const path = pathForSlug(slug);
      if (!path) return null;
      const target = getEntryBySlug(slug);
      const label = target
        ? localizeEntry(target, locale).title
        : slug.replace(/-/g, " ");
      return { slug, path, label };
    })
    .filter((l): l is { slug: string; path: string; label: string } => Boolean(l));
  if (!links.length) return null;
  return (
    <div className="mt-14 border-t border-[var(--color-border)] pt-10">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{KB_UI[locale].related}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.slug}>
            <Link href={l.path} className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm font-semibold transition hover:border-[var(--color-brand)] hover:shadow-[0_8px_24px_rgba(37,99,235,.10)]">
              {l.label}
              <span aria-hidden className="text-[var(--color-brand)] transition group-hover:translate-x-0.5">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeArticle({
  entry: rawEntry,
  dict,
  locale,
}: {
  entry: KnowledgeEntry;
  dict: Dictionary;
  locale: Locale;
}) {
  const entry = localizeEntry(rawEntry, locale);
  const ui = KB_UI[locale];
  const kv = KV_UI[locale];
  const collLabel = COLLECTION_LABEL_L10N[locale][entry.collection];
  const base = collectionBasePath(entry.collection);
  const crumbs = [
    { name: ui.home, path: "/" },
    { name: collLabel, path: base },
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
        width="wide"
        cta
        eyebrow={collLabel}
        title={entry.title}
        subtitle={entry.summary}
        breadcrumb={
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
            <Link href="/" className="hover:text-[var(--color-fg)]">{ui.home}</Link>
            <span aria-hidden>/</span>
            <Link href={base} className="hover:text-[var(--color-fg)]">{collLabel}</Link>
            <span aria-hidden>/</span>
            <span className="text-[var(--color-fg)]">{entry.title}</span>
          </nav>
        }
        actions={statusLabelFor(entry) ? <span className="flex items-center gap-2 text-sm text-[var(--color-muted)]">{ui.status}: <StatusBadge entry={entry} /></span> : undefined}
      >
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="min-w-0 max-w-3xl">
            {entry.sections.map((s) => (
              <div key={s.heading} id={anchorFor(s.heading)} className="scroll-mt-24">
                <Section title={s.heading}>
                  {s.body.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </Section>
              </div>
            ))}

            {entry.faqs.length ? (
              <div className="mt-14">
                <h2 className="text-[22px] font-bold tracking-[-0.02em]">{ui.faq}</h2>
                <div className="mt-5 border-t border-[var(--color-border)]">
                  {entry.faqs.map((f, i) => (
                    <details key={f.q} open={i === 0} className="group border-b border-[var(--color-border)]">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
                        {f.q}
                        <span aria-hidden className="text-lg text-[var(--color-brand)] transition group-open:rotate-45">+</span>
                      </summary>
                      <p className="pb-5 text-[15px] leading-relaxed text-[var(--color-muted)]">{f.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}

            <RelatedLinks entry={entry} locale={locale} />
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              {entry.sections.length > 1 ? (
                <nav aria-label={kv.onThisPage} className="rounded-2xl border border-[var(--color-border)] bg-white p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{kv.onThisPage}</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {entry.sections.map((s) => (
                      <li key={s.heading}>
                        <a href={`#${anchorFor(s.heading)}`} className="text-[var(--color-muted)] transition hover:text-[var(--color-brand)]">{s.heading}</a>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}
              <div className="rounded-2xl bg-[linear-gradient(160deg,#eaf1ff,#ffffff)] p-5 ring-1 ring-[var(--color-brand-soft)]">
                <p className="font-bold">{kv.ctaTitle}</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{kv.ctaBody}</p>
                <Link href="/register" className={`${btnPrimary} mt-4 w-full !px-4 !py-3 !text-[11px]`}>{kv.ctaBtn}</Link>
              </div>
            </div>
          </aside>
        </div>
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
  const copy = INDEX_COPY[locale]?.[collection];
  const resolvedTitle = copy?.title ?? title;
  const resolvedSubtitle = copy?.subtitle ?? subtitle;
  const collLabel = COLLECTION_LABEL_L10N[locale][collection];
  const entries = entriesIn(collection).map((e) => localizeEntry(e, locale));
  const base = collectionBasePath(collection);
  const crumbs = [
    { name: KB_UI[locale].home, path: "/" },
    { name: collLabel, path: base },
  ];
  const ld = [
    breadcrumbLd(crumbs),
    collectionLd(resolvedTitle, base, entries.map((e) => ({ name: e.title, path: pathForEntry(e) }))),
  ];
  return (
    <>
      <JsonLd data={ld} />
      <MarketingPage
        dict={dict}
        locale={locale}
        width="wide"
        cta
        eyebrow={`${collLabel} · ${entries.length} ${KV_UI[locale].articles}`}
        title={resolvedTitle}
        subtitle={resolvedSubtitle}
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => (
            <li key={e.slug}>
              <Link
                href={pathForEntry(e)}
                className="group flex h-full flex-col rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-brand)_45%,transparent)] hover:shadow-[0_18px_40px_rgba(37,99,235,.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <EntryIcon entry={e} collection={collection} />
                  <span className="text-[11px] font-semibold tabular-nums tracking-[0.12em] text-[var(--color-muted)]">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h2 className="mt-5 text-[17px] font-bold leading-snug tracking-[-0.01em] text-[var(--color-fg)] group-hover:text-[var(--color-brand-strong)]">{e.title}</h2>
                {statusLabelFor(e) ? <div className="mt-2"><StatusBadge entry={e} /></div> : null}
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-muted)]">{e.summary}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-brand)]">
                  {KV_UI[locale].readMore}
                  <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </MarketingPage>
    </>
  );
}
