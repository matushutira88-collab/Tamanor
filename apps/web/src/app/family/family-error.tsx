"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { reportClientError, computeReferenceId, newClientReference } from "@/lib/client-diagnostics";
import { LOCALE_COOKIE, isLocale, defaultLocale, type Locale } from "@/i18n/config";
import { familyDict } from "./family-i18n";

/**
 * CS-C6.1 — shared Family route-level error boundary UI. Client component: shows ONLY a safe, localized
 * message + a correlation id + retry + a link back to the family space. It NEVER renders the raw error,
 * stack, digest-as-content, Prisma/SQL detail, tenantId, id or any PII. A safe diagnostic report (name +
 * message + digest) is sent to the server sink for debugging — it is not shown to the user. SK/EN/DE via
 * the locale cookie (falls back to EN).
 */
function clientLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  const raw = m?.[1] ? decodeURIComponent(m[1]) : undefined;
  return isLocale(raw) ? raw : defaultLocale;
}

export function FamilyErrorBoundary({ error, reset, boundary }: { error: Error & { digest?: string }; reset: () => void; boundary: "family" | "family-console" }) {
  const t = familyDict(clientLocale()).errorBoundary;
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = computeReferenceId(error.digest, undefined, newClientReference());
  const correlationId = idRef.current;
  useEffect(() => {
    reportClientError({
      referenceId: correlationId, boundary,
      route: typeof window !== "undefined" ? window.location.pathname : "/family",
      errorName: error.name, safeMessage: error.message, digest: error.digest,
    });
  }, [correlationId, error, boundary]);

  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="text-xl font-semibold text-[var(--color-fg)]">{t.title}</h1>
      <p className="mt-3 text-[var(--color-muted)]">{t.body}</p>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Reference: <code>{correlationId}</code>
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)]"
        >
          {t.retry}
        </button>
        <Link href="/family" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--color-fg)]">
          {t.back}
        </Link>
      </div>
    </div>
  );
}
