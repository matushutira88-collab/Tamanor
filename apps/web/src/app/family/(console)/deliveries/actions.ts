"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { makeSafetySignalDeliveryAvailable, acknowledgeSafetySignalDelivery, declineSafetySignalDelivery, revokeSafetySignalDelivery, archiveSafetySignalDelivery, createSafetySignalDelivery } from "@guardora/db";
import { requireFamilyActor } from "@/server/family-guard";
import { toFamilyActionErrorCode, type FamilyActionState } from "@/server/family-safe-error";

/**
 * CS-C6 — Family server actions for internal deliveries (CS-C5). Session + FAMILY + membership are
 * server-authoritative; tenantId / actorMembershipId are NEVER from the client. The CS-C5 repository
 * re-validates the effective CS-C4 authorization, the status-transition map, and recipient ownership.
 * NOTHING is ever sent externally (no email/SMS/push/webhook).
 */
function str(fd: FormData, k: string): string { return String(fd.get(k) ?? "").trim(); }
const back = (code: string) => redirect(`/family/deliveries?${code}`);

async function run(id: string, fn: (id: string) => Promise<unknown>, ok: string): Promise<void> {
  if (!id) back("e=invalid");
  try { await fn(id); } catch { back("e=error"); }
  revalidatePath("/family/deliveries");
  back(`ok=${ok}`);
}

export async function makeSafetySignalDeliveryAvailableAction(fd: FormData): Promise<void> { const { actor } = await requireFamilyActor(); await run(str(fd, "deliveryId"), (id) => makeSafetySignalDeliveryAvailable(actor, id), "available"); }
export async function acknowledgeSafetySignalDeliveryAction(fd: FormData): Promise<void> { const { actor } = await requireFamilyActor(); await run(str(fd, "deliveryId"), (id) => acknowledgeSafetySignalDelivery(actor, id), "acknowledged"); }
export async function declineSafetySignalDeliveryAction(fd: FormData): Promise<void> { const { actor } = await requireFamilyActor(); await run(str(fd, "deliveryId"), (id) => declineSafetySignalDelivery(actor, id), "declined"); }

/**
 * CS-C6.1 — DESTRUCTIVE (revoke / archive). `useActionState`-shaped: a SAFE error group on failure, redirect
 * only on success. Confirmed in an accessible dialog (never `window.confirm`); actor is server-authoritative.
 */
async function runDestructive(id: string, fn: (id: string) => Promise<unknown>, ok: string): Promise<FamilyActionState> {
  if (!id) return { ok: false, error: "not_found" };
  try { await fn(id); } catch (e) { return { ok: false, error: toFamilyActionErrorCode(e) }; }
  revalidatePath("/family/deliveries");
  redirect(`/family/deliveries?ok=${ok}`);
}
export async function revokeSafetySignalDeliveryAction(_prev: unknown, fd: FormData): Promise<FamilyActionState> { const { actor } = await requireFamilyActor(); return runDestructive(str(fd, "deliveryId"), (id) => revokeSafetySignalDelivery(actor, id), "revoked"); }
export async function archiveSafetySignalDeliveryAction(_prev: unknown, fd: FormData): Promise<FamilyActionState> { const { actor } = await requireFamilyActor(); return runDestructive(str(fd, "deliveryId"), (id) => archiveSafetySignalDelivery(actor, id), "archived"); }

export async function createSafetySignalDeliveryAction(fd: FormData): Promise<void> {
  const { actor } = await requireFamilyActor();
  const recipientAuthorizationDecisionId = str(fd, "recipientAuthorizationDecisionId");
  const idempotencyKey = str(fd, "idempotencyKey");
  if (!recipientAuthorizationDecisionId || !idempotencyKey) back("e=invalid");
  try { await createSafetySignalDelivery(actor, { recipientAuthorizationDecisionId, idempotencyKey }); }
  catch { back("e=error"); }
  revalidatePath("/family/deliveries");
  back("ok=created");
}
