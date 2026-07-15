import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth";
import { signOut } from "@/server/session-actions";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { resendVerification } from "./actions";

export const metadata: Metadata = { title: "Verify your email — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Copy = {
  title: string; body: (email: string) => string; resend: string; logout: string;
  needLogin: string; goLogin: string;
  status: Record<string, string>;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Verify your email",
    body: (e) => `We sent a verification link to ${e}. Open it to activate your workspace. It expires in 24 hours.`,
    resend: "Resend email", logout: "Log out",
    needLogin: "Log in to resend your verification email.", goLogin: "Go to log in",
    status: {
      resent: "Verification email sent. Check your inbox (and spam).",
      resend_rate_limited: "Please wait a little before requesting another email.",
      rate_limited: "Too many requests. Please try again shortly.",
      expired: "That link has expired. Request a new one below.",
      consumed: "That link was already used. If your email isn't verified, request a new one.",
      invalid: "That link is invalid. Request a new verification email below.",
    },
  },
  sk: {
    title: "Overte svoj e-mail",
    body: (e) => `Odoslali sme overovací odkaz na ${e}. Otvorte ho a aktivujte pracovný priestor. Platí 24 hodín.`,
    resend: "Znova odoslať e-mail", logout: "Odhlásiť sa",
    needLogin: "Prihláste sa a znova si pošlite overovací e-mail.", goLogin: "Prejsť na prihlásenie",
    status: {
      resent: "Overovací e-mail bol odoslaný. Skontrolujte schránku (aj spam).",
      resend_rate_limited: "Chvíľu počkajte, než požiadate o ďalší e-mail.",
      rate_limited: "Priveľa požiadaviek. Skúste to o chvíľu.",
      expired: "Odkaz vypršal. Nižšie si vyžiadajte nový.",
      consumed: "Odkaz už bol použitý. Ak e-mail nie je overený, vyžiadajte si nový.",
      invalid: "Odkaz je neplatný. Nižšie si vyžiadajte nový overovací e-mail.",
    },
  },
  de: {
    title: "Bestätigen Sie Ihre E-Mail",
    body: (e) => `Wir haben einen Bestätigungslink an ${e} gesendet. Öffnen Sie ihn, um Ihren Arbeitsbereich zu aktivieren. Er läuft in 24 Stunden ab.`,
    resend: "E-Mail erneut senden", logout: "Abmelden",
    needLogin: "Melden Sie sich an, um die Bestätigungs-E-Mail erneut zu senden.", goLogin: "Zur Anmeldung",
    status: {
      resent: "Bestätigungs-E-Mail gesendet. Prüfen Sie Ihren Posteingang (und Spam).",
      resend_rate_limited: "Bitte warten Sie kurz, bevor Sie eine weitere E-Mail anfordern.",
      rate_limited: "Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.",
      expired: "Der Link ist abgelaufen. Fordern Sie unten einen neuen an.",
      consumed: "Der Link wurde bereits verwendet. Falls Ihre E-Mail nicht bestätigt ist, fordern Sie einen neuen an.",
      invalid: "Der Link ist ungültig. Fordern Sie unten eine neue Bestätigungs-E-Mail an.",
    },
  },
};

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await getSession();
  if (session?.emailVerified) redirect("/dashboard");
  const c = COPY[await getLocale()];
  const status = (await searchParams).status;
  const notice = status ? c.status[status] ?? null : null;
  const isPositive = status === "resent";

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Link href="/" aria-label="Tamanor home"><Logo /></Link></div>
        <div className="gu-card p-6 text-center">
          <h1 className="text-xl font-semibold">{c.title}</h1>

          {notice ? (
            <p role="alert" className={`mt-4 rounded-lg border px-3 py-2 text-sm ${isPositive ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-muted)]"}`}>
              {notice}
            </p>
          ) : null}

          {session ? (
            <>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{c.body(session.userEmail)}</p>
              <form action={resendVerification} className="mt-5">
                <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
                  {c.resend}
                </button>
              </form>
              <form action={signOut} className="mt-4">
                <button type="submit" className="text-sm font-medium text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">{c.logout}</button>
              </form>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{c.needLogin}</p>
              <Link href="/login" className="mt-5 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{c.goLogin}</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
