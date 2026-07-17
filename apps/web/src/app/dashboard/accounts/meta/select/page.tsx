import Link from "next/link";
import { PageHeader, Badge, PrimaryButton } from "@/components/dashboard/ui";
import { requirePermission } from "@/server/auth";
import { Permission } from "@guardora/core";
import { loadOnboardingForUi } from "@/server/meta-onboarding";
import { confirmMetaSelection, cancelMetaSelection } from "../actions";
import { getLocale } from "@/i18n/locale-server";

// V1.59 — per-account monitoring choices (separate from connecting). Each enable is atomically
// limit-checked (FB=1, IG=1); an account past the plan limit stays connected but unmonitored.
const MON = {
  en: { heading: "Monitor these accounts", fb: "Monitor Facebook Page", ig: "Monitor Instagram account", note: "Facebook Page and Instagram count as separate monitored accounts. Ones over your plan limit stay connected but unmonitored." },
  sk: { heading: "Monitorovať tieto účty", fb: "Monitorovať Facebook Page", ig: "Monitorovať Instagram účet", note: "Facebook Page a Instagram sa počítajú ako samostatné monitorované účty. Účty nad limit plánu ostanú pripojené, ale nemonitorované." },
  de: { heading: "Diese Konten überwachen", fb: "Facebook-Seite überwachen", ig: "Instagram-Konto überwachen", note: "Facebook-Seite und Instagram zählen als separate überwachte Konten. Konten über dem Planlimit bleiben verbunden, aber nicht überwacht." },
} as const;
import type { Locale } from "@/i18n";

export const dynamic = "force-dynamic";

const COPY: Record<
  Locale,
  {
    title: string;
    descNoOnboarding: string;
    flowExpired: string;
    badPage: string;
    sessionMissing: string;
    backToAccounts: string;
    connecting: (brand: string) => string;
    oauthCompleted: string;
    grantedScopes: string;
    readOnly: string;
    pageId: string;
    igLinked: string;
    igNotLinked: string;
    alsoConnectIg: string;
    connectSelected: string;
    cancel: string;
    tokenNote: string;
  }
