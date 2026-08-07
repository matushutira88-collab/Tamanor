import Link from "next/link";
import { PageHeader, Badge, PrimaryButton, Card } from "@/components/dashboard/ui";
import { BrandIcon } from "@/components/dashboard/platform-icon";
import { requirePermission } from "@/server/auth";
import { Permission, Platform } from "@guardora/core";
import { getLocale } from "@/i18n/locale-server";
import type { Locale } from "@/i18n";
import { loadGoogleBusinessSelection, type SelectionUnavailableReason } from "@/server/google-business-selection";
import { confirmGoogleBusinessSelection } from "../actions";

export const dynamic = "force-dynamic";

/**
 * GOOGLE BUSINESS SLICE 2 — location selection.
 *
 * Rendered from a LIVE, fully paginated, server-side discovery (see `@/server/google-business-selection`)
 * — never from a stored snapshot and never from anything the browser supplied. What reaches the client is
 * display metadata only: names, an address summary, verification state and eligibility. No access token,
 * no refresh token, no raw Google payload, and nothing in the URL.
 *
 * NOTHING IS AUTO-IMPORTED. Every checkbox starts unchecked, so the user makes an explicit choice, and
 * only VERIFIED locations get a checkbox at all — an unverified one is rendered as a disabled row with a
 * plain explanation of why it cannot be connected. That is the same truthfulness rule the connector has
 * always applied: only verified locations may sync.
 */

