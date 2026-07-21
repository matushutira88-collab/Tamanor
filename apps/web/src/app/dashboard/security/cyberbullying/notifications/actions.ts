"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markNotificationRead, dismissNotification, markAllNotificationsRead } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";

/**
 * C10 — notification read/dismiss actions. A user may only change their OWN
 * notifications (the service fails closed cross-user/cross-tenant). Dismiss never
 * deletes (the row stays auditable). Errors redirect back with a safe code.
 */

const CENTER = "/dashboard/security/cyberbullying/notifications";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(back: string, fn: () => Promise<void>, okKey: string): Promise<never> {
  let ok = okKey;
  try { await fn(); } catch { ok = "error"; }
  revalidatePath(CENTER);
  redirect(`${back}?n=${ok}`);
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const id = str(formData, "notificationId");
  const back = str(formData, "back") || CENTER;
  if (!id) redirect(CENTER);
  await run(back, () => markNotificationRead({ tenantId: s.tenantId, userId: s.userId, role: s.role }, id), "read");
}

export async function dismissNotificationAction(formData: FormData): Promise<void> {
  const s = await requireVerifiedSession();
  const id = str(formData, "notificationId");
  const back = str(formData, "back") || CENTER;
  if (!id) redirect(CENTER);
  await run(back, () => dismissNotification({ tenantId: s.tenantId, userId: s.userId, role: s.role }, id), "dismissed");
}

export async function markAllReadAction(): Promise<void> {
  const s = await requireVerifiedSession();
  await run(CENTER, async () => { await markAllNotificationsRead({ tenantId: s.tenantId, userId: s.userId, role: s.role }); }, "allRead");
}
