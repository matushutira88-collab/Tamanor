import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { listDevLoginUsers } from "@guardora/db";
import { getSession } from "@/server/auth";
import { signInAs } from "@/server/session-actions";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

export const dynamic = "force-dynamic";

const COPY: Record<Locale, {
  unavailableTitle: string;
  unavailableBody: string;
  contact: string;
  signIn: string;
  devIntro: string;
  noUsers: (cmd: string) => string;
  mockNote: string;
}> = {
  en: {
    unavailableTitle: "Sign-in not available yet",
    unavailableBody:
      "Tamanor account sign-in is being finalized for this environment. If you are an invited pilot user, please use the link from your invitation or contact us.",
    contact: "Contact us",
    signIn: "Sign in",
    devIntro: "Development sign-in. Choose a workspace user to continue.",
    noUsers: (cmd) => `No users yet. Run ${cmd} to create the dev workspace.`,
    mockNote:
      "Mock authentication for local development. No real credentials, no third-party sign-in.",
  },
  sk: {
    unavailableTitle: "Prihlásenie zatiaľ nie je dostupné",
    unavailableBody:
      "Prihlásenie do účtu Tamanor sa pre toto prostredie ešte dokončuje. Ak ste pozvaný pilotný používateľ, použite odkaz z pozvánky alebo nás kontaktujte.",
    contact: "Kontaktujte nás",
    signIn: "Prihlásiť sa",
    devIntro: "Vývojové prihlásenie. Pokračujte výberom používateľa workspace.",
    noUsers: (cmd) => `Zatiaľ žiadni používatelia. Spustite ${cmd} na vytvorenie vývojového workspace.`,
    mockNote:
      "Simulované overenie pre lokálny vývoj. Žiadne skutočné prihlasovacie údaje, žiadne prihlásenie cez tretie strany.",
  },
  de: {
    unavailableTitle: "Anmeldung noch nicht verfügbar",
    unavailableBody:
      "Die Anmeldung beim Tamanor-Konto wird für diese Umgebung noch fertiggestellt. Wenn Sie ein eingeladener Pilotnutzer sind, verwenden Sie bitte den Link aus Ihrer Einladung oder kontaktieren Sie uns.",
    contact: "Kontakt aufnehmen",
    signIn: "Anmelden",
    devIntro: "Entwicklungs-Anmeldung. Wählen Sie einen Workspace-Benutzer, um fortzufahren.",
    noUsers: (cmd) => `Noch keine Benutzer. Führen Sie ${cmd} aus, um den Entwicklungs-Workspace zu erstellen.`,
    mockNote:
      "Simulierte Authentifizierung für die lokale Entwicklung. Keine echten Zugangsdaten, keine Drittanbieter-Anmeldung.",
  },
};

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

  const c = COPY[await getLocale()];

  // V1.39 — the dev sign-in picker is fail-closed OFF in production. It lists real
  // workspace users, and the sign-in action itself is already blocked in production, so
  // we must not render (or query) it there. Production shows a truthful "not available"
  // state until real authentication is configured.
  const devLoginEnabled = process.env.NODE_ENV !== "production";

  if (!devLoginEnabled) {
    return (
      <main className="gu-grid flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <div className="gu-card p-6 text-center">
            <h1 className="text-lg font-semibold">{c.unavailableTitle}</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {c.unavailableBody}
            </p>
            <a
              href="/contact"
              className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)]"
            >
              {c.contact}
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Dev/mock: list existing users to sign in as (system bootstrap, pre-session).
  // Real auth replaces this.
  const users = await listDevLoginUsers();

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="gu-card p-6">
          <h1 className="text-lg font-semibold">{c.signIn}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {c.devIntro}
          </p>

          <div className="mt-5 space-y-2">
            {users.length === 0 ? (
              <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-muted)]">
                {c.noUsers("pnpm db:seed")}
              </p>
            ) : (
              users.map((u) => {
                const m = u.memberships[0];
                return (
                  <form key={u.id} action={signInAs.bind(null, u.id)}>
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-left transition hover:border-[var(--color-brand)]"
                    >
                      <span>
                        <span className="block text-sm font-medium">
                          {u.name ?? u.email}
                        </span>
                        <span className="block text-xs text-[var(--color-muted)]">
                          {u.email}
                          {m ? ` · ${m.tenant.name} · ${m.role}` : ""}
                        </span>
                      </span>
                      <span className="text-[var(--color-brand)]">→</span>
                    </button>
                  </form>
                );
              })
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          {c.mockNote}
        </p>
      </div>
    </main>
  );
}