const COPY: Record<Locale, {
  title: string; desc: string; back: string; connectSelected: string;
  noneEligible: string; noneEligibleBody: string; eligible: string; notEligible: string;
  verified: string; unverified: string; unknown: string; alreadyConnected: string;
  brand: string; brandHelp: string; storeCode: string; truncated: string;
  tokenNote: string; readOnly: string; noLocations: string;
  unavailable: Record<SelectionUnavailableReason, string>;
  flow: Record<string, string>;
}> = {
  en: {
    title: "Select Google Business locations",
    desc: "Choose which verified locations to connect. Review monitoring is read-only.",
    back: "← Back to connected accounts",
    connectSelected: "Connect selected locations",
    noneEligible: "No verified locations",
    noneEligibleBody: "Google returned locations, but none of them are verified. Verify a location in your Google Business Profile, then return here.",
    eligible: "Eligible for review monitoring",
    notEligible: "Cannot be connected — not verified by Google",
    verified: "Verified", unverified: "Unverified", unknown: "Verification unknown",
    alreadyConnected: "Already connected",
    brand: "Connect to brand", brandHelp: "Locations are connected under one of your brands.",
    storeCode: "Store code",
    truncated: "Google returned more results than we list here. Some locations may be missing.",
    tokenNote: "Tokens obtained during OAuth are stored server-side only and are never shown here or logged.",
    readOnly: "Read-only",
    noLocations: "This Google account has no locations.",
    unavailable: {
      not_connected: "Google Business is not connected yet. Start the connection first.",
      reconnect_required: "The Google authorization has expired. Reconnect to continue.",
      api_disabled: "The Google Business API is disabled for this deployment.",
      api_access_unconfirmed: "Google has not approved Business Profile API access for this project yet.",
      not_configured: "Google Business is not configured for this deployment.",
      discovery_failed: "Could not read your Google Business locations right now. Try again shortly.",
    },
    flow: {
      none_selected: "Select at least one location first.",
      no_brand: "Choose a brand to connect the locations to.",
    },
  },
  sk: {
    title: "Vyberte prevádzky Google Business",
    desc: "Vyberte overené prevádzky, ktoré chcete pripojiť. Monitoring recenzií je iba na čítanie.",
    back: "← Späť na pripojené účty",
    connectSelected: "Pripojiť vybrané prevádzky",
    noneEligible: "Žiadne overené prevádzky",
    noneEligibleBody: "Google vrátil prevádzky, ale žiadna nie je overená. Overte prevádzku v Google Business Profile a vráťte sa sem.",
    eligible: "Vhodné na monitoring recenzií",
    notEligible: "Nedá sa pripojiť — Google ju neoveril",
    verified: "Overené", unverified: "Neoverené", unknown: "Overenie neznáme",
    alreadyConnected: "Už pripojené",
    brand: "Pripojiť k značke", brandHelp: "Prevádzky sa pripájajú pod jednu z vašich značiek.",
    storeCode: "Kód prevádzky",
    truncated: "Google vrátil viac výsledkov, než tu zobrazujeme. Niektoré prevádzky môžu chýbať.",
    tokenNote: "Tokeny získané počas OAuth sú uložené iba na strane servera a nikdy sa tu nezobrazujú ani nezaznamenávajú.",
    readOnly: "Iba na čítanie",
    noLocations: "Tento účet Google nemá žiadne prevádzky.",
    unavailable: {
      not_connected: "Google Business ešte nie je pripojený. Najprv spustite pripojenie.",
      reconnect_required: "Autorizácia Google vypršala. Pre pokračovanie sa znova pripojte.",
      api_disabled: "Google Business API je v tomto nasadení vypnuté.",
      api_access_unconfirmed: "Google zatiaľ neschválil prístup k Business Profile API pre tento projekt.",
      not_configured: "Google Business nie je v tomto nasadení nakonfigurovaný.",
      discovery_failed: "Momentálne sa nepodarilo načítať vaše prevádzky Google Business. Skúste to o chvíľu.",
    },
    flow: {
      none_selected: "Najprv vyberte aspoň jednu prevádzku.",
      no_brand: "Vyberte značku, ku ktorej sa prevádzky pripoja.",
    },
  },
  de: {
    title: "Google-Business-Standorte auswählen",
    desc: "Wählen Sie die verifizierten Standorte zum Verbinden. Die Bewertungsüberwachung ist schreibgeschützt.",
    back: "← Zurück zu verbundenen Konten",
    connectSelected: "Ausgewählte Standorte verbinden",
    noneEligible: "Keine verifizierten Standorte",
    noneEligibleBody: "Google hat Standorte zurückgegeben, aber keiner ist verifiziert. Verifizieren Sie einen Standort in Ihrem Google-Unternehmensprofil und kehren Sie hierher zurück.",
    eligible: "Für Bewertungsüberwachung geeignet",
    notEligible: "Kann nicht verbunden werden — von Google nicht verifiziert",
    verified: "Verifiziert", unverified: "Nicht verifiziert", unknown: "Verifizierung unbekannt",
    alreadyConnected: "Bereits verbunden",
    brand: "Mit Marke verbinden", brandHelp: "Standorte werden unter einer Ihrer Marken verbunden.",
    storeCode: "Filialcode",
    truncated: "Google hat mehr Ergebnisse geliefert, als hier aufgeführt sind. Einige Standorte fehlen möglicherweise.",
    tokenNote: "Während OAuth erhaltene Tokens werden ausschließlich serverseitig gespeichert und hier weder angezeigt noch protokolliert.",
    readOnly: "Schreibgeschützt",
    noLocations: "Dieses Google-Konto hat keine Standorte.",
    unavailable: {
      not_connected: "Google Business ist noch nicht verbunden. Starten Sie zuerst die Verbindung.",
      reconnect_required: "Die Google-Autorisierung ist abgelaufen. Verbinden Sie sich erneut.",
      api_disabled: "Die Google-Business-API ist für diese Bereitstellung deaktiviert.",
      api_access_unconfirmed: "Google hat den Zugriff auf die Business-Profile-API für dieses Projekt noch nicht genehmigt.",
      not_configured: "Google Business ist für diese Bereitstellung nicht konfiguriert.",
      discovery_failed: "Ihre Google-Business-Standorte konnten gerade nicht gelesen werden. Versuchen Sie es in Kürze erneut.",
    },
    flow: {
      none_selected: "Wählen Sie zuerst mindestens einen Standort.",
      no_brand: "Wählen Sie eine Marke für die Verbindung der Standorte.",
    },
  },
};

