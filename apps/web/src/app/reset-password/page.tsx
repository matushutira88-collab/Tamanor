import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { resetPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Set a new password — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Copy = {
  title: string; subtitle: string; password: string; passwordHint: string; confirm: string; submit: string;
  invalidTitle: string; invalidBody: string; requestNew: string; backToLogin: string;
  errors: Record<string, string>;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Set a new password", subtitle: "Choose a new password for your account.",
    password: "New password", passwordHint: "At least 10 characters.", confirm: "Confirm new password", submit: "Update password",
    invalidTitle: "Invalid or expired link", invalidBody: "This reset link is invalid or has expired.", requestNew: "Request a new link", backToLogin: "Back to log in",
    errors: {
      weak_password: "Password must be at least 10 characters.",
      password_mismatch: "The two passwords do not match.",
      expired: "This reset link has expired. Request a new one.",
      consumed: "This reset link was already used. Request a new one.",
      invalid: "This reset link is invalid. Request a new one.",
      rate_limited: "Too many attempts. Please try again shortly.",
      csrf: "Your session expired. Please reload and try again.",
      server_error: "Something went wrong. Please try again.",
    },
  },
  sk: {
    title: "Nastavte nové heslo", subtitle: "Zvoľte si nové heslo pre svoj účet.",
    password: "Nové heslo", passwordHint: "Aspoň 10 znakov.", confirm: "Potvrďte nové heslo", submit: "Aktualizovať heslo",
    invalidTitle: "Neplatný alebo expirovaný odkaz", invalidBody: "Tento odkaz na obnovenie je neplatný alebo vypršal.", requestNew: "Vyžiadať nový odkaz", backToLogin: "Späť na prihlásenie",
    errors: {
      weak_password: "Heslo musí mať aspoň 10 znakov.",
      password_mismatch: "Heslá sa nezhodujú.",
      expired: "Odkaz na obnovenie vypršal. Vyžiadajte si nový.",
      consumed: "Odkaz na obnovenie už bol použitý. Vyžiadajte si nový.",
      invalid: "Odkaz na obnovenie je neplatný. Vyžiadajte si nový.",
      rate_limited: "Priveľa pokusov. Skúste to o chvíľu.",
      csrf: "Vaša relácia vypršala. Obnovte stránku a skúste znova.",
      server_error: "Niečo sa pokazilo. Skúste znova.",
    },
  },
  de: {
    title: "Neues Passwort festlegen", subtitle: "Wählen Sie ein neues Passwort für Ihr Konto.",
    password: "Neues Passwort", passwordHint: "Mindestens 10 Zeichen.", confirm: "Neues Passwort bestätigen", submit: "Passwort aktualisieren",
    invalidTitle: "Ungültiger oder abgelaufener Link", invalidBody: "Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen.", requestNew: "Neuen Link anfordern", backToLogin: "Zurück zur Anmeldung",
    errors: {
      weak_password: "Das Passwort muss mindestens 10 Zeichen haben.",
      password_mismatch: "Die beiden Passwörter stimmen nicht überein.",
      expired: "Dieser Link ist abgelaufen. Fordern Sie einen neuen an.",
      consumed: "Dieser Link wurde bereits verwendet. Fordern Sie einen neuen an.",
      invalid: "Dieser Link ist ungültig. Fordern Sie einen neuen an.",
      rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in Kürze erneut.",
      csrf: "Ihre Sitzung ist abgelaufen. Bitte neu laden und erneut versuchen.",
      server_error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    },
  },
};

const field = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const c = COPY[await getLocale()];
  const sp = await searchParams;
  const token = sp.token ?? "";
  const errorMsg = sp.error ? c.errors[sp.error] ?? c.errors.server_error : null;

  if (!token) {
    return (
      <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center"><Link href="/" aria-label="Tamanor home"><Logo /></Link></div>
          <div className="gu-card p-6 text-center">
            <h1 className="text-xl font-semibold">{c.invalidTitle}</h1>
            <p className="mt-3 text-sm text-[var(--color-muted)]">{c.invalidBody}</p>
            <Link href="/forgot-password" className="mt-5 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{c.requestNew}</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Link href="/" aria-label="Tamanor home"><Logo /></Link></div>
        <div className="gu-card p-6">
          <h1 className="text-xl font-semibold">{c.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.subtitle}</p>
          {errorMsg ? (
            <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errorMsg}</p>
          ) : null}
          <form action={resetPasswordAction} className="mt-5 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label htmlFor="password" className="block text-sm font-medium">{c.password}</label>
              <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" aria-describedby="pw-hint" className={field} />
              <p id="pw-hint" className="mt-1 text-xs text-[var(--color-muted)]">{c.passwordHint}</p>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium">{c.confirm}</label>
              <input id="confirmPassword" name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" className={field} />
            </div>
            <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{c.submit}</button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-semibold text-[var(--color-brand)] hover:underline">{c.backToLogin}</Link>
        </p>
      </div>
    </main>
  );
}
