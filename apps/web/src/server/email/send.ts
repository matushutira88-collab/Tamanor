import "server-only";
import { getEmailTransport, type EmailSendResult } from "@guardora/core";
import type { Locale } from "@/i18n";

/**
 * V1.50C — localized (EN/SK/DE) transactional emails: verification + password reset.
 * Factual and concise: one primary link, an expiry disclosure, and a "didn't request this"
 * note. No tracking pixels, no analytics, no marketing. The one-time URL is passed in by the
 * caller (built from APP_BASE_URL) and is NEVER logged.
 */

/** Absolute base URL for links in emails. APP_BASE_URL preferred; falls back to APP_URL. */
export function emailBaseUrl(): string {
  const raw = process.env.APP_BASE_URL || process.env.APP_URL || "";
  return raw.replace(/\/$/, "");
}

type Built = { subject: string; html: string; text: string };

function layout(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">Tamanor</td></tr>
${bodyHtml}
</table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<tr><td style="padding:8px 0 20px"><a href="${url}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${label}</a></td></tr>`;
}

const VERIFY: Record<Locale, (url: string) => Built> = {
  en: (url) => ({
    subject: "Verify your Tamanor email",
    text: `Verify your email to finish setting up your Tamanor workspace:\n${url}\n\nThis link expires in 24 hours and can be used once. If you didn't create a Tamanor account, you can ignore this email.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Verify your email to finish setting up your Tamanor workspace.</td></tr>` +
        button(url, "Verify email") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">This link expires in 24 hours and can be used once. If you didn't create a Tamanor account, you can safely ignore this email.</td></tr>`,
    ),
  }),
  sk: (url) => ({
    subject: "Overte svoj e-mail v Tamanore",
    text: `Overte svoj e-mail a dokončite nastavenie pracovného priestoru Tamanor:\n${url}\n\nOdkaz platí 24 hodín a dá sa použiť raz. Ak ste si účet Tamanor nevytvárali, tento e-mail môžete ignorovať.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Overte svoj e-mail a dokončite nastavenie pracovného priestoru Tamanor.</td></tr>` +
        button(url, "Overiť e-mail") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">Odkaz platí 24 hodín a dá sa použiť raz. Ak ste si účet Tamanor nevytvárali, tento e-mail pokojne ignorujte.</td></tr>`,
    ),
  }),
  de: (url) => ({
    subject: "Bestätigen Sie Ihre Tamanor-E-Mail",
    text: `Bestätigen Sie Ihre E-Mail, um die Einrichtung Ihres Tamanor-Arbeitsbereichs abzuschließen:\n${url}\n\nDieser Link ist 24 Stunden gültig und einmal verwendbar. Wenn Sie kein Tamanor-Konto erstellt haben, können Sie diese E-Mail ignorieren.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Bestätigen Sie Ihre E-Mail, um die Einrichtung Ihres Tamanor-Arbeitsbereichs abzuschließen.</td></tr>` +
        button(url, "E-Mail bestätigen") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">Dieser Link ist 24 Stunden gültig und einmal verwendbar. Wenn Sie kein Tamanor-Konto erstellt haben, ignorieren Sie diese E-Mail einfach.</td></tr>`,
    ),
  }),
};

const RESET: Record<Locale, (url: string) => Built> = {
  en: (url) => ({
    subject: "Reset your Tamanor password",
    text: `Reset your Tamanor password:\n${url}\n\nThis link expires in 1 hour and can be used once. If you didn't request a password reset, ignore this email — your password stays unchanged.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">We received a request to reset your Tamanor password.</td></tr>` +
        button(url, "Reset password") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">This link expires in 1 hour and can be used once. If you didn't request this, ignore this email — your password stays unchanged.</td></tr>`,
    ),
  }),
  sk: (url) => ({
    subject: "Obnovte svoje heslo v Tamanore",
    text: `Obnovte svoje heslo v Tamanore:\n${url}\n\nOdkaz platí 1 hodinu a dá sa použiť raz. Ak ste o obnovenie hesla nežiadali, ignorujte tento e-mail — vaše heslo zostáva nezmenené.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Dostali sme žiadosť o obnovenie vášho hesla v Tamanore.</td></tr>` +
        button(url, "Obnoviť heslo") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">Odkaz platí 1 hodinu a dá sa použiť raz. Ak ste o to nežiadali, ignorujte tento e-mail — vaše heslo zostáva nezmenené.</td></tr>`,
    ),
  }),
  de: (url) => ({
    subject: "Setzen Sie Ihr Tamanor-Passwort zurück",
    text: `Setzen Sie Ihr Tamanor-Passwort zurück:\n${url}\n\nDieser Link ist 1 Stunde gültig und einmal verwendbar. Wenn Sie kein Zurücksetzen angefordert haben, ignorieren Sie diese E-Mail — Ihr Passwort bleibt unverändert.`,
    html: layout(
      `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Wir haben eine Anfrage zum Zurücksetzen Ihres Tamanor-Passworts erhalten.</td></tr>` +
        button(url, "Passwort zurücksetzen") +
        `<tr><td style="font-size:13px;color:#64748b;line-height:1.6">Dieser Link ist 1 Stunde gültig und einmal verwendbar. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — Ihr Passwort bleibt unverändert.</td></tr>`,
    ),
  }),
};

export function sendVerificationEmail(to: string, locale: Locale, url: string): Promise<EmailSendResult> {
  const built = VERIFY[locale](url);
  return getEmailTransport().send({ to, subject: built.subject, html: built.html, text: built.text, template: "verification", locale });
}

export function sendPasswordResetEmail(to: string, locale: Locale, url: string): Promise<EmailSendResult> {
  const built = RESET[locale](url);
  return getEmailTransport().send({ to, subject: built.subject, html: built.html, text: built.text, template: "password_reset", locale });
}
