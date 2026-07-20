"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan, Permission } from "@guardora/core";
import { requireVerifiedSession } from "@/server/auth";
import { persistSecurityScoreSnapshot } from "@/server/security-score";

/**
 * Persist an auditable Security Score snapshot. Write action → requires
 * security:manage (Admin+/Owner); a Viewer/Analyst never reaches this because the
 * button is only rendered for managers, and assertCan is the server-side backstop.
 */
export async function saveSecurityScoreSnapshotAction(): Promise<void> {
  const session = await requireVerifiedSession();
  assertCan(session.role, Permission.SecurityManage);
  await persistSecurityScoreSnapshot(session);
  revalidatePath("/dashboard/security");
  redirect("/dashboard/security?saved=1");
}
