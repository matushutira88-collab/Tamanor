import type { Metadata } from "next";
import Link from "next/link";
import {
  BILLING_PLANS, Permission, can,
  stripePriceAvailability, stripePriceKeyFor,
  type BillingInterval,
} from "@guardora/core";
import { getTenantBilling } from "@/server/billing";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { startCheckout, openBillingPortal } from "./actions";
import { resolveBillingCta } from "./cta";
import { CheckoutButton } from "./checkout-button";

export const metadata: Metadata = { title: "Billing — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

// Plans shown as pricing cards (Enterprise is contact-sales, not self-serve checkout).
const DISPLAY_PLANS = ["starter", "growth", "agency", "enterprise"] as const;

// V1.57 — PRESENTATIONAL comparison matrix. Every cell mirrors the shipped catalogue in
// @guardora/core BILLING_PLANS (limits + features) and asserts nothing beyond it — no business
// logic, no invented capabilities. Rows without any backing plan data are intentionally omitted.
type Cell = boolean | string;
const COMPARE_ROWS: { key: keyof Copy["compareRows"]; cells: [Cell, Cell, Cell, Cell] }[] = [
  // The enforced cap is on MONITORED profiles (entitlements.maxConnectedAccounts). A Facebook Page and an
  // Instagram profile each count as ONE monitored profile; connecting more is allowed but stays unmonitored.
  { key: "connectedAccounts", cells: ["1", "3", "10", "custom"] },   // monitored profiles — enforced (entitlements.maxConnectedAccounts)
  { key: "facebookPages", cells: [true, true, true, true] },         // Facebook supported on every plan
  { key: "instagram", cells: [true, true, true, true] },             // Instagram supported on every plan (agnostic monitored cap)
  { key: "commentsReviews", cells: [true, true, true, true] },       // Starter "Comments & reviews"
  { key: "actionQueue", cells: [true, true, true, true] },           // Starter "Action queue"
  { key: "reputationAnalytics", cells: [false, true, true, true] },  // Growth "Reputation analytics"
  { key: "actorRisk", cells: [false, true, true, true] },            // Growth "Actor risk"
  { key: "controlCenter", cells: [false, true, true, true] },        // Growth "Control Center rules"
  { key: "prioritySupport", cells: [false, false, true, true] },     // Agency "Priority support"
  { key: "dedicatedContact", cells: [false, false, true, true] },    // Agency "Dedicated contact"
  { key: "advancedControls", cells: [false, false, false, true] },   // Enterprise "Advanced controls & roles"
];

type Copy = {
  title: string; sub: string;
  currentPlan: string; status: string; interval: string;
  monthly: string; yearly: string; yearlyHint: string;
  upgradeTo: (name: string) => string; current: string; contactSales: string; managePortal: string;
  cancelsAt: (d: string) => string; perMonth: string; perYear: string;
  custom: string; ownerOnlyShort: string; mostPopular: string;
  checkoutUnavailable: string; contactSupport: string;
  continueToPayment: string; checkoutPending: string; comingSoon: string;
  ownerOnly: string;
  restricted: { title: string; body: string };
  pastDue: { title: string; body: string };
  trial: { active: string; remaining: (n: number) => string; unlocked: string; ends: string; workspace: string };
  wsStatus: Record<string, string>;
  summary: { title: string; billingCycle: string; nextBilling: string; invoiceStatus: string; workspaceId: string; trialRemaining: string };
  invoices: { title: string; body: string };
  compare: { title: string; hint: string; plan: string };
  monitorNote: string;
  compareRows: {
    connectedAccounts: string; facebookPages: string; instagram: string;
    commentsReviews: string; actionQueue: string; reputationAnalytics: string; actorRisk: string;
    controlCenter: string; prioritySupport: string; dedicatedContact: string; advancedControls: string;
  };
  notices: Record<string, string>;
  errors: Record<string, string>;
  statusLabels: Record<string, string>;
  invoiceLabels: Record<string, string>;
};

const C: Record<Locale, Copy> = {
  en: {
    title: "Billing & plan", sub: "Manage your subscription, plan and invoices.",
    currentPlan: "Current plan", status: "Status", interval: "Billing",
    monthly: "Monthly", yearly: "Yearly", yearlyHint: "2 months free",
    upgradeTo: (n) => `Upgrade to ${n}`, current: "Current plan", contactSales: "Contact sales", managePortal: "Manage billing & invoices",
    cancelsAt: (d) => `Cancels on ${d}`, perMonth: "/mo", perYear: "/yr",
    custom: "Custom", ownerOnlyShort: "Owner only", mostPopular: "Most popular",
    checkoutUnavailable: "Checkout temporarily unavailable", contactSupport: "Contact support",
    continueToPayment: "Choose plan", checkoutPending: "Redirecting…", comingSoon: "Coming soon",
    ownerOnly: "Only the workspace owner can change the plan.",
    restricted: { title: "Access restricted", body: "Your trial or subscription has ended. Choose a plan to restore full access. Your data is safe and your accounts stay connected." },
    pastDue: { title: "Payment failed", body: "We couldn't process your last payment. Please update your payment method to keep full access." },
    trial: { active: "Free trial active", remaining: (n) => `${n} ${n === 1 ? "day" : "days"} remaining`, unlocked: "Everything is unlocked during your trial. No payment will be charged until the trial ends.", ends: "Trial ends", workspace: "Workspace" },
    wsStatus: { full_access: "Active", restricted: "Restricted", grace_period: "Grace period", suspended: "Suspended" },
    summary: { title: "Subscription", billingCycle: "Billing cycle", nextBilling: "Next billing date", invoiceStatus: "Invoice status", workspaceId: "Workspace ID", trialRemaining: "Trial remaining" },
    invoices: { title: "No invoices yet", body: "Your first invoice will appear after your first successful subscription payment." },
    compare: { title: "Compare plans", hint: "See what's included in each plan", plan: "Feature" },
    monitorNote: "“Monitored profiles” is the number you can actively protect. A Facebook Page and an Instagram profile each count as one. You can connect more accounts — extra ones stay connected but unmonitored.",
    compareRows: {
      connectedAccounts: "Monitored profiles", facebookPages: "Facebook Pages", instagram: "Instagram",
      commentsReviews: "Comments & reviews", actionQueue: "Action queue", reputationAnalytics: "Reputation analytics", actorRisk: "Actor risk",
      controlCenter: "Control Center rules", prioritySupport: "Priority support", dedicatedContact: "Dedicated contact", advancedControls: "Advanced controls & roles",
    },
    notices: { success: "Payment received — your subscription is being activated.", cancel: "Checkout was cancelled. No charge was made." },
    errors: {
      forbidden: "Only the workspace owner can manage billing.",
      not_configured: "Online checkout isn't available right now.",
      price_not_configured: "That plan isn't available for checkout right now.",
      no_customer: "No billing account yet — subscribe to a plan first.",
      rate_limited: "Too many requests. Please try again shortly.",
      csrf: "Your session expired. Please reload and try again.",
      invalid_plan: "That plan can't be purchased.",
      invalid_interval: "Invalid billing interval.",
      subscription_active: "You already have an active subscription. Use “Manage billing” below to change or cancel it.",
      payment_update_needed: "Your subscription needs a payment update. Use “Manage billing” below to update your payment method.",
      complete_payment: "You have a payment in progress. Use “Manage billing” below to complete it.",
      checkout_in_progress: "A checkout is already in progress. Finish it in the open tab, or wait a few minutes for it to expire before starting a new one.",
      checkout_failed: "We couldn’t start checkout just now. Please try again in a moment.",
    },
    statusLabels: {
      trialing: "Trial", active: "Active", past_due: "Past due", unpaid: "Unpaid", canceled: "Canceled",
      incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused", no_subscription: "No subscription",
    },
    invoiceLabels: { paid: "Paid", open: "Open", draft: "Draft", void: "Void", uncollectible: "Uncollectible", payment_failed: "Payment failed" },
  },
  sk: {
    title: "Fakturácia a plán", sub: "Spravujte predplatné, plán a faktúry.",
    currentPlan: "Aktuálny plán", status: "Stav", interval: "Fakturácia",
    monthly: "Mesačne", yearly: "Ročne", yearlyHint: "2 mesiace zdarma",
    upgradeTo: (n) => `Prejsť na ${n}`, current: "Aktuálny plán", contactSales: "Kontaktovať obchod", managePortal: "Spravovať fakturáciu a faktúry",
    cancelsAt: (d) => `Ruší sa ${d}`, perMonth: "/mes", perYear: "/rok",
    custom: "Na mieru", ownerOnlyShort: "Len vlastník", mostPopular: "Najobľúbenejšie",
    checkoutUnavailable: "Platba dočasne nedostupná", contactSupport: "Kontaktovať podporu",
    continueToPayment: "Vybrať plán", checkoutPending: "Presmerovanie…", comingSoon: "Čoskoro dostupné",
    ownerOnly: "Plán môže meniť len vlastník pracovného priestoru.",
    restricted: { title: "Prístup obmedzený", body: "Vaša skúšobná verzia alebo predplatné skončilo. Vyberte plán a obnovte plný prístup. Vaše dáta sú v bezpečí a účty zostávajú pripojené." },
    pastDue: { title: "Platba zlyhala", body: "Poslednú platbu sa nepodarilo spracovať. Aktualizujte platobnú metódu, aby ste si zachovali plný prístup." },
    trial: { active: "Skúšobná verzia aktívna", remaining: (n) => `zostáva ${n} ${n === 1 ? "deň" : n < 5 ? "dni" : "dní"}`, unlocked: "Počas skúšobnej verzie máte odomknuté všetko. Kým sa neskončí, nič sa neúčtuje.", ends: "Skúšobná verzia končí", workspace: "Pracovný priestor" },
    wsStatus: { full_access: "Aktívny", restricted: "Obmedzený", grace_period: "Ochranná lehota", suspended: "Pozastavený" },
    summary: { title: "Predplatné", billingCycle: "Fakturačný cyklus", nextBilling: "Ďalšia platba", invoiceStatus: "Stav faktúry", workspaceId: "ID pracovného priestoru", trialRemaining: "Zostáva skúšobná verzia" },
    invoices: { title: "Zatiaľ žiadne faktúry", body: "Prvá faktúra sa zobrazí po prvej úspešnej platbe predplatného." },
    compare: { title: "Porovnať plány", hint: "Pozrite si, čo obsahuje každý plán", plan: "Funkcia" },
    monitorNote: "„Monitorované profily“ je počet profilov, ktoré môžete aktívne chrániť. Facebook stránka a Instagram profil sa počítajú každý ako jeden. Pripojiť môžete viac účtov — tie nad rámec ostanú pripojené, ale nemonitorované.",
    compareRows: {
      connectedAccounts: "Monitorované profily", facebookPages: "Facebook stránky", instagram: "Instagram",
      commentsReviews: "Komentáre a recenzie", actionQueue: "Fronta akcií", reputationAnalytics: "Analytika reputácie", actorRisk: "Riziko aktéra",
      controlCenter: "Pravidlá Control Center", prioritySupport: "Prioritná podpora", dedicatedContact: "Vyhradený kontakt", advancedControls: "Pokročilé ovládanie a role",
    },
    notices: { success: "Platba prijatá — vaše predplatné sa aktivuje.", cancel: "Platba bola zrušená. Nič sa neúčtovalo." },
    errors: {
      forbidden: "Fakturáciu môže spravovať len vlastník.",
      not_configured: "Online platba teraz nie je dostupná.",
      price_not_configured: "Tento plán teraz nie je dostupný na kúpu.",
      no_customer: "Zatiaľ žiadny fakturačný účet — najprv sa predplaťte.",
      rate_limited: "Priveľa požiadaviek. Skúste o chvíľu.",
      csrf: "Vaša relácia vypršala. Obnovte stránku a skúste znova.",
      invalid_plan: "Tento plán sa nedá kúpiť.",
      invalid_interval: "Neplatný interval fakturácie.",
      subscription_active: "Už máte aktívne predplatné. Použite „Spravovať fakturáciu“ nižšie na jeho zmenu alebo zrušenie.",
      payment_update_needed: "Vaše predplatné vyžaduje aktualizáciu platby. Použite „Spravovať fakturáciu“ nižšie na aktualizáciu platobnej metódy.",
      complete_payment: "Máte prebiehajúcu platbu. Použite „Spravovať fakturáciu“ nižšie na jej dokončenie.",
      checkout_in_progress: "Platba už prebieha. Dokončite ju v otvorenej karte alebo počkajte pár minút, kým vyprší, než začnete novú.",
      checkout_failed: "Platbu sa teraz nepodarilo spustiť. Skúste to o chvíľu znova.",
    },
    statusLabels: {
      trialing: "Skúšobná", active: "Aktívne", past_due: "Po splatnosti", unpaid: "Neuhradené", canceled: "Zrušené",
      incomplete: "Neúplné", incomplete_expired: "Vypršané", paused: "Pozastavené", no_subscription: "Bez predplatného",
    },
    invoiceLabels: { paid: "Uhradená", open: "Otvorená", draft: "Koncept", void: "Zrušená", uncollectible: "Nevymožiteľná", payment_failed: "Platba zlyhala" },
  },
  de: {
    title: "Abrechnung & Tarif", sub: "Verwalten Sie Abo, Tarif und Rechnungen.",
    currentPlan: "Aktueller Tarif", status: "Status", interval: "Abrechnung",
    monthly: "Monatlich", yearly: "Jährlich", yearlyHint: "2 Monate gratis",
    upgradeTo: (n) => `Wechseln zu ${n}`, current: "Aktueller Tarif", contactSales: "Vertrieb kontaktieren", managePortal: "Abrechnung & Rechnungen verwalten",
    cancelsAt: (d) => `Kündigt am ${d}`, perMonth: "/Mon", perYear: "/Jahr",
    custom: "Individuell", ownerOnlyShort: "Nur Inhaber", mostPopular: "Am beliebtesten",
    checkoutUnavailable: "Checkout vorübergehend nicht verfügbar", contactSupport: "Support kontaktieren",
    continueToPayment: "Tarif wählen", checkoutPending: "Weiterleiten…", comingSoon: "Bald verfügbar",
    ownerOnly: "Nur der Workspace-Inhaber kann den Tarif ändern.",
    restricted: { title: "Zugriff eingeschränkt", body: "Ihre Testphase oder Ihr Abo ist beendet. Wählen Sie einen Tarif, um den vollen Zugriff wiederherzustellen. Ihre Daten sind sicher und Ihre Konten bleiben verbunden." },
    pastDue: { title: "Zahlung fehlgeschlagen", body: "Ihre letzte Zahlung konnte nicht verarbeitet werden. Bitte aktualisieren Sie Ihre Zahlungsmethode." },
    trial: { active: "Testphase aktiv", remaining: (n) => `noch ${n} ${n === 1 ? "Tag" : "Tage"}`, unlocked: "Während der Testphase ist alles freigeschaltet. Bis zum Ende der Testphase wird nichts berechnet.", ends: "Testphase endet", workspace: "Workspace" },
    wsStatus: { full_access: "Aktiv", restricted: "Eingeschränkt", grace_period: "Kulanzfrist", suspended: "Ausgesetzt" },
    summary: { title: "Abo", billingCycle: "Abrechnungszyklus", nextBilling: "Nächste Abrechnung", invoiceStatus: "Rechnungsstatus", workspaceId: "Workspace-ID", trialRemaining: "Verbleibende Testphase" },
    invoices: { title: "Noch keine Rechnungen", body: "Ihre erste Rechnung erscheint nach Ihrer ersten erfolgreichen Abo-Zahlung." },
    compare: { title: "Tarife vergleichen", hint: "Sehen Sie, was jeder Tarif enthält", plan: "Funktion" },
    monitorNote: "„Überwachte Profile“ ist die Anzahl der Profile, die Sie aktiv schützen können. Eine Facebook-Seite und ein Instagram-Profil zählen jeweils als eines. Sie können weitere Konten verbinden — zusätzliche bleiben verbunden, aber unüberwacht.",
    compareRows: {
      connectedAccounts: "Überwachte Profile", facebookPages: "Facebook-Seiten", instagram: "Instagram",
      commentsReviews: "Kommentare & Bewertungen", actionQueue: "Aktionswarteschlange", reputationAnalytics: "Reputationsanalyse", actorRisk: "Akteur-Risiko",
      controlCenter: "Control-Center-Regeln", prioritySupport: "Priorisierter Support", dedicatedContact: "Fester Ansprechpartner", advancedControls: "Erweiterte Steuerung & Rollen",
    },
    notices: { success: "Zahlung erhalten — Ihr Abo wird aktiviert.", cancel: "Checkout abgebrochen. Es wurde nichts berechnet." },
    errors: {
      forbidden: "Nur der Inhaber kann die Abrechnung verwalten.",
      not_configured: "Online-Checkout ist derzeit nicht verfügbar.",
      price_not_configured: "Dieser Tarif ist derzeit nicht buchbar.",
      no_customer: "Noch kein Abrechnungskonto — bitte zuerst abonnieren.",
      rate_limited: "Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.",
      csrf: "Ihre Sitzung ist abgelaufen. Bitte neu laden.",
      invalid_plan: "Dieser Tarif kann nicht gekauft werden.",
      invalid_interval: "Ungültiges Abrechnungsintervall.",
      subscription_active: "Sie haben bereits ein aktives Abonnement. Verwenden Sie unten „Abrechnung verwalten“, um es zu ändern oder zu kündigen.",
      payment_update_needed: "Ihr Abonnement erfordert eine Zahlungsaktualisierung. Verwenden Sie unten „Abrechnung verwalten“, um Ihre Zahlungsmethode zu aktualisieren.",
      complete_payment: "Sie haben eine laufende Zahlung. Verwenden Sie unten „Abrechnung verwalten“, um sie abzuschließen.",
      checkout_in_progress: "Ein Checkout läuft bereits. Schließen Sie ihn im offenen Tab ab oder warten Sie einige Minuten, bis er abläuft, bevor Sie einen neuen starten.",
      checkout_failed: "Der Checkout konnte gerade nicht gestartet werden. Bitte versuchen Sie es gleich noch einmal.",
    },
    statusLabels: {
      trialing: "Test", active: "Aktiv", past_due: "Überfällig", unpaid: "Unbezahlt", canceled: "Gekündigt",
      incomplete: "Unvollständig", incomplete_expired: "Abgelaufen", paused: "Pausiert", no_subscription: "Kein Abo",
    },
    invoiceLabels: { paid: "Bezahlt", open: "Offen", draft: "Entwurf", void: "Storniert", uncollectible: "Uneinbringlich", payment_failed: "Zahlung fehlgeschlagen" },
  },
};

function fmtDate(d: Date | null, locale: Locale): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(d);
}

