"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  Permission, assertCan, summarizeMetaPageOnboarding, encodeMetaOnboardingSummary,
} from "@guardora/core";
import { requireSession } from "@/server/auth";
import { loadOnboardingRaw, clearOnboarding } from "@/server/meta-onboarding";
import { actorFromWebSession } from "@/server/oauth/actor";
import { applyMetaSelection, startFirstSyncs } from "@/server/oauth/meta-selection-service";

/**
 * Confirm the Page (and optionally IG) selection. Only here — after explicit
 * user confirmation — is a real connection persisted or refreshed.
 */
export async function confirmMetaSelection(
  onboardingId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);

  // FLAT MULTI-SELECT. The form submits `select` values keyed `${platform}:${externalId}`
  // for each chosen Facebook Page / Instagram account.
  const selected = formData.getAll("select").map(String).filter(Boolean);

  const row = await loadOnboardingRaw(session, onboardingId);
  if (!row) {
    redirect("/dashboard/accounts/meta/select?flow=expired");
  }

  // M7 — the business rules now live in ONE transport-neutral service that the
  // native mobile selection endpoint calls too. Everything below is transport:
  // scheduling, cache revalidation and the redirect vocabulary, all unchanged.
  const result = await applyMetaSelection({
    actor: actorFromWebSession(session),
    onboarding: row,
    selected,
  });

  if (!result.ok) {
    if (result.code === "bad_brand") redirect("/dashboard/accounts?meta=bad_brand");
    if (result.code === "no_selection") redirect("/dashboard/accounts/meta/select?flow=none_selected");
    redirect("/dashboard/accounts/meta/select?flow=expired");
  }

  // FIRST SYNC ON CONNECT, scheduled AFTER the response so the user never waits on
  // the Meta HTTP cycle. The sync lease dedups; an error never affects the
  // already-committed connection.
  if (result.syncAccountIds.length > 0) {
    const tid = session.tenantId;
    const ids = result.syncAccountIds;
    after(async () => { await startFirstSyncs(tid, ids); });
  }

  await clearOnboarding(session, onboardingId);
  revalidatePath("/dashboard/accounts");
  // COUNTS per bounded outcome only. No Page name, provider id, account id, tenant
  // id or token ever enters the URL.
  const leadSummary = encodeMetaOnboardingSummary(summarizeMetaPageOnboarding(result.outcomes));
  redirect(`/dashboard/accounts?connected=${result.connected}&mon=${result.monitored}&lim=${result.limited}${result.slotTaken ? `&slot=${result.slotTaken}` : ""}${result.credFailed ? `&credfail=${result.credFailed}` : ""}${result.outcomes.length ? `&lead=${leadSummary}` : ""}`);
}

/** Abandon the onboarding flow without connecting anything. */
export async function cancelMetaSelection(onboardingId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.ConnectorManage);
  await loadOnboardingRaw(session, onboardingId); // tenant/user check
  await clearOnboarding(session, onboardingId);
  redirect("/dashboard/accounts");
}
