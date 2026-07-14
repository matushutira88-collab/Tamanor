"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/i18n/config";

const STORAGE_KEY = "tamanor_cookie_notice";

/** Self-contained banner copy, so this client component stays independent of
 *  the (server-side) dictionaries and does not force dynamic rendering. */
const COPY: Record<Locale, { message: string; accept: string; learnMore: string }> = {
  en: {
    message:
      "Tamanor uses only strictly necessary cookies to keep you signed in and remember your language. We use no advertising or tracking cookies.",
    accept: "Got it",
    learnMore: "Cookie Policy",
  },
  sk: {
    message:
      "Tamanor používa iba nevyhnutne potrebné cookies, aby ste zostali prihlásení a zapamätal si váš jazyk. Nepoužívame reklamné ani sledovacie cookies.",
    accept: "Rozumiem",
    learnMore: "Zásady používania cookies",
  },
  de: {
    message:
      "Tamanor verwendet nur unbedingt erforderliche Cookies, damit Sie angemeldet bleiben und Ihre Sprache gespeichert wird. Wir verwenden keine Werbe- oder Tracking-Cookies.",
    accept: "Verstanden",
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
 * Cookie notice banner. Tamanor sets only strictly necessary cookies, which do
 * not require prior consent — so this is an informational notice with an
 * acknowledgement, not a consent gate. The dismissal is remembered in
 * localStorage (no extra cookie is set).
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocale(readLocale());
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore storage errors */
    }
    setVisible(false);
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
          {t.message}{" "}
          <Link
            href="/cookies"
            className="text-[var(--color-brand)] underline hover:no-underline"
          >
            {t.learnMore}
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 self-start rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] sm:self-auto"
        >
          {t.accept}
        </button>
      </div>
    </div>
  );
}
