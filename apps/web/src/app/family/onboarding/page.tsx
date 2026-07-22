import { redirect } from "next/navigation";
import { getFamilyOnboardingState } from "@guardora/db";
import { WorkspaceOnboardingStep, FAMILY_ONBOARDING_STEPS, familyOnboardingStepIndex, ALL_AGE_BANDS } from "@guardora/core";
import { requireFamilyActor } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { Logo } from "@/components/logo";
import { Card, Field, Input, Select, PrimaryButton, SecondaryButton } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../family-i18n";
import { familyOnboardingAdvanceAction, familyOnboardingBackAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FamilyOnboardingPage() {
  const { actor, session } = await requireFamilyActor();
  const t = familyDict(await getLocale());
  const state = await getFamilyOnboardingState(actor);
  if (state.currentStep === WorkspaceOnboardingStep.Complete) redirect("/family");

  const step = state.currentStep;
  const idx = Math.max(0, familyOnboardingStepIndex(step));
  const total = FAMILY_ONBOARDING_STEPS.length - 1; // exclude Complete
  const o = t.onboarding;
  const ageOptions = (ALL_AGE_BANDS as readonly string[]).map((v) => ({ value: v, label: famLabel(t.labels.ageBand, v) }));

  const Nav = ({ nextLabel, canBack = true }: { nextLabel: string; canBack?: boolean }) => (
    <div className="mt-6 flex items-center justify-between">
      {canBack && idx > 0 ? (
        <form action={familyOnboardingBackAction}><input type="hidden" name="currentStep" value={step} /><SecondaryButton type="submit">{o.back}</SecondaryButton></form>
      ) : <span />}
      <PrimaryButton type="submit">{nextLabel}</PrimaryButton>
    </div>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex items-center gap-2"><Logo /><span className="text-sm font-semibold">{t.brand}</span></div>
        <Card>
          <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">{o.stepOf(Math.min(idx + 1, total), total)}</p>
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>

          {step === WorkspaceOnboardingStep.Welcome && (
            <form action={familyOnboardingAdvanceAction}>
              <input type="hidden" name="currentStep" value={step} />
              <h1 className="text-lg font-semibold">{o.welcomeTitle}</h1>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{o.welcomeText}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-[var(--color-muted)]">
                <li>• {t.privacy.messages}</li>
                <li>• {t.privacy.integrations}</li>
              </ul>
              <Nav nextLabel={o.welcomeCta} canBack={false} />
            </form>
          )}

          {step === WorkspaceOnboardingStep.FamilyProfile && (
            <form action={familyOnboardingAdvanceAction} className="space-y-3">
              <input type="hidden" name="currentStep" value={step} />
              <h1 className="text-lg font-semibold">{o.profileTitle}</h1>
              <Field label={o.profileNameLabel}><Input name="workspaceName" defaultValue={session.tenantName} maxLength={60} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={o.localeLabel}><Select name="locale" options={[{ value: "sk", label: "Slovenčina" }, { value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} defaultValue="sk" /></Field>
                <Field label={o.timezoneLabel}><Input name="timezone" defaultValue="Europe/Bratislava" maxLength={40} /></Field>
              </div>
              <Nav nextLabel={o.next} />
            </form>
          )}

          {step === WorkspaceOnboardingStep.PrimaryGuardianConfirmation && (
            <form action={familyOnboardingAdvanceAction} className="space-y-3">
              <input type="hidden" name="currentStep" value={step} />
              <h1 className="text-lg font-semibold">{o.guardianTitle}</h1>
              <p className="text-sm text-[var(--color-muted)]">{o.guardianIntro}</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" /> <span>{o.guardianC1}</span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" /> <span>{o.guardianC2}</span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" /> <span>{o.guardianC3}</span></label>
              <Nav nextLabel={o.next} />
            </form>
          )}

          {step === WorkspaceOnboardingStep.FirstProtectedProfile && (
            <form action={familyOnboardingAdvanceAction} className="space-y-3">
              <input type="hidden" name="currentStep" value={step} />
              <h1 className="text-lg font-semibold">{o.firstProfileTitle}</h1>
              <p className="text-sm text-[var(--color-muted)]">{o.firstProfileIntro}</p>
              <Field label={o.labelField}><Input name="guardianLabel" maxLength={80} placeholder={t.profiles.newLabel} /></Field>
              <Field label={o.ageBandField}><Select name="ageBand" options={ageOptions} required defaultValue="age_10_12" /></Field>
              <Nav nextLabel={o.create} />
            </form>
          )}

          {step === WorkspaceOnboardingStep.PrivacyAndLimits && (
            <form action={familyOnboardingAdvanceAction} className="space-y-3">
              <input type="hidden" name="currentStep" value={step} />
              <h1 className="text-lg font-semibold">{o.privacyTitle}</h1>
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className="mb-1 text-sm font-medium">{o.doesTitle}</p>
                <ul className="space-y-1 text-sm text-[var(--color-muted)]"><li>• {t.dash.recentProfiles}</li><li>• {t.guardians.title}</li><li>• {t.deliveries.title}</li></ul>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className="mb-1 text-sm font-medium">{o.doesnotTitle}</p>
                <ul className="space-y-1 text-sm text-[var(--color-muted)]"><li>• {t.privacy.messages}</li><li>• {t.privacy.integrations}</li></ul>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" /> <span>{t.privacy.signal}</span></label>
              <Nav nextLabel={o.finish} />
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
