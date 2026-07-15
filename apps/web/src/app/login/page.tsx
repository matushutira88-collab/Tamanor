import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { listDevLoginUsers } from "@guardora/db";
import { getSession } from "@/server/auth";
import { signInAs } from "@/server/session-actions";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { SocialAuthButtons } from "@/components/auth/social-buttons";
import { OAUTH_ERRORS } from "@/components/auth/oauth-errors";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Log in — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Copy = {
  title: string; subtitle: string;
  email: string; password: string; submit: string;
  or: string; google: string; facebook: string;
  noAccount: string; startFree: string;
  devTitle: string; devIntro: string; noUsers: (cmd: string) => string; mockNote: string;
  errors: Record<string, string>;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Log in", subtitle: "Welcome back to Tamanor.",
    email: "Work email", password: "Password",
    submit: "Log in", or: "or", google: "Continue with Google", facebook: "Continue with Facebook",
    noAccount: "New to Tamanor?", startFree: "Start for free",
    devTitle: "Developer sign-in", devIntro: "Local development only — choose a workspace user to continue.",
    noUsers: (cmd) => `No users yet. Run ${cmd} to create the dev workspace.`,
    mockNote: "Mock authentication for local development only. Disabled in production.",
    errors: {
      ...OAUTH_ERRORS.en,
      invalid_credentials: "Incorrect email or password.",
      rate_limited: "Too many attempts. Please try again in a few minutes.",
      csrf: "Your session expired. Please reload the page and try again.",
      server_error: "Something went wrong. Please try again.",
    },
  },
  sk: {
    title: "Prihlásenie", subtitle: "Vitajte späť v Tamanore.",
    email: "Pracovný e-mail", password: "Heslo",
    submit: "Prihlásiť sa", or: "alebo", google: "Pokračovať cez Google", facebook: "Pokračovať cez Facebook",
    noAccount: "Ste v Tamanore noví?", startFree: "Začať zdarma",
    devTitle: "Vývojové prihlásenie", devIntro: "Iba pre lokálny vývoj — pokračujte výberom používateľa.",
    noUsers: (cmd) => `Zatiaľ žiadni používatelia. Spustite ${cmd} na vytvorenie vývojového workspace.`,
    mockNote: "Simulované overenie len pre lokálny vývoj. V produkcii je vypnuté.",
    errors: {
      ...OAUTH_ERRORS.sk,
      invalid_credentials: "Nesprávny e-mail alebo heslo.",
      rate_limited: "Priveľa pokusov. Skúste to o niekoľko minút.",
      csrf: "Vaša relácia vypršala. Obnovte stránku a skúste znova.",
      server_error: "Niečo sa pokazilo. Skúste znova.",
    },
  },
  de: {
    title: "Anmelden", subtitle: "Willkommen zurück bei Tamanor.",
    email: "Geschäftliche E-Mail", password: "Passwort",
    submit: "Anmelden", or: "oder", google: "Mit Google fortfahren", facebook: "Mit Facebook fortfahren",
    noAccount: "Neu bei Tamanor?", startFree: "Kostenlos starten",
    devTitle: "Entwickler-Anmeldung", devIntro: "Nur lokale Entwicklung — wählen Sie einen Benutzer, um fortzufahren.",
    noUsers: (cmd) => `Noch keine Benutzer. Führen Sie ${cmd} aus, um den Entwicklungs-Workspace zu erstellen.`,
    mockNote: "Simulierte Authentifizierung nur für die lokale Entwicklung. In der Produktion deaktiviert.",
    errors: {
      ...OAUTH_ERRORS.de,
      invalid_credentials: "Falsche E-Mail oder falsches Passwort.",
      rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
      csrf: "Ihre Sitzung ist abgelaufen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.",
      server_error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    },
  },
};

const field = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";
const label = "block text-sm font-medium";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const c = COPY[await getLocale()];
  const errorCode = (await searchParams).error;
  const errorMsg = errorCode ? c.errors[errorCode] ?? c.errors.server_error : null;

  // The dev sign-in picker is fail-closed OFF in production; it lists real users and
  // the signInAs action itself is disabled in production. Real credential login (above)
  // works in every environment.
  const devLoginEnabled = process.env.NODE_ENV !== "production";
  const devUsers = devLoginEnabled ? await listDevLoginUsers() : [];

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

          <form action={loginAction} className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className={label}>{c.email}</label>
              <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" className={field} />
            </div>
            <div>
              <label htmlFor="password" className={label}>{c.password}</label>
              <input id="password" name="password" type="password" required autoComplete="current-password" className={field} />
            </div>
            <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
              {c.submit}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <span className="h-px flex-1 bg-[var(--color-border)]" /> {c.or} <span className="h-px flex-1 bg-[var(--color-border)]" />
          </div>

          <SocialAuthButtons mode="login" googleLabel={c.google} facebookLabel={c.facebook} />
        </div>

        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {c.noAccount}{" "}
          <Link href="/register" className="font-semibold text-[var(--color-brand)] hover:underline">{c.startFree}</Link>
        </p>

        {devLoginEnabled ? (
          <div className="mt-6 gu-card p-5">
            <h2 className="text-sm font-semibold">{c.devTitle}</h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{c.devIntro}</p>
            <div className="mt-3 space-y-2">
              {devUsers.length === 0 ? (
                <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-muted)]">{c.noUsers("pnpm db:seed")}</p>
              ) : (
                devUsers.map((u) => {
                  const m = u.memberships[0];
                  return (
                    <form key={u.id} action={signInAs.bind(null, u.id)}>
                      <button type="submit" className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-left text-sm transition hover:border-[var(--color-brand)]">
                        <span>
                          <span className="block font-medium">{u.name ?? u.email}</span>
                          <span className="block text-xs text-[var(--color-muted)]">{u.email}{m ? ` · ${m.tenant.name} · ${m.role}` : ""}</span>
                        </span>
                        <span className="text-[var(--color-brand)]">→</span>
                      </button>
                    </form>
                  );
                })
              )}
            </div>
            <p className="mt-3 text-center text-[11px] text-[var(--color-muted)]">{c.mockNote}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
