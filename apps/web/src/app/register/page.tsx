import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { SocialAuthButtons } from "@/components/auth/social-buttons";
import { OAUTH_ERRORS } from "@/components/auth/oauth-errors";
import { PasswordField } from "@/components/auth/password-field";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { turnstileForRegistration } from "@/server/auth-security";
import { registerAction } from "./actions";

// Auth pages must never be indexed (thin, gated, user-specific).
export const metadata: Metadata = { title: "Create your workspace — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const COUNTRIES = [
  "Slovakia", "Czechia", "Germany", "Austria", "Poland", "Hungary", "France", "Italy", "Spain",
  "Portugal", "Netherlands", "Belgium", "Ireland", "Denmark", "Sweden", "Finland", "Norway",
  "Switzerland", "United Kingdom", "United States", "Canada", "Australia", "Other",
];

type Copy = {
  title: string; subtitle: string;
  or: string; google: string; facebook: string;
  email: string; password: string; passwordHint: string; confirm: string;
  workspace: string; workspaceHint: string; company: string; optional: string; country: string; countryPlaceholder: string;
  submit: string; haveAccount: string; logIn: string; trialNote: string;
  errors: Record<string, string>;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Create your workspace",
    subtitle: "Start for free — a 14-day trial, no credit card.",
    or: "or sign up with email", google: "Continue with Google", facebook: "Continue with Facebook",
    email: "Work email", password: "Password", passwordHint: "At least 12 characters.",
    confirm: "Confirm password", workspace: "Workspace name", workspaceHint: "Your brand, company or team.",
    company: "Company", optional: "optional", country: "Country", countryPlaceholder: "Select a country",
    submit: "Start for free", haveAccount: "Already have an account?", logIn: "Log in",
    trialNote: "By continuing you agree to our Terms and Privacy Policy. No billing during the trial.",
    errors: {
      ...OAUTH_ERRORS.en,
      invalid_email: "Please enter a valid work email address.",
      weak_password: "Password must be at least 12 characters.",
      breached_password: "That password has appeared in a data breach — please choose another.",
      challenge_failed: "Bot verification failed. Please try again.",
      password_mismatch: "The two passwords do not match.",
      missing_workspace: "Please enter a workspace name.",
      missing_country: "Please select your country.",
      email_taken: "That email is already registered. Try logging in instead.",
      rate_limited: "Too many attempts. Please try again in a few minutes.",
      csrf: "Your session expired. Please reload the page and try again.",
      server_error: "Something went wrong creating your workspace. Please try again.",
    },
  },
  sk: {
    title: "Vytvorte si pracovný priestor",
    subtitle: "Začnite zdarma — 14-dňová skúšobná verzia, bez platobnej karty.",
    or: "alebo sa zaregistrujte e-mailom", google: "Pokračovať cez Google", facebook: "Pokračovať cez Facebook",
    email: "Pracovný e-mail", password: "Heslo", passwordHint: "Aspoň 12 znakov.",
    confirm: "Potvrďte heslo", workspace: "Názov pracovného priestoru", workspaceHint: "Vaša značka, firma alebo tím.",
    company: "Firma", optional: "voliteľné", country: "Krajina", countryPlaceholder: "Vyberte krajinu",
    submit: "Začať zdarma", haveAccount: "Už máte účet?", logIn: "Prihlásiť sa",
    trialNote: "Pokračovaním súhlasíte s našimi Podmienkami a Zásadami ochrany súkromia. Počas skúšobnej verzie sa nič neúčtuje.",
    errors: {
      ...OAUTH_ERRORS.sk,
      invalid_email: "Zadajte platnú pracovnú e-mailovú adresu.",
      weak_password: "Heslo musí mať aspoň 12 znakov.",
      breached_password: "Toto heslo sa objavilo v úniku dát — zvoľte iné.",
      challenge_failed: "Overenie proti botom zlyhalo. Skúste znova.",
      password_mismatch: "Heslá sa nezhodujú.",
      missing_workspace: "Zadajte názov pracovného priestoru.",
      missing_country: "Vyberte svoju krajinu.",
      email_taken: "Tento e-mail je už zaregistrovaný. Skúste sa prihlásiť.",
      rate_limited: "Priveľa pokusov. Skúste to o niekoľko minút.",
      csrf: "Vaša relácia vypršala. Obnovte stránku a skúste znova.",
      server_error: "Pri vytváraní pracovného priestoru sa niečo pokazilo. Skúste znova.",
    },
  },
  de: {
    title: "Erstellen Sie Ihren Arbeitsbereich",
    subtitle: "Kostenlos starten — 14 Tage Testphase, ohne Kreditkarte.",
    or: "oder per E-Mail registrieren", google: "Mit Google fortfahren", facebook: "Mit Facebook fortfahren",
    email: "Geschäftliche E-Mail", password: "Passwort", passwordHint: "Mindestens 12 Zeichen.",
    confirm: "Passwort bestätigen", workspace: "Name des Arbeitsbereichs", workspaceHint: "Ihre Marke, Firma oder Ihr Team.",
    company: "Unternehmen", optional: "optional", country: "Land", countryPlaceholder: "Land auswählen",
    submit: "Kostenlos starten", haveAccount: "Sie haben bereits ein Konto?", logIn: "Anmelden",
    trialNote: "Mit dem Fortfahren stimmen Sie unseren Bedingungen und der Datenschutzerklärung zu. Während der Testphase wird nichts berechnet.",
    errors: {
      ...OAUTH_ERRORS.de,
      invalid_email: "Bitte geben Sie eine gültige geschäftliche E-Mail-Adresse ein.",
      weak_password: "Das Passwort muss mindestens 12 Zeichen haben.",
      breached_password: "Dieses Passwort erschien in einem Datenleck — bitte wählen Sie ein anderes.",
      challenge_failed: "Bot-Verifizierung fehlgeschlagen. Bitte erneut versuchen.",
      password_mismatch: "Die beiden Passwörter stimmen nicht überein.",
      missing_workspace: "Bitte geben Sie einen Namen für den Arbeitsbereich ein.",
      missing_country: "Bitte wählen Sie Ihr Land.",
      email_taken: "Diese E-Mail ist bereits registriert. Melden Sie sich stattdessen an.",
      rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
      csrf: "Ihre Sitzung ist abgelaufen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
      server_error: "Beim Erstellen Ihres Arbeitsbereichs ist etwas schiefgelaufen. Bitte versuchen Sie es erneut.",
    },
  },
};

