"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markNotificationRead, markAllNotificationsRead } from "@guardora/db";
import { requireSession } from "@/server/auth";

/** Mark one notification read (tenant + member scoped in the repo). */
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  await markNotificationRead(session.tenantId, id, session.userId);
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
  redirect("/dashboard/notifications");
}

/** Mark all of the member's visible notifications read. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await requireSession();
  await markAllNotificationsRead(session.tenantId, session.userId);
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
  redirect("/dashboard/notifications");
}