> = {
  en: {
    title: "Select a Facebook Page",
    descNoOnboarding: "Choose which Page (and optionally Instagram) to connect.",
    flowExpired: "Flow expired",
    badPage: "That Page is no longer available in this onboarding session.",
    sessionMissing:
      "This onboarding session has expired or is missing. Start the Meta connection again.",
    backToAccounts: "← Back to connected accounts",
    connecting: (brand) =>
      `Connecting to brand: ${brand}. Read-only — no moderation actions.`,
    oauthCompleted: "OAuth completed",
    grantedScopes: "Granted scopes:",
    readOnly: "Read-only",
    pageId: "Page ID",
    igLinked: "✓ Instagram Business linked",
    igNotLinked: "No Instagram Business account linked",
    alsoConnectIg:
      "Also connect the linked Instagram Business account (when available)",
    connectSelected: "Connect selected Page",
    cancel: "Cancel",
    tokenNote:
      "Tokens obtained during OAuth are stored server-side only and are never shown here or logged.",
  },
  sk: {
    title: "Vyberte Facebook stránku",
    descNoOnboarding:
      "Vyberte, ktorú stránku (a voliteľne Instagram) chcete pripojiť.",
    flowExpired: "Postup vypršal",
    badPage: "Táto stránka už nie je dostupná v tejto relácii nastavenia.",
    sessionMissing:
      "Táto relácia nastavenia vypršala alebo chýba. Spustite pripojenie Meta znova.",
    backToAccounts: "← Späť na pripojené účty",
    connecting: (brand) =>
      `Pripája sa k značke: ${brand}. Iba na čítanie — žiadne moderačné akcie.`,
    oauthCompleted: "OAuth dokončený",
    grantedScopes: "Udelené oprávnenia:",
    readOnly: "Iba na čítanie",
    pageId: "ID stránky",
    igLinked: "✓ Instagram Business prepojený",
    igNotLinked: "Žiadny prepojený účet Instagram Business",
    alsoConnectIg:
      "Pripojiť aj prepojený účet Instagram Business (ak je k dispozícii)",
    connectSelected: "Pripojiť vybranú stránku",
    cancel: "Zrušiť",
    tokenNote:
      "Tokeny získané počas OAuth sú uložené iba na strane servera a nikdy sa tu nezobrazujú ani nezaznamenávajú.",
  },
  de: {
    title: "Facebook-Seite auswählen",
    descNoOnboarding:
      "Wählen Sie, welche Seite (und optional Instagram) verbunden werden soll.",
    flowExpired: "Vorgang abgelaufen",
    badPage: "Diese Seite ist in dieser Onboarding-Sitzung nicht mehr verfügbar.",
    sessionMissing:
      "Diese Onboarding-Sitzung ist abgelaufen oder fehlt. Starten Sie die Meta-Verbindung erneut.",
    backToAccounts: "← Zurück zu verbundenen Konten",
    connecting: (brand) =>
      `Verbindung mit Marke: ${brand}. Schreibgeschützt — keine Moderationsaktionen.`,
    oauthCompleted: "OAuth abgeschlossen",
    grantedScopes: "Erteilte Berechtigungen:",
    readOnly: "Schreibgeschützt",
    pageId: "Seiten-ID",
    igLinked: "✓ Instagram Business verknüpft",
    igNotLinked: "Kein Instagram-Business-Konto verknüpft",
    alsoConnectIg:
      "Auch das verknüpfte Instagram-Business-Konto verbinden (falls verfügbar)",
    connectSelected: "Ausgewählte Seite verbinden",
    cancel: "Abbrechen",
    tokenNote:
      "Während OAuth erhaltene Tokens werden ausschließlich serverseitig gespeichert und hier weder angezeigt noch protokolliert.",
  },
};

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default async function MetaSelectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission(Permission.ConnectorManage);
  const sp = await searchParams;
  const onboarding = await loadOnboardingForUi(session);
  const locale = await getLocale();
  const c = COPY[locale];

  if (!onboarding) {
    return (
      <>
        <PageHeader
          title={c.title}
          description={c.descNoOnboarding}
        />
        <div className="gu-card p-6">
          <Badge tone="warn">{c.flowExpired}</Badge>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {sp.flow === "bad_page" ? c.badPage : c.sessionMissing}
          </p>
          <Link
            href="/dashboard/accounts"
            className="mt-4 inline-block rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-brand)]"
          >
            {c.backToAccounts}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.connecting(onboarding.brandName)}
        action={<Badge tone="ok">{c.oauthCompleted}</Badge>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <span className="text-xs text-[var(--color-muted)]">{c.grantedScopes}</span>
        {onboarding.grantedScopes.map((s) => (
          <Badge key={s} tone="ok">{s}</Badge>
        ))}
      </div>

      <form action={confirmMetaSelection.bind(null, onboarding.id)} className="space-y-3">
        {onboarding.pages.map((p, i) => (
          <label
            key={p.pageId}
            className="gu-card flex cursor-pointer items-start gap-3 p-4 transition hover:border-[var(--color-brand)]"
          >
            <input
              type="radio"
              name="pageId"
              value={p.pageId}
              defaultChecked={i === 0}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge tone="brand">{c.readOnly}</Badge>
                {p.category ? <Badge>{p.category}</Badge> : null}
              </div>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-muted)]">
                {c.pageId} {shortId(p.pageId)}
              </p>
              <p className="mt-1 text-xs">
                {p.hasInstagram ? (
                  <span className="text-[var(--color-ok)]">
                    {c.igLinked}
                    {p.igUsername ? ` (@${p.igUsername})` : ""}
                  </span>
                ) : (
                  <span className="text-[var(--color-muted)]">
                    {c.igNotLinked}
                  </span>
                )}
              </p>
            </div>
          </label>
        ))}

        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" name="connectIg" defaultChecked />
          <span className="text-[var(--color-muted)]">
            {c.alsoConnectIg}
          </span>
        </label>

        {/* V1.59 — CONNECT and MONITOR are separate, per-account choices (FB and IG counted separately). */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
          <p className="mb-2 text-xs font-medium text-[var(--color-muted)]">{MON[locale].heading}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="monitorFb" defaultChecked />
            <span>{MON[locale].fb}</span>
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-sm">
            <input type="checkbox" name="monitorIg" defaultChecked />
            <span>{MON[locale].ig}</span>
          </label>
          <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">{MON[locale].note}</p>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <PrimaryButton type="submit">{c.connectSelected}</PrimaryButton>
          <button
            type="submit"
            formAction={cancelMetaSelection.bind(null, onboarding.id)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
          >
            {c.cancel}
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        {c.tokenNote}
      </p>
    </>
  );
}
