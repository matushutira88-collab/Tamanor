import Link from "next/link";
import type { Locale } from "@/i18n";

/**
 * Truthful access-denied panel shown when a signed-in member's ROLE lacks the
 * permission for a page (distinct from CapabilityLockedState, which is about the
 * PLAN). Renders NO tenant content — it only states that access is denied and
 * links back to the dashboard. Used instead of throwing, so a denied user gets a
 * clean access-denied state rather than an HTTP 500 error page.
 */
const T: Record<Locale, { badge: string; title: string; body: string; cta: string }> = {
  en: {
    badge: "403 · Access denied",
    title: "You don't have access to this",
    body: "Your role doesn't include permission to view this page. Ask a workspace owner or admin if you need access.",
    cta: "Back to dashboard",
  },
  sk: {
    badge: "403 · Prístup zamietnutý",
    title: "K tomuto nemáte prístup",
    body: "Vaša rola nezahŕňa oprávnenie zobraziť túto stránku. Ak prístup potrebujete, požiadajte vlastníka alebo administrátora workspace.",
    cta: "Späť na dashboard",
  },
  de: {
    badge: "403 · Zugriff verweigert",
    title: "Sie haben keinen Zugriff darauf",
    body: "Ihre Rolle enthält keine Berechtigung, diese Seite anzuzeigen. Bitten Sie einen Workspace-Eigentümer oder Admin um Zugriff.",
    cta: "Zurück zum Dashboard",
  },
};

export function AccessDeniedState({ locale }: { locale: Locale }) {
  const t = T[locale];
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            <path d="M12 15v2" />
          </svg>
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[var(--color-danger)]">{t.badge}</p>
        <h1 className="mt-1 text-xl font-semibold">{t.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t.body}</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
          {t.cta}
        </Link>
      </div>
    </div>
  );
}
