import type { Metadata } from "next";
import { listUserSessions } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { PasswordField } from "@/components/auth/password-field";
import { changePasswordAction, revokeSessionAction, revokeOthersAction, revokeAllAction } from "./actions";

export const metadata: Metadata = { title: "Security — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    title: "Security", sessionsTitle: "Active sessions", sessionsIntro: "Devices currently signed in to your account.",
    thisDevice: "This device", persistent: "Stays signed in", created: "Signed in", lastActive: "Last active", unknown: "Unknown device",
    revoke: "Log out", revokeOthers: "Log out other devices", revokeAll: "Log out everywhere",
    changeTitle: "Change password", current: "Current password", next: "New password", confirm: "Confirm new password", save: "Update password",
    okChanged: "Password updated. Other devices were signed out.", okRevoked: "Session revoked.", okOthers: "Other devices were signed out.",
    errCurrent: "Current password is incorrect.", errWeak: "Password must be at least 12 characters.", errBreached: "That password has appeared in a data breach — choose another.", errSame: "New password must differ from the current one.", errMismatch: "Passwords do not match.", errCsrf: "Please reload and try again.",
  },
  sk: {
    title: "Bezpečnosť", sessionsTitle: "Aktívne relácie", sessionsIntro: "Zariadenia aktuálne prihlásené do vášho účtu.",
    thisDevice: "Toto zariadenie", persistent: "Zostáva prihlásené", created: "Prihlásené", lastActive: "Naposledy aktívne", unknown: "Neznáme zariadenie",
    revoke: "Odhlásiť", revokeOthers: "Odhlásiť ostatné zariadenia", revokeAll: "Odhlásiť všade",
    changeTitle: "Zmena hesla", current: "Aktuálne heslo", next: "Nové heslo", confirm: "Potvrďte nové heslo", save: "Zmeniť heslo",
    okChanged: "Heslo zmenené. Ostatné zariadenia boli odhlásené.", okRevoked: "Relácia zrušená.", okOthers: "Ostatné zariadenia boli odhlásené.",
    errCurrent: "Aktuálne heslo je nesprávne.", errWeak: "Heslo musí mať aspoň 12 znakov.", errBreached: "Toto heslo sa objavilo v úniku dát — zvoľte iné.", errSame: "Nové heslo sa musí líšiť od aktuálneho.", errMismatch: "Heslá sa nezhodujú.", errCsrf: "Obnovte stránku a skúste znova.",
  },
  de: {
    title: "Sicherheit", sessionsTitle: "Aktive Sitzungen", sessionsIntro: "Aktuell in Ihrem Konto angemeldete Geräte.",
    thisDevice: "Dieses Gerät", persistent: "Bleibt angemeldet", created: "Angemeldet", lastActive: "Zuletzt aktiv", unknown: "Unbekanntes Gerät",
    revoke: "Abmelden", revokeOthers: "Andere Geräte abmelden", revokeAll: "Überall abmelden",
    changeTitle: "Passwort ändern", current: "Aktuelles Passwort", next: "Neues Passwort", confirm: "Neues Passwort bestätigen", save: "Passwort ändern",
    okChanged: "Passwort aktualisiert. Andere Geräte wurden abgemeldet.", okRevoked: "Sitzung widerrufen.", okOthers: "Andere Geräte wurden abgemeldet.",
    errCurrent: "Aktuelles Passwort ist falsch.", errWeak: "Passwort muss mindestens 12 Zeichen haben.", errBreached: "Dieses Passwort erschien in einem Datenleck — wählen Sie ein anderes.", errSame: "Neues Passwort muss sich vom aktuellen unterscheiden.", errMismatch: "Passwörter stimmen nicht überein.", errCsrf: "Bitte neu laden und erneut versuchen.",
  },
} as const;

function fmt(d: Date): string { return d.toISOString().replace("T", " ").slice(0, 16) + " UTC"; }

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireSession();
  const locale = (await getLocale()) as Locale;
  const c = COPY[locale];
  const sp = await searchParams;
  const sessions = await listUserSessions(session.userId, session.sessionId);

  const okMsg = sp.ok === "password_changed" ? c.okChanged : sp.ok === "revoked" ? c.okRevoked : sp.ok === "revoked_others" ? c.okOthers : null;
  const errMap: Record<string, string> = { current_wrong: c.errCurrent, weak: c.errWeak, breached: c.errBreached, same_password: c.errSame, mismatch: c.errMismatch, csrf: c.errCsrf };
  const errMsg = sp.error ? errMap[sp.error] ?? null : null;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-xl font-semibold">{c.title}</h1>

      {okMsg ? <p role="status" className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-2 text-sm text-[var(--color-brand)]">{okMsg}</p> : null}
      {errMsg ? <p role="alert" className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errMsg}</p> : null}

      {/* Active sessions */}
      <section className="gu-card p-5">
        <h2 className="text-sm font-semibold">{c.sessionsTitle}</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{c.sessionsIntro}</p>
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm">
              <div>
                <span className="block font-medium">{s.userAgentSummary ?? c.unknown}{s.current ? ` · ${c.thisDevice}` : ""}{s.rememberMe ? ` · ${c.persistent}` : ""}</span>
                <span className="block text-xs text-[var(--color-muted)]">{c.created}: {fmt(s.createdAt)} · {c.lastActive}: {fmt(s.lastSeenAt)}</span>
              </div>
              {!s.current ? (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <button type="submit" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">{c.revoke}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <form action={revokeOthersAction}><button type="submit" className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:border-[var(--color-brand)]">{c.revokeOthers}</button></form>
          <form action={revokeAllAction}><button type="submit" className="rounded-lg border border-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)]">{c.revokeAll}</button></form>
        </div>
      </section>

      {/* Change password */}
      <section className="gu-card p-5">
        <h2 className="text-sm font-semibold">{c.changeTitle}</h2>
        <form action={changePasswordAction} className="mt-4 space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium">{c.current}</label>
            <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]" />
          </div>
          <PasswordField name="newPassword" label={c.next} autoComplete="new-password" required minLength={12} showStrength withGenerator />
          <PasswordField name="confirmPassword" label={c.confirm} autoComplete="new-password" required minLength={12} />
          <button type="submit" className="rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{c.save}</button>
        </form>
      </section>
    </main>
  );
}
