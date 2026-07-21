"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { CB_COPY } from "../cb-i18n";

/**
 * C6 — success screen. Focuses its heading on mount (a11y: focus lands on the
 * confirmation after submit). Shows the incident id + Open status + CTAs. Never
 * shows internal tenant/audit ids or raw metadata.
 */
export function ReportSuccess({ locale, incidentId }: { locale: Locale; incidentId: string }) {
  const t = CB_COPY[locale];
  const r = t.report;
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h.current?.focus(); }, []);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-ok-soft)] text-[var(--color-ok)]" aria-hidden="true">✓</div>
      <h1 ref={h} tabIndex={-1} className="text-xl font-semibold text-[var(--color-fg)] focus:outline-none">{r.success.title}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{r.success.body}</p>

      <dl className="mt-4 space-y-1 rounded-lg border border-[var(--color-border)] px-4 py-3 text-left text-sm">
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{r.success.incident}</dt><dd className="font-mono text-[var(--color-fg)]">{incidentId}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{r.success.status}</dt><dd className="text-[var(--color-fg)]">{t.status.open}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{r.success.pending}</p>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href={`/dashboard/security/cyberbullying/incidents/${incidentId}`} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{r.success.openDetail}</Link>
        <Link href="/dashboard/security/cyberbullying/incidents" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]">{r.success.backToInbox}</Link>
        <Link href="/dashboard/security/cyberbullying/report" className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]">{r.success.newReport}</Link>
      </div>
    </div>
  );
}
