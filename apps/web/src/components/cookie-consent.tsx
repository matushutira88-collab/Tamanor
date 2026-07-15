"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { ANALYTICS_ACTIVE } from "@/lib/analytics/config";
import { getStoredConsent, setConsent } from "@/lib/analytics/consent";

const STORAGE_KEY = "tamanor_cookie_notice";

/** Self-contained banner copy, so this client component stays independent of
 *  the (server-side) dictionaries and does not force dynamic rendering.
 *  Two modes: an informational notice (no analytics configured) and a real
 *  Consent Mode v2 gate (analytics active) with an explicit Accept/Decline. */
const COPY: Record<Locale, {
  message: string; consentMessage: string; ack: string; accept: string; decline: string; learnMore: string;
}> = {
  en: {
    message:
      "Tamanor uses only strictly necessary cookies to keep you signed in and remember your language. We use no advertising or tracking cookies.",
    consentMessage:
      "Tamanor uses strictly necessary cookies to keep you signed in. With your consent we also use privacy-safe analytics to improve the product. Nothing is tracked until you accept.",
    ack: "Got it",
    accept: "Accept",
    decline: "Decline",
    learnMore: "Cookie Policy",
  },
  sk: {
    message:
      "Tamanor používa iba nevyhnutne potrebné cookies, aby ste zostali prihlásení a zapamätal si váš jazyk. Nepoužívame reklamné ani sledovacie cookies.",
    consentMessage:
      "Tamanor používa nevyhnutné cookies, aby ste zostali prihlásení. S vaším súhlasom používame aj analytiku šetrnú k súkromiu na zlepšenie produktu. Kým nesúhlasíte, nič sa nesleduje.",
    ack: "Rozumiem",
    accept: "Súhlasím",
    decline: "Odmietnuť",
    learnMore: "Zásady používania cookies",
  },
  de: {
    message:
      "Tamanor verwendet nur unbedingt erforderliche Cookies, damit Sie angemeldet bleiben und Ihre Sprache gespeichert wird. Wir verwenden keine Werbe- oder Tracking-Cookies.",
    consentMessage:
      "Tamanor verwendet notwendige Cookies, damit Sie angemeldet bleiben. Mit Ihrer Einwilligung nutzen wir zudem datenschutzfreundliche Analysen zur Produktverbesserung. Vor Ihrer Zustimmung wird nichts erfasst.",
    ack: "Verstanden",
    accept: "Zustimmen",
    decline: "Ablehnen",
    learnMore: "Cookie-Richtlinie",
  },
};

function readLocale(): Locale {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`),
    );
    const raw = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    return isLocale(raw) ? raw : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

/**
 * Cookie / consent banner. When no analytics provider is configured it is an informational notice
 * (Tamanor sets only strictly necessary cookies). When analytics is active in production it becomes
 * a Consent Mode v2 gate: analytics stays denied until the visitor explicitly Accepts, and the choice
 * persists in localStorage.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocale(readLocale());
    try {
      if (ANALYTICS_ACTIVE) {
        // Consent gate: show until the visitor has made an explicit choice.
        if (getStoredConsent() === null) setVisible(true);
      } else if (!window.localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  function acknowledge() {
    try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }
  function accept() {
    setConsent(true);
    acknowledge();
  }
  function decline() {
    setConsent(false);
    acknowledge();
  }

  if (!visible) return null;

  const t = COPY[locale];

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className="gu-dark fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-4 text-sm text-[var(--color-muted)] shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="leading-relaxed">
          {ANALYTICS_ACTIVE ? t.consentMessage : t.message}{" "}
          <Link
            href="/cookies"
            className="text-[var(--color-brand)] underline hover:no-underline"
          >
            {t.learnMore}
          </Link>
        </p>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
          {ANALYTICS_ACTIVE ? (
            <button
              type="button"
              onClick={decline}
              className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)]"
            >
              {t.decline}
            </button>
          ) : null}
          <button
            type="button"
            onClick={ANALYTICS_ACTIVE ? accept : acknowledge}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]"
          >
            {ANALYTICS_ACTIVE ? t.accept : t.ack}
          </button>
        </div>
      </div>
    </div>
  );
}
