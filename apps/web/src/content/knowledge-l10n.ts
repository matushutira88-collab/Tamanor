// Localization layer for the knowledge base. English lives in knowledge.ts;
// per-locale overlays live in knowledge.sk.ts / knowledge.de.ts and are merged
// here by `localizeEntry`. UI labels and section-index copy are also localized.

import {
  type KnowledgeEntry,
  type KnowledgeEntryL10n,
  type KnowledgeCollection,
} from "./knowledge";
import type { Locale } from "@/i18n";
import { knowledgeSk } from "./knowledge.sk";
import { knowledgeDe } from "./knowledge.de";

const OVERLAYS: Record<string, Record<string, KnowledgeEntryL10n>> = {
  sk: knowledgeSk,
  de: knowledgeDe,
};

/** Merge the locale overlay onto an English entry (falling back per field). */
export function localizeEntry(entry: KnowledgeEntry, locale: Locale): KnowledgeEntry {
  if (locale === "en") return entry;
  const o = OVERLAYS[locale]?.[entry.slug];
  if (!o) return entry;
  return {
    ...entry,
    title: o.title ?? entry.title,
    metaTitle: o.metaTitle ?? entry.metaTitle,
    summary: o.summary ?? entry.summary,
    keywords: o.keywords ?? entry.keywords,
    sections: o.sections ?? entry.sections,
    faqs: o.faqs ?? entry.faqs,
  };
}

/** Short UI labels used in knowledge views. */
export const KB_UI: Record<Locale, { home: string; faq: string; status: string; related: string }> = {
  en: { home: "Home", faq: "Frequently asked questions", status: "Status", related: "Related" },
  sk: { home: "Domov", faq: "Časté otázky", status: "Stav", related: "Súvisiace" },
  de: { home: "Startseite", faq: "Häufig gestellte Fragen", status: "Status", related: "Verwandt" },
};

/** Collection names shown as eyebrows / breadcrumbs. */
export const COLLECTION_LABEL_L10N: Record<Locale, Record<KnowledgeCollection, string>> = {
  en: {
    platform: "Platform",
    features: "Features",
    integrations: "Integrations",
    docs: "Docs",
    compare: "Compare",
    security: "Security",
  },
  sk: {
    platform: "Platforma",
    features: "Funkcie",
    integrations: "Integrácie",
    docs: "Dokumentácia",
    compare: "Porovnanie",
    security: "Bezpečnosť",
  },
  de: {
    platform: "Plattform",
    features: "Funktionen",
    integrations: "Integrationen",
    docs: "Dokumentation",
    compare: "Vergleich",
    security: "Sicherheit",
  },
};

/** Title + subtitle for each section-index page. */
export const INDEX_COPY: Record<
  Locale,
  Partial<Record<KnowledgeCollection, { title: string; subtitle: string }>>
> = {
  en: {
    platform: {
      title: "Platform & architecture",
      subtitle: "How Tamanor works under the hood — and what it honestly does today.",
    },
    features: {
      title: "Features",
      subtitle: "What Tamanor does to protect your social presence.",
    },
    docs: {
      title: "Documentation",
      subtitle: "Connect accounts and understand how Tamanor keeps you in control.",
    },
    integrations: {
      title: "Integrations",
      subtitle: "The platforms Tamanor connects to — with honest status for each.",
    },
    compare: {
      title: "Compare Tamanor",
      subtitle: "How Tamanor's approach compares — by working model, not by naming competitors.",
    },
  },
  sk: {
    platform: {
      title: "Platforma a architektúra",
      subtitle: "Ako Tamanor funguje pod kapotou — a čo dnes naozaj robí.",
    },
    features: {
      title: "Funkcie",
      subtitle: "Čo Tamanor robí, aby chránil vašu prítomnosť na sociálnych sieťach.",
    },
    docs: {
      title: "Dokumentácia",
      subtitle: "Pripojte účty a pochopte, ako vás Tamanor drží pod kontrolou.",
    },
    integrations: {
      title: "Integrácie",
      subtitle: "Platformy, ku ktorým sa Tamanor pripája — s čestným stavom pri každej.",
    },
    compare: {
      title: "Porovnanie Tamanoru",
      subtitle: "Ako obstojí prístup Tamanoru — podľa spôsobu fungovania, nie menovaním konkurentov.",
    },
  },
  de: {
    platform: {
      title: "Plattform & Architektur",
      subtitle: "Wie Tamanor unter der Haube funktioniert — und was es heute ehrlich leistet.",
    },
    features: {
      title: "Funktionen",
      subtitle: "Was Tamanor tut, um Ihre Social-Media-Präsenz zu schützen.",
    },
    docs: {
      title: "Dokumentation",
      subtitle: "Konten verbinden und verstehen, wie Tamanor Sie in Kontrolle hält.",
    },
    integrations: {
      title: "Integrationen",
      subtitle: "Die Plattformen, mit denen sich Tamanor verbindet — mit ehrlichem Status für jede.",
    },
    compare: {
      title: "Tamanor im Vergleich",
      subtitle: "Wie sich der Ansatz von Tamanor schlägt — nach Funktionsweise, nicht durch Nennung von Wettbewerbern.",
    },
  },
};
