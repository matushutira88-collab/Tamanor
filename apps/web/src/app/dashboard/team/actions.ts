"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan, getEmailTransport } from "@guardora/core";
import { createInvite, revokeInvite, resendInvite, removeMember, changeMemberRole } from "@guardora/db";
import { requireSession } from "@/server/auth";

/**
 * V1.71 (Release B / B4) — team server actions. All are POST server actions (same-origin CSRF protection,
 * the existing pattern), MemberManage-gated, tenant-scoped via the session (never a client tenantId). Seat
 * enforcement + audit happen transactionally in the repo. No user-existence is ever enumerated to the
 * caller (invite errors are generic). The invite email carries the one-time token link.
 */

function back(notice: string, kind: "ok" | "error" = "ok"): never {
  revalidatePath("/dashboard/team");
  redirect(`/dashboard/team?kind=${kind}&notice=${encodeURIComponent(notice)}`);
}

async function sendInviteEmail(to: string, token: string): Promise<void> {
  const base = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://guardora.eu").replace(/\/$/, "");
  const url = `${base}/invite/accept?token=${encodeURIComponent(token)}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + `<p style="font-size:15px;line-height:1.6">You've been invited to a Tamanor workspace.</p>`
    + `<p><a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">Accept invitation</a></p>`
    + `<p style="font-size:12px;color:#64748b">This link expires in 7 days.</p></div>`;
  await getEmailTransport().send({ to, subject: "You're invited to Tamanor", html, text: `You've been invited to a Tamanor workspace. Accept: ${url}`, template: "team_invite", locale: "en" }).catch(() => {});
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "viewer");
  const res = await createInvite(session.tenantId, { email, role, invitedByUserId: session.userId });
  if (!res.ok) {
    const msg = res.reason === "seat_limit_reached" ? "You've reached your plan's seat limit. Upgrade or remove members/invites."
      : res.reason === "already_member" ? "That person is already a member."
      : res.reason === "already_invited" ? "There's already a pending invite for that email."
      : "That role can't be assigned.";
    back(msg, "error");
  }
  if (res.ok) await sendInviteEmail(email.trim(), res.token);
  back("Invitation sent.");
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  await revokeInvite(session.tenantId, String(formData.get("inviteId") ?? ""), session.userId);
  back("Invitation revoked.");
}

export async function resendInviteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  const email = String(formData.get("email") ?? "");
  const res = await resendInvite(session.tenantId, String(formData.get("inviteId") ?? ""));
  if (!res.ok) back(res.reason === "rate_limited" ? "Please wait a moment before resending." : "Invitation not found.", "error");
  if (res.ok && email) await sendInviteEmail(email.trim(), res.token);
  back("Invitation resent.");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  const res = await removeMember(session.tenantId, String(formData.get("membershipId") ?? ""), session.userId);
  if (!res.ok) back(res.reason === "last_owner" ? "You can't remove the last owner." : "Member not found.", "error");
  back("Member removed.");
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.MemberManage);
  const res = await changeMemberRole(session.tenantId, String(formData.get("membershipId") ?? ""), String(formData.get("role") ?? "viewer"), session.userId);
  if (!res.ok) back(res.reason === "last_owner" ? "You can't demote the last owner." : "Couldn't change the role.", "error");
  back("Role updated.");
}
