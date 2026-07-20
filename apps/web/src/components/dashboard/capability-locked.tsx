import Link from "next/link";
import type { BooleanFeature } from "@guardora/core";
import type { Locale } from "@/i18n";

/**
 * V1.50F — truthful locked-state panel shown when a tenant member has workspace access but the
 * current PLAN lacks this capability. Explanatory only (the server guard is authoritative): it names
 * the capability + current plan, explains an upgrade is needed, and links to billing. No claim that
 * payment succeeded, no automatic checkout, no destructive action.
 */
const CAPABILITY_LABEL: Record<string, Record<Locale, string>> = {
  reputationAnalytics: { en: "Reputation analytics", sk: "Reputačná analytika", de: "Reputationsanalyse" },
  riskProfiles: { en: "Actor risk profiles", sk: "Rizikové profily aktérov", de: "Akteur-Risikoprofile" },
  incidents: { en: "Incidents", sk: "Incidenty", de: "Vorfälle" },
  controlCenter: { en: "Control Center", sk: "Control Center", de: "Control Center" },
  advancedRules: { en: "Advanced rules", sk: "Pokročilé pravidlá", de: "Erweiterte Regeln" },
  securitySuite: { en: "Security Suite", sk: "Bezpečnostný balík", de: "Security Suite" },
};

const T: Record<Locale, { title: string; body: (cap: string, plan: string) => string; cta: string; note: string; planName: Record<string, string> }> = {
  en: {
    title: "Upgrade to unlock this",
    body: (cap, plan) => `${cap} isn't included in your ${plan} plan. Upgrade to a higher plan to use it — your existing data stays exactly as it is.`,
    cta: "View plans & upgrade", note: "You won't be charged until you choose a plan and confirm checkout.",
    planName: { free_trial: "Free Trial", starter: "Starter", growth: "Growth", agency: "Agency", enterprise: "Enterprise" },
  },
  sk: {
    title: "Odomknite to prechodom na vyšší plán",
    body: (cap, plan) => `${cap} nie je súčasťou vášho plánu ${plan}. Prejdite na vyšší plán a začnite ju používať — vaše existujúce dáta zostanú nezmenené.`,
    cta: "Zobraziť plány a upgradovať", note: "Nič sa neúčtuje, kým nezvolíte plán a nepotvrdíte platbu.",
    planName: { free_trial: "Skúšobná verzia", starter: "Starter", growth: "Growth", agency: "Agency", enterprise: "Enterprise" },
  },
  de: {
    title: "Zum Freischalten upgraden",
    body: (cap, plan) => `${cap} ist in Ihrem ${plan}-Tarif nicht enthalten. Führen Sie ein Upgrade durch, um es zu nutzen — Ihre vorhandenen Daten bleiben unverändert.`,
    cta: "Tarife ansehen & upgraden", note: "Es wird nichts berechnet, bevor Sie einen Tarif wählen und den Checkout bestätigen.",
    planName: { free_trial: "Testphase", starter: "Starter", growth: "Growth", agency: "Agency", enterprise: "Enterprise" },
  },
};

export function CapabilityLockedState({ capability, plan, locale }: { capability: BooleanFeature; plan: string; locale: Locale }) {
  const t = T[locale];
  const capLabel = CAPABILITY_LABEL[capability]?.[locale] ?? capability;
  const planLabel = t.planName[plan] ?? plan;
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </span>
        <h1 className="mt-4 text-xl font-semibold">{t.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t.body(capLabel, planLabel)}</p>
        <Link href="/dashboard/billing" className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{t.cta}</Link>
        <p className="mt-3 text-xs text-[var(--color-muted)]">{t.note}</p>
      </div>
    </div>
  );
}
