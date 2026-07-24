"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { reportClientError, computeReferenceId, newClientReference } from "@/lib/client-diagnostics";
import { LOCALE_COOKIE, isLocale, defaultLocale, type Locale } from "@/i18n/config";
import { familyDict } from "./family-i18n";
import { FamilyIllus } from "./family-illustrations";
import { FAMILY_CTA_PRIMARY, FAMILY_CTA_SECONDARY } from "./family-ui";

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
    // Same card + illustration + CTA vocabulary as the Family empty states, so a failure
    // reads as a normal product state rather than a broken page.
    <div className="mx-auto max-w-xl py-10">
      <div className="gu-card flex flex-col items-center px-6 py-12 text-center sm:py-14">
        <span className="text-[var(--color-muted)]" aria-hidden>
          <FamilyIllus name="error" size={88} />
        </span>
        <h1 className="mt-5 text-base font-semibold text-[var(--color-fg)]">{t.title}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">{t.body}</p>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Reference: <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono">{correlationId}</code>
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => reset()} className={FAMILY_CTA_PRIMARY}>
            {t.retry}
          </button>
          <Link href="/family" className={FAMILY_CTA_SECONDARY}>
            {t.back}
          </Link>
        </div>
      </div>
    </div>
  );
}