/** Small labelled value used across the premium info cards. */
function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** Truthful ✓ / — comparison cell. */
function CompareCell({ v }: { v: Cell }) {
  if (v === "custom") return <span className="text-[var(--color-muted)]">—</span>;
  if (typeof v === "string") return <span className="font-semibold">{v}</span>;
  return v
    ? <span className="text-[var(--color-brand)]" aria-label="Included"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="inline"><path d="M20 6 9 17l-5-5" /></svg></span>
    : <span className="text-[var(--color-muted)]" aria-label="Not included">—</span>;
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ interval?: string; error?: string; checkout?: string }> }) {
  const session = await requireVerifiedSession();
  const locale = await getLocale();
  const c = C[locale];
  const sp = await searchParams;
  const interval: BillingInterval = sp.interval === "yearly" ? "yearly" : "monthly";
  const isOwner = can(session.role, Permission.BillingManage);

  const b = await getTenantBilling(session.tenantId);
  const accessState = b?.accessState ?? "full_access";
  const billingStatus = b?.billingStatus ?? "no_subscription";
  const currentPlanId = b?.plan ?? "free_trial";
  const trialStartsAt = b?.trialStartsAt ?? null;
  const trialEndsAt = b?.trialEndsAt ?? null;
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY)) : 0;
  const sub = b?.subscription ?? null;

  // Presentational trial progress (fill = remaining share of the trial window). No business logic.
  const trialTotalDays = trialStartsAt && trialEndsAt
    ? Math.max(1, Math.round((trialEndsAt.getTime() - trialStartsAt.getTime()) / DAY))
    : 14;
  const trialRemainPct = Math.max(0, Math.min(100, Math.round((trialDaysLeft / trialTotalDays) * 100)));

  const errorMsg = sp.error ? c.errors[sp.error] ?? c.errors.not_configured : null;
  const noticeMsg = sp.checkout === "success" ? c.notices.success : sp.checkout === "cancel" ? c.notices.cancel : null;

  // V1.57.4A — per-plan/interval checkout availability, resolved SERVER-SIDE. Only booleans are used
  // in render; no Stripe Price ID reaches the browser. One configured Price activates just that plan.
  const priceAvailability = stripePriceAvailability(process.env, { requireLive: process.env.NODE_ENV === "production" });

  const priceFor = (planId: keyof typeof BILLING_PLANS) => (interval === "yearly" ? BILLING_PLANS[planId].priceYearly : BILLING_PLANS[planId].priceMonthly);
  const isTrialActive = billingStatus === "no_subscription" && !!trialEndsAt && trialDaysLeft > 0 && accessState !== "restricted";
  const invoiceLabel = sub?.latestInvoiceStatus ? (c.invoiceLabels[sub.latestInvoiceStatus] ?? sub.latestInvoiceStatus) : null;

  const btnBase = "block w-full rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]";
  // V1.57.4B — primary conversion CTA (the eye-catching action). Full Tamanor green, white text,
  // medium shadow, rounded-xl, weight 600, hover-darken + lift, pressed state, smooth transition,
  // cursor-pointer, disabled state, keyboard focus ring. inline-flex to seat the icon + label.
  const btnCheckout = "inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] bg-[var(--color-brand)] shadow-md transition-all duration-200 motion-reduce:transition-none hover:bg-[var(--color-brand-strong)] hover:shadow-lg active:translate-y-px active:shadow-md disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]";
  const btnOutline = `${btnBase} border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]`;
  const btnDisabled = `${btnBase} cursor-not-allowed border border-[var(--color-border)] text-[var(--color-muted)]`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{c.sub}</p>
      </header>

      {noticeMsg ? <p role="status" className="mt-4 rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-2 text-sm text-[var(--color-brand)]">{noticeMsg}</p> : null}
      {errorMsg ? <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errorMsg}</p> : null}

      {/* ── Phase 1: premium trial / account-state hero card ── */}
      {accessState === "restricted" ? (
        <section className="mt-6 rounded-2xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-5">
          <p className="text-sm font-semibold text-[var(--color-danger)]">{c.restricted.title}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.restricted.body}</p>
        </section>
      ) : billingStatus === "past_due" ? (
        <section className="mt-6 rounded-2xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-5">
          <p className="text-sm font-semibold text-[var(--color-warn)]">{c.pastDue.title}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.pastDue.body}</p>
        </section>
      ) : isTrialActive ? (
        <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--color-brand)] bg-gradient-to-br from-[var(--color-brand-soft)] to-[var(--color-surface)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-brand)] text-[var(--color-brand-fg)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <p className="text-base font-semibold text-[var(--color-brand)]">{c.trial.active}</p>
            </div>
            <p className="text-sm font-semibold">{c.trial.remaining(trialDaysLeft)}</p>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{c.trial.unlocked}</p>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-valuenow={trialDaysLeft} aria-valuemin={0} aria-valuemax={trialTotalDays} aria-label={c.trial.remaining(trialDaysLeft)}>
            <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${trialRemainPct}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label={c.currentPlan}>{BILLING_PLANS[currentPlanId as keyof typeof BILLING_PLANS]?.name ?? currentPlanId}</Info>
            <Info label={c.trial.ends}>{fmtDate(trialEndsAt, locale)}</Info>
            <Info label={c.trial.workspace}>{session.tenantName}</Info>
            <Info label={c.status}><span className="text-[var(--color-brand)]">{c.wsStatus[accessState] ?? accessState}</span></Info>
          </dl>
        </section>
      ) : null}

      {/* ── Phase 5: subscription summary (premium info cards) ── */}
      <section className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-label={c.summary.title}>
        <h2 className="text-sm font-semibold">{c.summary.title}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Info label={c.currentPlan}>{BILLING_PLANS[currentPlanId as keyof typeof BILLING_PLANS]?.name ?? currentPlanId}</Info>
          <Info label={c.status}>{c.statusLabels[billingStatus] ?? billingStatus}</Info>
          <Info label={c.summary.billingCycle}>{sub?.billingInterval ? (sub.billingInterval === "yearly" ? c.yearly : c.monthly) : "—"}</Info>
          <Info label={billingStatus === "no_subscription" ? c.summary.trialRemaining : c.summary.nextBilling}>
            {billingStatus === "no_subscription"
              ? (trialDaysLeft > 0 ? c.trial.remaining(trialDaysLeft) : "—")
              : fmtDate(sub?.currentPeriodEnd ?? null, locale)}
            {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd ? <span className="mt-0.5 block text-xs font-normal text-[var(--color-warn)]">{c.cancelsAt(fmtDate(sub.currentPeriodEnd, locale))}</span> : null}
          </Info>
          <Info label={c.summary.invoiceStatus}>{invoiceLabel ?? <span className="font-normal text-[var(--color-muted)]">—</span>}</Info>
          <Info label={c.summary.workspaceId}><span className="font-mono text-xs">{session.tenantId}</span></Info>
        </dl>
        {/* Phase 6: premium empty state instead of a bare dash */}
        {!invoiceLabel ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3">
            <p className="text-sm font-semibold">{c.invoices.title}</p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">{c.invoices.body}</p>
          </div>
        ) : null}
      </section>

      {/* ── Billing interval toggle ── */}
      <div className="mt-8 flex items-center justify-center gap-2 text-sm" role="group" aria-label={c.interval}>
        <Link href="/dashboard/billing?interval=monthly" aria-current={interval === "monthly"} className={`rounded-lg px-3 py-1.5 transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${interval === "monthly" ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"}`}>{c.monthly}</Link>
        <Link href="/dashboard/billing?interval=yearly" aria-current={interval === "yearly"} className={`rounded-lg px-3 py-1.5 transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${interval === "yearly" ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"}`}>{c.yearly} <span className="text-xs opacity-80">· {c.yearlyHint}</span></Link>
      </div>

      {/* ── Phase 2/3/7: pricing cards (desktop 4 · tablet 2×2 · mobile 1) ── */}
      <div className="mt-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DISPLAY_PLANS.map((planId) => {
          const p = BILLING_PLANS[planId];
          const highlighted = planId === "growth";
          const isEnterprise = planId === "enterprise";
          const price = priceFor(planId);
          const isCurrent = currentPlanId === planId && (billingStatus === "active" || billingStatus === "trialing");
          // Per-plan/interval availability (never the global billing.configured): this exact plan's
          // Price is validly configured AND the safe checkout chain (secret+webhook+portal) is ready.
          const priceKey = isEnterprise ? null : stripePriceKeyFor(planId, interval);
          const canBuy = !!priceKey && priceAvailability[priceKey];
          return (
            <article
              key={planId}
              className={`relative flex flex-col rounded-2xl p-5 shadow-sm transition duration-200 motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-y-0 ${highlighted ? "border-2 border-[var(--color-brand)] bg-[var(--color-surface)] ring-1 ring-[var(--color-brand)]/20 lg:-my-1" : "border border-[var(--color-border)] bg-[var(--color-surface)]"}`}
            >
              {highlighted ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--color-brand)] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-brand-fg)] shadow-sm">{c.mostPopular}</span>
              ) : null}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-2 flex items-baseline gap-1">
                {price === null
                  ? <span className="text-3xl font-semibold">{c.custom}</span>
                  : <><span className="text-3xl font-semibold tracking-tight">€{price}</span><span className="text-sm text-[var(--color-muted)]">{interval === "yearly" ? c.perYear : c.perMonth}</span></>}
              </p>
              <p className="mt-1 min-h-[2.5rem] text-sm text-[var(--color-muted)]">{p.tagline}</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-[var(--color-muted)]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-[var(--color-brand)]" aria-hidden><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {(() => {
                  switch (resolveBillingCta({ isEnterprise, isCurrent, isOwner, canBuy })) {
                    case "current":
                      return <span className={btnDisabled} aria-disabled="true">{c.current}</span>;
                    case "contact_sales":
                      // Enterprise / Custom only.
                      return <Link href="/contact" className={btnOutline}>{c.contactSales}</Link>;
                    case "checkout":
                      // This exact (plan, interval) has a configured Price + ready chain → real Stripe
                      // Checkout. The form sends ONLY the controlled plan + interval — never a Price ID.
                      return (
                        <form action={startCheckout}>
                          <input type="hidden" name="plan" value={planId} />
                          <input type="hidden" name="interval" value={interval} />
                          <CheckoutButton className={btnCheckout} label={c.continueToPayment} pendingLabel={c.checkoutPending} />
                        </form>
                      );
                    case "checkout_unavailable":
                      // This exact (plan, interval) isn't purchasable yet → a SMALL, truthful helper
                      // line (not a big fake disabled button, no grey rectangle, no /contact redirect).
                      // A missing Growth Price never disables Starter or Agency.
                      return <p className="text-center text-xs font-medium text-[var(--color-muted)]">{c.comingSoon}</p>;
                    default:
                      return <span className={btnDisabled} aria-disabled="true" title={c.ownerOnly}>{c.ownerOnlyShort}</span>;
                  }
                })()}
              </div>
            </article>
          );
        })}
      </div>

      {/* ── Phase 4: expandable Compare Plans (native <details> — zero added hydration) ── */}
      <details className="group mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-5 py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
          <span>{c.compare.title}<span className="ml-2 text-xs font-normal text-[var(--color-muted)]">{c.compare.hint}</span></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="overflow-x-auto border-t border-[var(--color-border)] px-2 pb-2">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">{c.compare.title}</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="px-3 py-3 text-left font-medium text-[var(--color-muted)]">{c.compare.plan}</th>
                {DISPLAY_PLANS.map((planId) => (
                  <th key={planId} scope="col" className={`px-3 py-3 text-center font-semibold ${planId === "growth" ? "text-[var(--color-brand)]" : ""}`}>{BILLING_PLANS[planId].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.key} className="border-b border-[var(--color-border)] last:border-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium">{c.compareRows[row.key]}</th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={`px-3 py-2.5 text-center ${DISPLAY_PLANS[i] === "growth" ? "bg-[var(--color-brand-soft)]/40" : ""}`}>
                      <CompareCell v={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-3 text-xs text-[var(--color-muted)]">{c.monitorNote}</p>
        </div>
      </details>

      {/* ── Manage billing (Stripe portal) — unchanged behaviour ── */}
      {isOwner && sub?.hasStripeCustomer ? (
        <form action={openBillingPortal} className="mt-6 text-center">
          <button type="submit" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold transition motion-reduce:transition-none hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">{c.managePortal}</button>
        </form>
      ) : null}
    </div>
  );
}
