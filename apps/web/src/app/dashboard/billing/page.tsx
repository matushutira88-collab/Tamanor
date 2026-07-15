import type { Metadata } from "next";
import Link from "next/link";
import {
  BILLING_PLANS, SELF_SERVE_PLANS, resolveStripePriceId, Permission, can,
  type BillingInterval,
} from "@guardora/core";
import { getTenantBilling } from "@guardora/db";
import { requireVerifiedSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { startCheckout, openBillingPortal } from "./actions";

export const metadata: Metadata = { title: "Billing — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

type Copy = {
  title: string; sub: string;
  currentPlan: string; status: string; renews: string; interval: string;
  monthly: string; yearly: string; yearlyHint: string;
  subscribe: string; upgrade: string; current: string; contactSales: string; managePortal: string;
  cancelsAt: (d: string) => string; perMonth: string; perYear: string;
  notConfigured: string; ownerOnly: string;
  restricted: { title: string; body: string };
  pastDue: { title: string; body: string };
  trial: { title: string; body: (n: number) => string };
  notices: Record<string, string>;
  errors: Record<string, string>;
  statusLabels: Record<string, string>;
};

const C: Record<Locale, Copy> = {
  en: {
    title: "Billing & plan", sub: "Manage your subscription, plan and invoices.",
    currentPlan: "Current plan", status: "Status", renews: "Renews", interval: "Billing",
    monthly: "Monthly", yearly: "Yearly", yearlyHint: "2 months free",
    subscribe: "Subscribe", upgrade: "Choose plan", current: "Current plan", contactSales: "Contact sales", managePortal: "Manage billing & invoices",
    cancelsAt: (d) => `Cancels on ${d}`, perMonth: "/mo", perYear: "/yr",
    notConfigured: "Online checkout isn't available right now. Please contact us to subscribe.",
    ownerOnly: "Only the workspace owner can change the plan.",
    restricted: { title: "Access restricted", body: "Your trial or subscription has ended. Choose a plan to restore full access. Your data is safe and your accounts stay connected." },
    pastDue: { title: "Payment failed", body: "We couldn't process your last payment. Please update your payment method to keep full access." },
    trial: { title: "Free trial", body: (n) => `You're on the 14-day free trial — ${n} ${n === 1 ? "day" : "days"} remaining. No charge until you subscribe.` },
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
    },
    statusLabels: {
      trialing: "Trial", active: "Active", past_due: "Past due", unpaid: "Unpaid", canceled: "Canceled",
      incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused", no_subscription: "No subscription",
    },
  },
  sk: {
    title: "Fakturácia a plán", sub: "Spravujte predplatné, plán a faktúry.",
    currentPlan: "Aktuálny plán", status: "Stav", renews: "Obnovuje sa", interval: "Fakturácia",
    monthly: "Mesačne", yearly: "Ročne", yearlyHint: "2 mesiace zdarma",
    subscribe: "Predplatiť", upgrade: "Vybrať plán", current: "Aktuálny plán", contactSales: "Kontaktovať obchod", managePortal: "Spravovať fakturáciu a faktúry",
    cancelsAt: (d) => `Ruší sa ${d}`, perMonth: "/mes", perYear: "/rok",
    notConfigured: "Online platba teraz nie je dostupná. Kontaktujte nás pre predplatné.",
    ownerOnly: "Plán môže meniť len vlastník pracovného priestoru.",
    restricted: { title: "Prístup obmedzený", body: "Vaša skúšobná verzia alebo predplatné skončilo. Vyberte plán a obnovte plný prístup. Vaše dáta sú v bezpečí a účty zostávajú pripojené." },
    pastDue: { title: "Platba zlyhala", body: "Poslednú platbu sa nepodarilo spracovať. Aktualizujte platobnú metódu, aby ste si zachovali plný prístup." },
    trial: { title: "Skúšobná verzia zdarma", body: (n) => `Ste na 14-dňovej skúšobnej verzii — zostáva ${n} dní. Kým sa nepredplatíte, nič sa neúčtuje.` },
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
    },
    statusLabels: {
      trialing: "Skúšobná", active: "Aktívne", past_due: "Po splatnosti", unpaid: "Neuhradené", canceled: "Zrušené",
      incomplete: "Neúplné", incomplete_expired: "Vypršané", paused: "Pozastavené", no_subscription: "Bez predplatného",
    },
  },
  de: {
    title: "Abrechnung & Tarif", sub: "Verwalten Sie Abo, Tarif und Rechnungen.",
    currentPlan: "Aktueller Tarif", status: "Status", renews: "Verlängert", interval: "Abrechnung",
    monthly: "Monatlich", yearly: "Jährlich", yearlyHint: "2 Monate gratis",
    subscribe: "Abonnieren", upgrade: "Tarif wählen", current: "Aktueller Tarif", contactSales: "Vertrieb kontaktieren", managePortal: "Abrechnung & Rechnungen verwalten",
    cancelsAt: (d) => `Kündigt am ${d}`, perMonth: "/Mon", perYear: "/Jahr",
    notConfigured: "Online-Checkout ist derzeit nicht verfügbar. Bitte kontaktieren Sie uns.",
    ownerOnly: "Nur der Workspace-Inhaber kann den Tarif ändern.",
    restricted: { title: "Zugriff eingeschränkt", body: "Ihre Testphase oder Ihr Abo ist beendet. Wählen Sie einen Tarif, um den vollen Zugriff wiederherzustellen. Ihre Daten sind sicher und Ihre Konten bleiben verbunden." },
    pastDue: { title: "Zahlung fehlgeschlagen", body: "Ihre letzte Zahlung konnte nicht verarbeitet werden. Bitte aktualisieren Sie Ihre Zahlungsmethode." },
    trial: { title: "Kostenlose Testphase", body: (n) => `Sie sind in der 14-tägigen Testphase — noch ${n} Tage. Bis zum Abo wird nichts berechnet.` },
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
    },
    statusLabels: {
      trialing: "Test", active: "Aktiv", past_due: "Überfällig", unpaid: "Unbezahlt", canceled: "Gekündigt",
      incomplete: "Unvollständig", incomplete_expired: "Abgelaufen", paused: "Pausiert", no_subscription: "Kein Abo",
    },
  },
};

