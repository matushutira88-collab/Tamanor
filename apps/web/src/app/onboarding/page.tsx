import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { systemDb } from "@guardora/db";
import { Logo } from "@/components/logo";
import { requireSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Welcome to Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Copy = {
  eyebrow: string; title: (ws: string) => string; subtitle: string;
  createdTitle: string; createdBody: (ws: string) => string;
  trialTitle: string; trialBody: (days: number) => string;
  connectTitle: string; connectBody: string;
  connect: string; skip: string; continue: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    eyebrow: "Welcome",
    title: (ws) => `You're all set, ${ws}.`,
    subtitle: "Your workspace is ready. Here's what's next.",
    createdTitle: "Workspace created",
    createdBody: (ws) => `“${ws}” is live with you as the owner.`,
    trialTitle: "14-day free trial active",
    trialBody: (days) => `Your trial is active — ${days} ${days === 1 ? "day" : "days"} remaining. No billing during the trial.`,
    connectTitle: "Connect Facebook Pages (optional)",
    connectBody: "Connect a Facebook Page or Instagram Business account whenever you're ready — you can also do this later.",
    connect: "Connect an account", skip: "Skip for now", continue: "Continue to dashboard",
  },
  sk: {
    eyebrow: "Vitajte",
    title: (ws) => `Všetko je pripravené, ${ws}.`,
    subtitle: "Váš pracovný priestor je pripravený. Tu je, čo nasleduje.",
    createdTitle: "Pracovný priestor vytvorený",
    createdBody: (ws) => `„${ws}“ je aktívny a vy ste jeho vlastník.`,
    trialTitle: "14-dňová skúšobná verzia aktívna",
    trialBody: (days) => `Vaša skúšobná verzia je aktívna — zostáva ${days} dní. Počas skúšobnej verzie sa nič neúčtuje.`,
    connectTitle: "Pripojte Facebook Pages (voliteľné)",
    connectBody: "Facebook Page alebo Instagram Business účet pripojte, keď budete pripravení — môžete to urobiť aj neskôr.",
    connect: "Pripojiť účet", skip: "Zatiaľ preskočiť", continue: "Pokračovať na nástenku",
  },
  de: {
    eyebrow: "Willkommen",
    title: (ws) => `Alles bereit, ${ws}.`,
    subtitle: "Ihr Arbeitsbereich ist bereit. Das kommt als Nächstes.",
    createdTitle: "Arbeitsbereich erstellt",
    createdBody: (ws) => `„${ws}“ ist aktiv, mit Ihnen als Inhaber.`,
    trialTitle: "14-tägige kostenlose Testphase aktiv",
    trialBody: (days) => `Ihre Testphase ist aktiv — noch ${days} Tage. Während der Testphase wird nichts berechnet.`,
    connectTitle: "Facebook Pages verbinden (optional)",
    connectBody: "Verbinden Sie eine Facebook Page oder ein Instagram-Business-Konto, wann immer Sie bereit sind — auch später möglich.",
    connect: "Konto verbinden", skip: "Vorerst überspringen", continue: "Weiter zum Dashboard",
  },
};

function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-sm font-semibold text-[var(--color-brand)]">{n}</span>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{body}</p>
      </div>
    </li>
  );
}

export default async function OnboardingPage() {
  const session = await requireSession();
  const c = COPY[await getLocale()];
  const tenant = await systemDb.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true, trialEndsAt: true, onboardingCompletedAt: true },
  });
  // Onboarding is shown once; a returning (already-onboarded) workspace goes straight in.
  if (tenant?.onboardingCompletedAt) redirect("/dashboard");
  const ws = tenant?.name ?? session.tenantName;
  const daysLeft = tenant?.trialEndsAt
    ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : 14;

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">{c.eyebrow}</p>
          <h1 className="mt-2 gu-display text-2xl md:text-3xl">{c.title(ws)}</h1>
          <p className="mt-3 text-[var(--color-muted)]">{c.subtitle}</p>
        </div>

        <ol className="mt-8 space-y-3">
          <StepCard n={1} title={c.createdTitle} body={c.createdBody(ws)} />
          <StepCard n={2} title={c.trialTitle} body={c.trialBody(daysLeft)} />
          <li className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-sm font-semibold text-[var(--color-brand)]">3</span>
              <div>
                <h2 className="text-base font-semibold">{c.connectTitle}</h2>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{c.connectBody}</p>
                <Link href="/dashboard/accounts" className="mt-3 inline-block rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">
                  {c.connect}
                </Link>
              </div>
            </div>
          </li>
        </ol>

        {/* Skip + Continue both persist onboarding state, then go to the dashboard. */}
        <form action={completeOnboarding} className="mt-8 flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
          <button type="submit" name="intent" value="skip" className="text-sm font-medium text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">{c.skip}</button>
          <button type="submit" name="intent" value="continue" className="w-full rounded-xl bg-[var(--color-brand)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] sm:w-auto">
            {c.continue}
          </button>
        </form>
      </div>
    </main>
  );
}
