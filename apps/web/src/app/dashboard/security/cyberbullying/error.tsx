"use client";

import { CB_COPY } from "./cb-i18n";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

/**
 * Cyberbullying route error boundary. Shows a neutral, localized message + retry.
 * NEVER renders a stack trace, SQL, storage key, tenant id, or permission detail.
 */
export default function CyberbullyingError({ reset }: { error: Error; reset: () => void }) {
  let locale: Locale = defaultLocale;
  if (typeof document !== "undefined") {
    const m = document.cookie.match(/guardora_locale=([^;]+)/);
    if (m && isLocale(m[1])) locale = m[1] as Locale;
  }
  const t = CB_COPY[locale];
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="text-xl font-semibold">{t.error.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t.error.body}</p>
        <button type="button" onClick={() => reset()} className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
          {t.prev}
        </button>
      </div>
    </div>
  );
}
