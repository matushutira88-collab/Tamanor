import { getEmailTransport, isEmailCriticalType, type NotificationType } from "@guardora/core";
import { systemDb } from "./index";
import { markNotificationEmailSent } from "./notification-repo";

/**
 * V1.70 (Release B / B2) — email ONLY for critical notifications (payment_failed, trial_expired,
 * account_reconnect_required). Recipients are the tenant's owner/admin members (who manage billing +
 * connections). Idempotent: emailSentAt is stamped once, so the same notification never re-emails. Uses
 * the existing email transport (respects the tenant/provider email config; a null transport fails
 * truthfully). Best-effort — callers wrap this so a delivery failure never breaks the trigger path.
 */
const CRITICAL_EMAIL_COPY: Partial<Record<NotificationType, { subject: string; lead: string }>> = {
  payment_failed: { subject: "Action needed: payment failed — Tamanor", lead: "A payment on your Tamanor account could not be processed. Please update your billing to avoid interruption of monitoring and moderation." },
  trial_expired: { subject: "Your Tamanor trial has ended", lead: "Your free trial has ended. Upgrade to restore full access to monitoring and moderation." },
  account_reconnect_required: { subject: "Action needed: reconnect an account — Tamanor", lead: "One of your connected accounts needs to be reconnected so Tamanor can keep monitoring it." },
};

export async function sendCriticalNotificationEmail(tenantId: string, notificationId: string, type: NotificationType): Promise<void> {
  if (!isEmailCriticalType(type)) return;
  const copy = CRITICAL_EMAIL_COPY[type];
  if (!copy) return;

  const members = await systemDb.membership.findMany({
    where: { tenantId, role: { in: ["owner", "admin"] } },
    select: { user: { select: { email: true } } },
  });
  const recipients = [...new Set(members.map((m) => m.user?.email).filter((e): e is string => !!e))];
  if (recipients.length === 0) return;

  const base = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://guardora.eu").replace(/\/$/, "");
  const url = `${base}/dashboard/notifications`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + `<p style="font-size:15px;line-height:1.6">${copy.lead}</p>`
    + `<p><a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open Tamanor</a></p></div>`;
  const text = `${copy.lead}\nOpen Tamanor: ${url}`;

  let anySent = false;
  for (const to of recipients) {
    const res = await getEmailTransport().send({ to, subject: copy.subject, html, text, template: `notif_${type}`, locale: "en" });
    if (res.ok) anySent = true;
  }
  if (anySent) await markNotificationEmailSent(tenantId, notificationId, new Date());
}