const field = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";
const label = "block text-sm font-medium";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const c = COPY[await getLocale()];
  const errorCode = (await searchParams).error;
  const errorMsg = errorCode ? c.errors[errorCode] ?? c.errors.server_error : null;
  const turnstile = turnstileForRegistration();

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Link href="/" aria-label="Tamanor home"><Logo /></Link></div>
        <div className="gu-card p-6">
          <h1 className="text-xl font-semibold">{c.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.subtitle}</p>

          {errorMsg ? (
            <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {errorMsg}
            </p>
          ) : null}

          <div className="mt-5">
            <SocialAuthButtons mode="register" googleLabel={c.google} facebookLabel={c.facebook} />
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <span className="h-px flex-1 bg-[var(--color-border)]" /> {c.or} <span className="h-px flex-1 bg-[var(--color-border)]" />
          </div>

          <form action={registerAction} className="space-y-4">
            <div>
              <label htmlFor="email" className={label}>{c.email}</label>
              <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={field} />
            </div>
            <div>
              <PasswordField name="password" label={c.password} autoComplete="new-password" required minLength={12} showStrength withGenerator />
              <p id="pw-hint" className="mt-1 text-xs text-[var(--color-muted)]">{c.passwordHint}</p>
            </div>
            <PasswordField name="confirmPassword" label={c.confirm} autoComplete="new-password" required minLength={12} />
            <div>
              <label htmlFor="workspaceName" className={label}>{c.workspace}</label>
              <input id="workspaceName" name="workspaceName" type="text" required minLength={2} maxLength={60} aria-describedby="ws-hint" className={field} />
              <p id="ws-hint" className="mt-1 text-xs text-[var(--color-muted)]">{c.workspaceHint}</p>
            </div>
            <div>
              <label htmlFor="company" className={label}>{c.company} <span className="font-normal text-[var(--color-muted)]">({c.optional})</span></label>
              <input id="company" name="company" type="text" maxLength={80} autoComplete="organization" className={field} />
            </div>
            <div>
              <label htmlFor="country" className={label}>{c.country}</label>
              <select id="country" name="country" required defaultValue="" className={field}>
                <option value="" disabled>{c.countryPlaceholder}</option>
                {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
              </select>
            </div>
            {turnstile.enabled && turnstile.siteKey ? <TurnstileWidget siteKey={turnstile.siteKey} /> : null}
            <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
              {c.submit}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-[var(--color-muted)]">{c.trialNote}</p>
        </div>
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {c.haveAccount}{" "}
          <Link href="/login" className="font-semibold text-[var(--color-brand)] hover:underline">{c.logIn}</Link>
        </p>
      </div>
    </main>
  );
}
