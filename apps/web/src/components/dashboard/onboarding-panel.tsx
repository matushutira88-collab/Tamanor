import type { OnboardingState } from "@guardora/db";
import type { Dictionary } from "@/i18n";
import { OnboardingWelcome } from "./onboarding-welcome";
import { OnboardingChecklist, type ChecklistItemView } from "./onboarding-checklist";
import { startOnboarding, dismissOnboarding, resumeOnboarding } from "@/app/dashboard/onboarding-actions";

/**
 * V1.66 — chooses which onboarding surface (if any) this member sees, from their OWN persisted status:
 *
 *   not_started -> welcome dialog          in_progress -> live setup checklist
 *   dismissed   -> quiet "continue" entry  completed   -> nothing
 *
 * Every CTA points at an EXISTING route/flow — the checklist never re-implements connecting an account,
 * enabling monitoring or reviewing an item.
 */

const STEP_HREF: Record<string, string> = {
  connect_account: "/dashboard/accounts",
  protect_brand: "/dashboard/accounts",
  enable_monitoring: "/dashboard/accounts",
  first_sync: "/dashboard/accounts",
  first_review: "/dashboard/comments",
};

/** Dictionary key per step (the dict uses camelCase; the domain uses stable snake_case keys). */
const STEP_COPY_KEY: Record<string, keyof Dictionary["onboarding"]["steps"]> = {
  workspace: "workspace",
  connect_account: "connectAccount",
  protect_brand: "protectBrand",
  enable_monitoring: "enableMonitoring",
  first_sync: "firstSync",
  first_review: "firstReview",
};

export function OnboardingPanel({ state, dict }: { state: OnboardingState | null; dict: Dictionary }) {
  if (!state || state.status === "completed") return null;
  const t = dict.onboarding;

  if (state.status === "not_started") {
    return (
      <OnboardingWelcome
        copy={{ welcomeTitle: t.welcomeTitle, welcomeBody: t.welcomeBody, startSetup: t.startSetup, dismissForNow: t.dismissForNow }}
        onStart={startOnboarding}
        onDismiss={dismissOnboarding}
      />
    );
  }

  if (state.status === "dismissed") {
    // Deliberately quiet: a single inline control, never a dialog — the member already said "not now".
    return (
      <form action={resumeOnboarding} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-sm font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 sm:w-auto"
        >
          {t.continueSetup}
        </button>
      </form>
    );
  }

  const items: ChecklistItemView[] = state.checklist.map((c) => {
    const copy = t.steps[STEP_COPY_KEY[c.key] ?? "workspace"];
    const cta = "cta" in copy ? (copy as { cta: string }).cta : undefined;
    return { key: c.key, done: c.done, required: c.required, label: copy.label, body: copy.body, cta, href: STEP_HREF[c.key] };
  });

  return (
    <OnboardingChecklist
      copy={{
        title: t.title, subtitle: t.subtitle, progress: t.progress, next: t.next, doneLabel: t.doneLabel,
        recommended: t.recommended, recommendedNote: t.recommendedNote, collapse: t.collapse, expand: t.expand,
      }}
      items={items}
      completedCount={state.completedCount}
      totalCount={state.totalCount}
      progressPct={state.progressPct}
      nextKey={state.nextStep}
    />
  );
}
