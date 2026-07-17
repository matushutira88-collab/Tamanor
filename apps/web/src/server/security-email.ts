import "server-only";
import { getEmailTransport, emitOpsEvent, type EmailSendResult } from "@guardora/core";
import type { Locale } from "@/i18n";

/**
 * V1.58.9 phase 2 — security notification emails: new-device login, password changed, password reset
 * completed. Factual, no tokens, no tracking. Each includes a CTA to review active sessions. Delivery
 * failure is a PII-free ops event; it never blocks the underlying security action. Never logs recipient/token.
 */
export type SecurityEmailKind = "new_login" | "password_changed" | "password_reset_completed";

interface Ctx {
  when: string;        // human time (server-formatted; no locale-sensitive PII)
  device?: string | null;
  location?: string | null; // coarse, optional
}

const SESSIONS_URL = () => `${(process.env.APP_BASE_URL || process.env.APP_URL || "").replace(/\/$/, "")}/dashboard/settings/security`;

const COPY: Record<Locale, Record<SecurityEmailKind, { subject: string; lead: string }>> = {
  en: {
    new_login: { subject: "New sign-in to your Tamanor account", lead: "A new sign-in to your Tamanor account was detected." },
    password_changed: { subject: "Your Tamanor password was changed", lead: "Your Tamanor password was just changed." },
    password_reset_completed: { subject: "Your Tamanor password was reset", lead: "Your Tamanor password was reset." },
  },
  sk: {
    new_login: { subject: "Nové prihlásenie do vášho účtu Tamanor", lead: "Zaznamenali sme nové prihlásenie do vášho účtu Tamanor." },
    password_changed: { subject: "Vaše heslo Tamanor bolo zmenené", lead: "Vaše heslo Tamanor bolo práve zmenené." },
    password_reset_completed: { subject: "Vaše heslo Tamanor bolo obnovené", lead: "Vaše heslo Tamanor bolo obnovené." },
  },
  de: {
    new_login: { subject: "Neue Anmeldung bei Ihrem Tamanor-Konto", lead: "Eine neue Anmeldung bei Ihrem Tamanor-Konto wurde erkannt." },
    password_changed: { subject: "Ihr Tamanor-Passwort wurde geändert", lead: "Ihr Tamanor-Passwort wurde soeben geändert." },
    password_reset_completed: { subject: "Ihr Tamanor-Passwort wurde zurückgesetzt", lead: "Ihr Tamanor-Passwort wurde zurückgesetzt." },
  },
};

const REVIEW: Record<Locale, string> = {
  en: "If this wasn’t you, review your active sessions and reset your password immediately.",
  sk: "Ak ste to neboli vy, skontrolujte aktívne relácie a okamžite si zmeňte heslo.",
  de: "Falls Sie das nicht waren, überprüfen Sie Ihre aktiven Sitzungen und ändern Sie sofort Ihr Passwort.",
};
const CTA: Record<Locale, string> = { en: "Review active sessions", sk: "Skontrolovať aktívne relácie", de: "Aktive Sitzungen überprüfen" };

export async function sendSecurityEmail(to: string, locale: Locale, kind: SecurityEmailKind, ctx: Ctx): Promise<EmailSendResult> {
  const c = COPY[locale][kind];
  const url = SESSIONS_URL();
  const details = [ctx.when && `Time: ${ctx.when}`, ctx.device && `Device: ${ctx.device}`, ctx.location && `Location: ${ctx.location}`].filter(Boolean).join(" · ");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + `<p style="font-size:15px;line-height:1.6">${c.lead}</p>`
    + (details ? `<p style="font-size:13px;color:#64748b">${details}</p>` : "")
    + `<p style="font-size:14px;line-height:1.6">${REVIEW[locale]}</p>`
    + `<p><a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">${CTA[locale]}</a></p></div>`;
  const text = `${c.lead}\n${details}\n${REVIEW[locale]}\n${CTA[locale]}: ${url}`;
  const res = await getEmailTransport().send({ to, subject: c.subject, html, text, template: `security_${kind}`, locale });
  if (res.ok) emitOpsEvent("auth.security_email_sent", { operation: kind });
  else emitOpsEvent("auth.email_delivery_failed", { operation: `security_${kind}`, reason: res.reason ?? "delivery_failed" });
  return res;
}