function fmtDate(d: Date | null, locale: Locale): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(d);
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
  const trialEndsAt = b?.trialEndsAt ?? null;
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY)) : 0;
  const sub = b?.subscription ?? null;

  const errorMsg = sp.error ? c.errors[sp.error] ?? c.errors.not_configured : null;
  const noticeMsg = sp.checkout === "success" ? c.notices.success : sp.checkout === "cancel" ? c.notices.cancel : null;

  const priceFor = (planId: keyof typeof BILLING_PLANS) => (interval === "yearly" ? BILLING_PLANS[planId].priceYearly : BILLING_PLANS[planId].priceMonthly);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{c.sub}</p>

      {noticeMsg ? <p role="status" className="mt-4 rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-2 text-sm text-[var(--color-brand)]">{noticeMsg}</p> : null}
      {errorMsg ? <p role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{errorMsg}</p> : null}

      {accessState === "restricted" ? (
        <div className="mt-4 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--color-danger)]">{c.restricted.title}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.restricted.body}</p>
        </div>
      ) : billingStatus === "past_due" ? (
        <div className="mt-4 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--color-warn)]">{c.pastDue.title}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.pastDue.body}</p>
        </div>
      ) : billingStatus === "no_subscription" && trialEndsAt && trialDaysLeft > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-semibold">{c.trial.title}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{c.trial.body(trialDaysLeft)}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:grid-cols-3">
        <div><p className="text-xs text-[var(--color-muted)]">{c.currentPlan}</p><p className="mt-1 font-semibold">{BILLING_PLANS[currentPlanId as keyof typeof BILLING_PLANS]?.name ?? currentPlanId}</p></div>
        <div><p className="text-xs text-[var(--color-muted)]">{c.status}</p><p className="mt-1 font-semibold">{c.statusLabels[billingStatus] ?? billingStatus}</p></div>
        <div>
          <p className="text-xs text-[var(--color-muted)]">{sub?.currentPeriodEnd ? c.renews : c.interval}</p>
          <p className="mt-1 font-semibold">{sub?.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd, locale) : (sub?.billingInterval ? (sub.billingInterval === "yearly" ? c.yearly : c.monthly) : "—")}</p>
          {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd ? <p className="mt-1 text-xs text-[var(--color-warn)]">{c.cancelsAt(fmtDate(sub.currentPeriodEnd, locale))}</p> : null}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-center gap-2 text-sm">
        <Link href="/dashboard/billing?interval=monthly" className={`rounded-lg px-3 py-1.5 ${interval === "monthly" ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border)]"}`}>{c.monthly}</Link>
        <Link href="/dashboard/billing?interval=yearly" className={`rounded-lg px-3 py-1.5 ${interval === "yearly" ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border border-[var(--color-border)]"}`}>{c.yearly} <span className="text-xs opacity-80">· {c.yearlyHint}</span></Link>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {SELF_SERVE_PLANS.map((planId) => {
          const p = BILLING_PLANS[planId];
          const isCurrent = currentPlanId === planId && (billingStatus === "active" || billingStatus === "trialing");
          const canBuy = resolveStripePriceId(planId, interval) !== null;
          return (
            <article key={planId} className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-2"><span className="text-3xl font-semibold text-[var(--color-brand)]">€{priceFor(planId)}</span><span className="text-sm text-[var(--color-muted)]">{interval === "yearly" ? c.perYear : c.perMonth}</span></p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{p.tagline}</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-[var(--color-muted)]">
                {p.features.map((f) => <li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-[var(--color-brand)]">✓</span>{f}</li>)}
              </ul>
              <div className="mt-4">
                {isCurrent ? (
                  <span className="block rounded-xl border border-[var(--color-border-strong)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--color-muted)]">{c.current}</span>
                ) : isOwner && canBuy ? (
                  <form action={startCheckout}>
                    <input type="hidden" name="plan" value={planId} />
                    <input type="hidden" name="interval" value={interval} />
                    <button type="submit" className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">{currentPlanId === "free_trial" || billingStatus === "no_subscription" ? c.subscribe : c.upgrade}</button>
                  </form>
                ) : (
                  <span className="block rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-center text-sm text-[var(--color-muted)]">{isOwner ? c.notConfigured : c.ownerOnly}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:flex-row">
        <div>
          <p className="font-semibold">{BILLING_PLANS.enterprise.name}</p>
          <p className="text-sm text-[var(--color-muted)]">{BILLING_PLANS.enterprise.tagline}</p>
        </div>
        <Link href="/contact" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">{c.contactSales}</Link>
      </div>

      {isOwner && sub?.hasStripeCustomer ? (
        <form action={openBillingPortal} className="mt-6 text-center">
          <button type="submit" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">{c.managePortal}</button>
        </form>
      ) : null}
    </div>
  );
}
