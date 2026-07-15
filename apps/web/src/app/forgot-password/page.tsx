import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { forgotPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Reset your password — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Copy = {
  title: string; subtitle: string; email: string; submit: string;
  backToLogin: string; sentTitle: string; sentBody: string;
  errors: Record<string, string>;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Reset your password", subtitle: "Enter your email and we'll send a reset link.",
    email: "Work email", submit: "Send reset link", backToLogin: "Back to log in",
    sentTitle: "Check your email",
    sentBody: "If an account exists for that email, we've sent a password reset link. It expires in 1 hour.",
    errors: {
      invalid_email: "Please enter a valid email address.",
      csrf: "Your session expired. Please reload and try again.",
    },
  },
  sk: {
    title: "Obnovte svoje heslo", subtitle: "Zadajte e-mail a pošleme vám odkaz na obnovenie.",
    email: "Pracovný e-mail", submit: "Poslať odkaz", backToLogin: "Späť na prihlásenie",
    sentTitle: "Skontrolujte e-mail",
    sentBody: "Ak pre daný e-mail existuje účet, poslali sme odkaz na obnovenie hesla. Platí 1 hodinu.",
    errors: {
      invalid_email: "Zadajte platnú e-mailovú adresu.",
      csrf: "Vaša relácia vypršala. Obnovte stránku a skúste znova.",
    },
  },
  de: {
    title: "Passwort zurücksetzen", subtitle: "Geben Sie Ihre E-Mail ein und wir senden einen Link.",
    email: "Geschäftliche E-Mail", submit: "Link senden", backToLogin: "Zurück zur Anmeldung",
    sentTitle: "Prüfen Sie Ihre E-Mail",
    sentBody: "Falls ein Konto für diese E-Mail existiert, haben wir einen Link zum Zurücksetzen gesendet. Er läuft in 1 Stunde ab.",
    errors: {
      invalid_email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      csrf: "Ihre Sitzung ist abgelaufen. Bitte neu laden und erneut versuchen.",
    },
  },
};

const field = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const c = COPY[await getLocale()];
  const sp = await searchParams;
  const errorMsg = sp.error ? c.errors[sp.error] ?? null : null;

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Link href="/" aria-label="Tamanor home"><Logo /></Link></div>
        <div className="gu-card p-6">
          {sp.sent ? (
            <div className="text-center">
              <h1 className="text-xl font-semibold">{c.sentTitle}</h1>
              <p className="mt-3 text-sm text-[var(--color-muted)]">{c.sentBody}</p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">{c.title}</h1>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{c.subtitle}</p>
              {errorMsg ? (
                <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errorMsg}</p>
              ) : null}
              <form action={forgotPasswordAction} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium">{c.email}</label>
                  <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={field} />
                </div>
                <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{c.submit}</button>
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-semibold text-[var(--color-brand)] hover:underline">{c.backToLogin}</Link>
        </p>
      </div>
    </main>
  );
}
