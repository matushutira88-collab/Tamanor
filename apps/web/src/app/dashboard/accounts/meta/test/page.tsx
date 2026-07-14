import Link from "next/link";
import { ConnectorStatus, Platform } from "@guardora/core";
import { getMetaSetupStatus, loadEnv } from "@guardora/config";
import { tokenStorageStatus } from "@guardora/db";
import { PageHeader, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { humanize, formatDateTime } from "@/lib/format";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";

export const dynamic = "force-dynamic";

type CheckState = "pass" | "warn" | "fail" | "info";
const STATE_TONE: Record<CheckState, string> = {
  pass: "ok",
  warn: "warn",
  fail: "danger",
  info: "neutral",
};

const COPY: Record<
  Locale,
  {
    title: string;
    description: string;
    ready: string;
    notReady: string;
    connectedAccounts: string;
    sectionEnv: string;
    sectionRuntime: string;
    sectionProduction: string;
    states: Record<CheckState, string>;
    brandExists: string;
    brandCount: (n: number) => string;
    metaConnected: string;
    metaActive: (n: number) => string;
    tokenHealth: string;
    noConnectedAccounts: string;
    needReconnect: (n: number) => string;
    allHealthy: string;
    lastSync: string;
    syncDetail: (
      statusHuman: string,
      mode: string,
      fetched: number,
      created: number,
      deduped: number,
      when: string,
    ) => string;
    noSyncYet: string;
    domain: string;
    domainLocal: string;
    domainCustom: string;
    tokenStorage: string;
    keySet: string;
    keyMissing: string;
    devOnly: string;
    webhookToken: string;
    webhookRequired: string;
    trustPages: string;
    trustPagesDetail: string;
    emailContacts: string;
    emailContactsDetail: string;
    backups: string;
    backupsDetail: string;
    howToRunTitle: string;
    step1Pre: string;
    step1Post: string;
    step2Pre: string;
    step2Post: string;
    step3Pre: string;
    step3Post: string;
    step4: string;
    step5: string;
  }
> = {
  en: {
    title: "Meta live test checklist",
    description:
      "Everything needed before a real Meta App read-only test. No secret values are shown.",
    ready: "Ready for live test",
    notReady: "Not ready",
    connectedAccounts: "← Connected accounts",
    sectionEnv: "Environment",
    sectionRuntime: "Runtime readiness",
    sectionProduction: "Production readiness",
    states: { pass: "pass", warn: "warn", fail: "fail", info: "info" },
    brandExists: "At least one brand exists",
    brandCount: (n) => `${n} brand(s)`,
    metaConnected: "At least one Meta account connected",
    metaActive: (n) => `${n} active`,
    tokenHealth: "Token health",
    noConnectedAccounts: "no connected accounts",
    needReconnect: (n) => `${n} need reconnect`,
    allHealthy: "all healthy",
    lastSync: "Last sync result",
    syncDetail: (statusHuman, mode, fetched, created, deduped, when) =>
      `${statusHuman} · ${mode} · fetched ${fetched}, new ${created}, deduped ${deduped} · ${when}`,
    noSyncYet: "no sync yet",
    domain: "Domain / APP_URL",
    domainLocal: "using localhost — set a real domain for launch",
    domainCustom: "custom domain set",
    tokenStorage: "Token storage mode",
    keySet: " · key set",
    keyMissing: " · key MISSING",
    devOnly: " · dev only, blocked in production",
    webhookToken: "Webhook verify token",
    webhookRequired: "required for webhooks",
    trustPages: "Public trust pages",
    trustPagesDetail: "privacy · terms · security · contact",
    emailContacts: "Email contacts",
    emailContactsDetail:
      "Configure hello@ / security@ / privacy@ tamanor.com before production",
    backups: "Backups & incident response",
    backupsDetail: "configure with your host — see PRODUCTION_READINESS.md",
    howToRunTitle: "How to run the live test",
    step1Pre: "Complete the environment checks (see ",
    step1Post: ").",
    step2Pre: "Connect a real Facebook Page via ",
    step2Post: " and select it.",
    step3Pre: "Set ",
    step3Post: " and restart.",
    step4: "Post a test comment on the Page, then run a read-only sync.",
    step5:
      "Confirm it appears in the Reputation Inbox. No moderation action is taken.",
  },
  sk: {
    title: "Kontrolný zoznam pre živý test Meta",
    description:
      "Všetko potrebné pred skutočným testom Meta App iba na čítanie. Žiadne tajné hodnoty sa nezobrazujú.",
    ready: "Pripravené na živý test",
    notReady: "Nie je pripravené",
    connectedAccounts: "← Pripojené účty",
    sectionEnv: "Prostredie",
    sectionRuntime: "Pripravenosť za behu",
    sectionProduction: "Pripravenosť na produkciu",
    states: {
      pass: "prešlo",
      warn: "varovanie",
      fail: "zlyhalo",
      info: "info",
    },
    brandExists: "Existuje aspoň jedna značka",
    brandCount: (n) => `${n} značka(y)`,
    metaConnected: "Aspoň jeden účet Meta je pripojený",
    metaActive: (n) => `${n} aktívnych`,
    tokenHealth: "Stav tokenu",
    noConnectedAccounts: "žiadne pripojené účty",
    needReconnect: (n) => `${n} vyžaduje opätovné pripojenie`,
    allHealthy: "všetky v poriadku",
    lastSync: "Výsledok posledného synchronizovania",
    syncDetail: (statusHuman, mode, fetched, created, deduped, when) =>
      `${statusHuman} · ${mode} · načítané ${fetched}, nové ${created}, odduplikované ${deduped} · ${when}`,
    noSyncYet: "zatiaľ žiadna synchronizácia",
    domain: "Doména / APP_URL",
    domainLocal:
      "používa sa localhost — pred spustením nastavte skutočnú doménu",
    domainCustom: "vlastná doména nastavená",
    tokenStorage: "Režim ukladania tokenov",
    keySet: " · kľúč nastavený",
    keyMissing: " · kľúč CHÝBA",
    devOnly: " · iba pre vývoj, blokované v produkcii",
    webhookToken: "Overovací token webhooku",
    webhookRequired: "vyžadované pre webhooky",
    trustPages: "Verejné stránky dôvery",
    trustPagesDetail: "ochrana súkromia · podmienky · bezpečnosť · kontakt",
    emailContacts: "E-mailové kontakty",
    emailContactsDetail:
      "Pred produkciou nakonfigurujte hello@ / security@ / privacy@ tamanor.com",
    backups: "Zálohy a reakcia na incidenty",
    backupsDetail:
      "nakonfigurujte u svojho poskytovateľa — pozri PRODUCTION_READINESS.md",
    howToRunTitle: "Ako spustiť živý test",
    step1Pre: "Dokončite kontroly prostredia (pozri ",
    step1Post: ").",
    step2Pre: "Pripojte skutočnú Facebook stránku cez ",
    step2Post: " a vyberte ju.",
    step3Pre: "Nastavte ",
    step3Post: " a reštartujte.",
    step4:
      "Uverejnite testovací komentár na stránke a potom spustite synchronizáciu iba na čítanie.",
    step5:
      "Overte, že sa zobrazí v Reputation Inbox. Nevykoná sa žiadna moderačná akcia.",
  },
  de: {
    title: "Meta-Live-Test-Checkliste",
    description:
      "Alles Nötige vor einem echten schreibgeschützten Test der Meta-App. Es werden keine geheimen Werte angezeigt.",
    ready: "Bereit für den Live-Test",
    notReady: "Nicht bereit",
    connectedAccounts: "← Verbundene Konten",
    sectionEnv: "Umgebung",
    sectionRuntime: "Laufzeitbereitschaft",
    sectionProduction: "Produktionsbereitschaft",
    states: {
      pass: "bestanden",
      warn: "Warnung",
      fail: "fehlgeschlagen",
      info: "Info",
    },
    brandExists: "Mindestens eine Marke vorhanden",
    brandCount: (n) => `${n} Marke(n)`,
    metaConnected: "Mindestens ein Meta-Konto verbunden",
    metaActive: (n) => `${n} aktiv`,
    tokenHealth: "Token-Zustand",
    noConnectedAccounts: "keine verbundenen Konten",
    needReconnect: (n) => `${n} müssen neu verbunden werden`,
    allHealthy: "alle in Ordnung",
    lastSync: "Ergebnis der letzten Synchronisierung",
    syncDetail: (statusHuman, mode, fetched, created, deduped, when) =>
      `${statusHuman} · ${mode} · abgerufen ${fetched}, neu ${created}, dedupliziert ${deduped} · ${when}`,
    noSyncYet: "noch keine Synchronisierung",
    domain: "Domain / APP_URL",
    domainLocal:
      "localhost wird verwendet — legen Sie vor dem Start eine echte Domain fest",
    domainCustom: "eigene Domain festgelegt",
    tokenStorage: "Token-Speichermodus",
    keySet: " · Schlüssel gesetzt",
    keyMissing: " · Schlüssel FEHLT",
    devOnly: " · nur für Entwicklung, in Produktion blockiert",
    webhookToken: "Webhook-Verifizierungs-Token",
    webhookRequired: "für Webhooks erforderlich",
    trustPages: "Öffentliche Vertrauensseiten",
    trustPagesDetail: "Datenschutz · Bedingungen · Sicherheit · Kontakt",
    emailContacts: "E-Mail-Kontakte",
    emailContactsDetail:
      "Konfigurieren Sie vor der Produktion hello@ / security@ / privacy@ tamanor.com",
    backups: "Backups und Reaktion auf Vorfälle",
    backupsDetail:
      "mit Ihrem Hosting-Anbieter konfigurieren — siehe PRODUCTION_READINESS.md",
    howToRunTitle: "So führen Sie den Live-Test durch",
    step1Pre: "Schließen Sie die Umgebungsprüfungen ab (siehe ",
    step1Post: ").",
    step2Pre: "Verbinden Sie eine echte Facebook-Seite über ",
    step2Post: " und wählen Sie sie aus.",
    step3Pre: "Setzen Sie ",
    step3Post: " und starten Sie neu.",
    step4:
      "Veröffentlichen Sie einen Test-Kommentar auf der Seite und führen Sie dann eine schreibgeschützte Synchronisierung durch.",
    step5:
      "Bestätigen Sie, dass er in der Reputation Inbox erscheint. Es wird keine Moderationsaktion durchgeführt.",
  },
};

// Map env setup statuses to checklist states.
const SETUP_STATE: Record<string, CheckState> = {
  configured: "pass",
  on: "pass",
  off: "info",
  missing: "fail",
  invalid: "fail",
};

interface Item {
  label: string;
  state: CheckState;
  detail?: string;
}

export default async function MetaTestPage() {
  const session = await requireSession();
  const setup = getMetaSetupStatus();
  const locale = await getLocale();
  const c = COPY[locale];

  const [brandCount, metaAccounts, lastRun] = await withTenant(session.tenantId, (db) => Promise.all([
    db.brand.count({ where: { tenantId: session.tenantId } }),
    db.connectedAccount.findMany({
      where: {
        tenantId: session.tenantId,
        platform: { in: [Platform.FacebookPage, Platform.InstagramBusiness] },
        status: ConnectorStatus.Active,
      },
      select: {
        id: true,
        platform: true,
        health: true,
        tokenExpiresAt: true,
        lastSuccessfulSyncAt: true,
      },
    }),
    db.syncRun.findFirst({
      where: { tenantId: session.tenantId },
      orderBy: { startedAt: "desc" },
      select: { status: true, mock: true, fetched: true, created: true, deduped: true, startedAt: true },
    }),
  ]));

  // Env checks (no secret values).
  const envItems: Item[] = setup.checks.map((c) => ({
    label: c.label,
    state: SETUP_STATE[c.status] ?? "info",
    detail: c.note,
  }));

  const degraded = metaAccounts.filter((a) => a.health !== "healthy").length;

  // Runtime readiness checks.
  const runtimeItems: Item[] = [
    {
      label: c.brandExists,
      state: brandCount > 0 ? "pass" : "fail",
      detail: c.brandCount(brandCount),
    },
    {
      label: c.metaConnected,
      state: metaAccounts.length > 0 ? "pass" : "warn",
      detail: c.metaActive(metaAccounts.length),
    },
    {
      label: c.tokenHealth,
      state: metaAccounts.length === 0 ? "info" : degraded > 0 ? "warn" : "pass",
      detail:
        metaAccounts.length === 0
          ? c.noConnectedAccounts
          : degraded > 0
            ? c.needReconnect(degraded)
            : c.allHealthy,
    },
    {
      label: c.lastSync,
      state: !lastRun
        ? "info"
        : lastRun.status === "completed"
          ? "pass"
          : lastRun.status === "failed"
            ? "warn"
            : "info",
      detail: lastRun
        ? c.syncDetail(
            humanize(lastRun.status),
            lastRun.mock ? "mock" : "live",
            lastRun.fetched,
            lastRun.created,
            lastRun.deduped,
            formatDateTime(lastRun.startedAt),
          )
        : c.noSyncYet,
    },
  ];

  const readyForLive =
    setup.ready && brandCount > 0 && metaAccounts.length > 0 && degraded === 0;

  // Production readiness checks (no secret values).
  const env = loadEnv();
  const token = tokenStorageStatus();
  const isProd = env.NODE_ENV === "production";
  const appUrlIsLocal = /localhost|127\.0\.0\.1/.test(env.APP_URL);
  const productionItems: Item[] = [
    {
      label: c.domain,
      state: appUrlIsLocal ? "warn" : "pass",
      detail: appUrlIsLocal ? c.domainLocal : c.domainCustom,
    },
    {
      label: c.tokenStorage,
      state: token.productionSafe ? "pass" : isProd ? "fail" : "warn",
      detail: `${token.mode}${token.mode === "aes-gcm" ? (token.keyConfigured ? c.keySet : c.keyMissing) : ""}${token.mode === "plaintext" ? c.devOnly : ""}`,
    },
    {
      label: c.webhookToken,
      state: setup.checks.find((ck) => ck.key === "META_WEBHOOK_VERIFY_TOKEN")?.status === "configured" ? "pass" : "warn",
      detail: c.webhookRequired,
    },
    {
      label: c.trustPages,
      state: "pass",
      detail: c.trustPagesDetail,
    },
    {
      label: c.emailContacts,
      state: "info",
      detail: c.emailContactsDetail,
    },
    {
      label: c.backups,
      state: "info",
      detail: c.backupsDetail,
    },
  ];

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description}
        action={
          <Badge tone={readyForLive ? "ok" : "warn"}>
            {readyForLive ? c.ready : c.notReady}
          </Badge>
        }
      />

      <Link
        href="/dashboard/accounts"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        {c.connectedAccounts}
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title={c.sectionEnv} items={envItems} stateLabels={c.states} />
        <Section title={c.sectionRuntime} items={runtimeItems} stateLabels={c.states} />
      </div>

      <div className="mt-6">
        <Section title={c.sectionProduction} items={productionItems} stateLabels={c.states} />
      </div>

      <div className="mt-6 gu-card p-5 text-xs text-[var(--color-muted)]">
        <p className="font-semibold text-[var(--color-fg)]">{c.howToRunTitle}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>{c.step1Pre}<code>docs/META_SETUP.md</code>{c.step1Post}</li>
          <li>{c.step2Pre}<em>Connect with Meta</em>{c.step2Post}</li>
          <li>{c.step3Pre}<code>META_LIVE_SYNC=true</code>{c.step3Post}</li>
          <li>{c.step4}</li>
          <li>{c.step5}</li>
        </ol>
      </div>
    </>
  );
}

function Section({
  title,
  items,
  stateLabels,
}: {
  title: string;
  items: Item[];
  stateLabels: Record<CheckState, string>;
}) {
  return (
    <div className="gu-card p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {it.label}
              {it.detail ? (
                <span className="ml-2 text-xs text-[var(--color-muted)]">{it.detail}</span>
              ) : null}
            </span>
            <Badge tone={STATE_TONE[it.state]}>{stateLabels[it.state]}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