export default async function GoogleBusinessSelectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePermission(Permission.ConnectorManage);
  const sp = await searchParams;
  const locale = await getLocale();
  const c = COPY[locale];
  const view = await loadGoogleBusinessSelection(session);

  const backLink = (
    <Link
      href="/dashboard/accounts"
      className="mt-4 inline-block rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-brand)]"
    >
      {c.back}
    </Link>
  );

  // Every unavailable state is a TRUTHFUL, bounded explanation — never a partial or faked selector.
  if (view.state === "unavailable") {
    return (
      <>
        <PageHeader title={c.title} description={c.desc} />
        <Card>
          {/* The bounded reason drives a translated sentence — the slug itself is never rendered. */}
          <p className="text-sm text-[var(--color-muted)]">{c.unavailable[view.reason]}</p>
          {backLink}
        </Card>
      </>
    );
  }

  const flowNotice = sp.flow ? c.flow[sp.flow] : undefined;
  const anyEligible = view.accounts.some((a) => a.locations.some((l) => l.eligible));

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.desc}
        action={<Badge tone="ok">{c.readOnly}</Badge>}
      />

      {flowNotice ? (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">{flowNotice}</div>
      ) : null}
      {view.truncated ? (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]">{c.truncated}</div>
      ) : null}

      {!anyEligible ? (
        <Card>
          <Badge tone="warn">{c.noneEligible}</Badge>
          <p className="mt-3 text-sm text-[var(--color-muted)]">{c.noneEligibleBody}</p>
          {backLink}
        </Card>
      ) : (
        <form action={confirmGoogleBusinessSelection} className="space-y-4">
          <div className="gu-card p-3.5">
            <label className="block text-xs font-medium" htmlFor="gbp-brand">{c.brand}</label>
            <select
              id="gbp-brand"
              name="brandId"
              defaultValue={view.brands[0]?.id ?? ""}
              className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
            >
              {view.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">{c.brandHelp}</p>
          </div>

          {view.accounts.map((acct) => (
            <section key={acct.accountId}>
              <h2 className="mb-2 text-sm font-semibold">
                {acct.accountName ?? acct.accountId}
                {acct.accountType ? <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">{acct.accountType}</span> : null}
              </h2>
              {acct.locations.length === 0 ? (
                <p className="px-1 text-xs text-[var(--color-muted)]">{c.noLocations}</p>
              ) : (
                <fieldset className="space-y-2.5" role="group" aria-label={acct.accountName ?? acct.accountId}>
                  {acct.locations.map((loc) => {
                    const verifyLabel = loc.verificationState === "verified" ? c.verified : loc.verificationState === "unverified" ? c.unverified : c.unknown;
                    // An ineligible location is rendered WITHOUT a checkbox and visually muted, so it
                    // cannot be selected by accident and the reason is stated in plain language.
                    return (
                      <label
                        key={loc.locationId}
                        className={`gu-card flex items-center gap-3 p-3.5 transition ${loc.eligible ? "cursor-pointer hover:border-[var(--color-brand)]" : "cursor-not-allowed opacity-60"}`}
                      >
                        {loc.eligible ? (
                          // Deliberately NOT defaultChecked — nothing is imported without an explicit choice.
                          <input type="checkbox" name="location" value={loc.locationId} className="h-4 w-4 accent-[var(--color-brand)]" />
                        ) : (
                          <input type="checkbox" disabled aria-hidden className="h-4 w-4 opacity-40" />
                        )}
                        <BrandIcon platform={Platform.GoogleBusiness} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{loc.displayName || loc.locationId}</span>
                          <span className="block truncate text-xs text-[var(--color-muted)]">
                            {loc.addressSummary ?? ""}
                            {loc.storeCode ? `${loc.addressSummary ? " · " : ""}${c.storeCode}: ${loc.storeCode}` : ""}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-[var(--color-muted)]">
                            {loc.eligible ? c.eligible : c.notEligible}
                          </span>
                        </span>
                        {loc.alreadyConnected ? <Badge tone="ok">{c.alreadyConnected}</Badge> : null}
                        <Badge tone={loc.eligible ? "brand" : "neutral"}>{verifyLabel}</Badge>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </section>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <PrimaryButton type="submit">{c.connectSelected}</PrimaryButton>
            <Link
              href="/dashboard/accounts"
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]"
            >
              {c.back}
            </Link>
          </div>
        </form>
      )}

      <p className="mt-4 text-xs text-[var(--color-muted)]">{c.tokenNote}</p>
    </>
  );
}
