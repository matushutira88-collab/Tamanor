"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { getStoredConsent, setConsent } from "@/lib/analytics/consent";

/**
 * Cookie / consent banner (V1.63). Light, brand-styled, and GRANULAR: the visitor can accept all,
 * reject non-essential, or open "Customize" and choose per category. Two categories map to what
 * Tamanor actually uses — strictly-necessary (always on) and privacy-friendly analytics (optional,
 * gated by Consent Mode v2 in `setConsent`). Copy is self-contained so this stays a pure client
 * component and never forces dynamic rendering.
 */
const COPY: Record<Locale, {
  title: string; intro: string; learnMore: string;
  acceptAll: string; reject: string; customize: string; save: string;
  necessaryTitle: string; necessaryDesc: string; always: string;
  analyticsTitle: string; analyticsDesc: string;
}> = {
  en: {
    title: "Your cookie choices",
    intro: "We use strictly necessary cookies to keep Tamanor working — and, only with your consent, privacy-friendly analytics to improve the product. No ads, no cross-site tracking.",
    learnMore: "Cookie Policy",
    acceptAll: "Accept all",
    reject: "Reject non-essential",
    customize: "Customize",
    save: "Save choices",
    necessaryTitle: "Strictly necessary",
    necessaryDesc: "Keep you signed in and remember your language. Required for the site to work.",
    always: "Always on",
    analyticsTitle: "Analytics",
    analyticsDesc: "Privacy-friendly usage insights that help us improve Tamanor. Off until you allow it.",
  },
  sk: {
    title: "Vaše nastavenia cookies",
    intro: "Používame nevyhnutné cookies, aby Tamanor fungoval — a len s vaším súhlasom aj analytiku šetrnú k súkromiu na zlepšenie produktu. Žiadne reklamy ani sledovanie naprieč webmi.",
    learnMore: "Zásady používania cookies",
    acceptAll: "Prijať všetko",
    reject: "Odmietnuť nepotrebné",
    customize: "Prispôsobiť",
    save: "Uložiť voľby",
    necessaryTitle: "Nevyhnutné",
    necessaryDesc: "Udržia vás prihlásených a zapamätajú si váš jazyk. Potrebné na fungovanie webu.",
    always: "Vždy zapnuté",
    analyticsTitle: "Analytika",
    analyticsDesc: "Štatistiky používania šetrné k súkromiu, ktoré nám pomáhajú zlepšovať Tamanor. Vypnuté, kým to nepovolíte.",
  },
  de: {
    title: "Ihre Cookie-Einstellungen",
    intro: "Wir verwenden unbedingt erforderliche Cookies, damit Tamanor funktioniert — und nur mit Ihrer Einwilligung datenschutzfreundliche Analysen zur Produktverbesserung. Keine Werbung, kein seitenübergreifendes Tracking.",
    learnMore: "Cookie-Richtlinie",
    acceptAll: "Alle akzeptieren",
    reject: "Nicht notwendige ablehnen",
    customize: "Anpassen",
    save: "Auswahl speichern",
    necessaryTitle: "Unbedingt erforderlich",
    necessaryDesc: "Halten Sie angemeldet und merken sich Ihre Sprache. Für den Betrieb der Website nötig.",
    always: "Immer aktiv",
    analyticsTitle: "Analyse",
    analyticsDesc: "Datenschutzfreundliche Nutzungsstatistiken, die uns helfen, Tamanor zu verbessern. Aus, bis Sie zustimmen.",
  },
};

function readLocale(): Locale {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
    const raw = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    return isLocale(raw) ? raw : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? "bg-[var(--color-brand)]" : "bg-[var(--color-border-strong)]"
      }`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocale(readLocale());
    try {
      if (getStoredConsent() === null) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function choose(granted: boolean) {
    setConsent(granted);
    setVisible(false);
  }

  if (!visible) return null;
  const t = COPY[locale];

  return (
    <div role="dialog" aria-modal="false" aria-label={t.title} className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] shadow-[0_12px_40px_rgba(15,23,42,0.16)]">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z" />
                <path d="M8.5 10.5h.01M12 15h.01M15.5 11.5h.01" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
                {t.intro}{" "}
                <Link href="/cookies" className="font-medium text-[var(--color-brand)] underline hover:no-underline">{t.learnMore}</Link>
              </p>
            </div>
          </div>

          {expanded ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{t.necessaryTitle}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted)]">{t.necessaryDesc}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--color-ok-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ok)]">{t.always}</span>
              </div>
              <div className="h-px bg-[var(--color-border)]" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{t.analyticsTitle}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted)]">{t.analyticsDesc}</p>
                </div>
                <Toggle checked={analytics} onChange={setAnalytics} label={t.analyticsTitle} />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {!expanded ? (
              <button type="button" onClick={() => setExpanded(true)} className="order-3 rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)] sm:order-1 sm:mr-auto">
                {t.customize}
              </button>
            ) : null}
            <button type="button" onClick={() => choose(false)} className="order-2 rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)]">
              {t.reject}
            </button>
            {expanded ? (
              <button type="button" onClick={() => choose(analytics)} className="order-1 rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)] sm:order-2">
                {t.save}
              </button>
            ) : null}
            <button type="button" onClick={() => choose(true)} className="order-1 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] shadow-sm transition hover:bg-[var(--color-brand-strong)] sm:order-3">
              {t.acceptAll}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
