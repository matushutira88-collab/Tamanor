import Link from "next/link";
import { can, Permission } from "@guardora/core";
import { PageHeader, Card, SectionHeader, Badge, StatCard } from "@/components/dashboard/ui";
import { requireVerifiedSession } from "@/server/auth";
import { requireDashboardCapability } from "@/server/route-guard";
import { CapabilityLockedState } from "@/components/dashboard/capability-locked";
import { AccessDeniedState } from "@/components/dashboard/access-denied";
import { getLocale } from "@/i18n/locale-server";
import { type Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

/**
 * S0 — Security Center shell. Gated by the `securitySuite` entitlement and the
 * `security:view` permission. This is the hub the Security Suite composes into;
 * it deliberately makes NO fake claims and queries none of the S2–S4 tables yet
 * (detectors ship in later phases). Each module tile states its phase honestly.
 * Incident Center reuses the existing /dashboard/incidents surface.
 */

type Copy = {
  eyebrow: string;
  title: string;
  description: string;
  postureTitle: string;
  postureBody: string;
  soon: string;
  active: string;
  modulesTitle: string;
  open: string;
  score: { title: string; body: string };
  detections: { title: string; body: string };
  brand: { title: string; body: string };
  incidents: { title: string; body: string; cta: string };
  stats: { score: string; detections: string; incidents: string; accounts: string };
  pending: string;
  detectOnly: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    eyebrow: "Security",
    title: "Security Center",
    description:
      "Your security posture in one place — score, possible account-takeover signals, brand-abuse cases, and incidents. Detection and response only; Tamanor never takes a platform action on its own.",
    postureTitle: "Security Score is being set up",
    postureBody:
      "A composite 0–100 posture score across access, connector, coverage, response, and compliance dimensions. It lands in the next phase and will appear here with a full breakdown and trend.",
    soon: "Coming soon",
    active: "Available",
    modulesTitle: "Modules",
    open: "Open",
    score: { title: "Security Score", body: "Composite posture across access, connectors, coverage, response and compliance." },
    detections: { title: "Account Takeover Detection", body: "Signals of a possible account takeover — never a confirmed claim. Reviewed by a human before any action." },
    brand: { title: "Brand Protection", body: "Impersonation, handle-squatting and phishing cases from sanctioned signals — no scraping." },
    incidents: { title: "Incident Center", body: "The full lifecycle for security incidents, extending your existing incidents.", cta: "Open Incidents" },
    stats: { score: "Security Score", detections: "Open detections", incidents: "Open incidents", accounts: "At-risk accounts" },
    pending: "Pending",
    detectOnly: "Detection & response only — no new platform-mutation power.",
  },
  sk: {
    eyebrow: "Bezpečnosť",
    title: "Bezpečnostné centrum",
    description:
      "Vaša bezpečnostná situácia na jednom mieste — skóre, signály možného prevzatia účtu, prípady zneužitia značky a incidenty. Iba detekcia a reakcia; Tamanor nikdy nevykoná akciu na platforme sám.",
    postureTitle: "Bezpečnostné skóre sa pripravuje",
    postureBody:
      "Kompozitné skóre 0–100 naprieč dimenziami prístup, konektory, pokrytie, reakcia a súlad. Príde v ďalšej fáze a zobrazí sa tu s úplným rozpisom a trendom.",
    soon: "Čoskoro",
    active: "Dostupné",
    modulesTitle: "Moduly",
    open: "Otvoriť",
    score: { title: "Bezpečnostné skóre", body: "Kompozitná situácia naprieč prístupom, konektormi, pokrytím, reakciou a súladom." },
    detections: { title: "Detekcia prevzatia účtu", body: "Signály možného prevzatia účtu — nikdy nie potvrdené tvrdenie. Pred akoukoľvek akciou posúdi človek." },
    brand: { title: "Ochrana značky", body: "Prípady impersonácie, squattingu prezývok a phishingu zo schválených signálov — bez scrapingu." },
    incidents: { title: "Centrum incidentov", body: "Celý životný cyklus bezpečnostných incidentov, rozširuje vaše existujúce incidenty.", cta: "Otvoriť incidenty" },
    stats: { score: "Bezpečnostné skóre", detections: "Otvorené detekcie", incidents: "Otvorené incidenty", accounts: "Rizikové účty" },
    pending: "Čaká sa",
    detectOnly: "Iba detekcia a reakcia — žiadne nové právomoci meniť platformu.",
  },
  de: {
    eyebrow: "Sicherheit",
    title: "Security Center",
    description:
      "Ihre Sicherheitslage an einem Ort — Score, Signale möglicher Kontoübernahme, Markenmissbrauchsfälle und Vorfälle. Nur Erkennung und Reaktion; Tamanor führt nie selbst eine Plattformaktion aus.",
    postureTitle: "Security Score wird eingerichtet",
    postureBody:
      "Ein zusammengesetzter 0–100-Score über die Dimensionen Zugriff, Konnektoren, Abdeckung, Reaktion und Compliance. Er kommt in der nächsten Phase und erscheint hier mit vollständiger Aufschlüsselung und Trend.",
    soon: "Demnächst",
    active: "Verfügbar",
    modulesTitle: "Module",
    open: "Öffnen",
    score: { title: "Security Score", body: "Zusammengesetzte Lage über Zugriff, Konnektoren, Abdeckung, Reaktion und Compliance." },
    detections: { title: "Kontoübernahme-Erkennung", body: "Signale einer möglichen Kontoübernahme — nie eine bestätigte Behauptung. Vor jeder Aktion von einem Menschen geprüft." },
    brand: { title: "Markenschutz", body: "Fälle von Identitätsmissbrauch, Handle-Squatting und Phishing aus zulässigen Signalen — kein Scraping." },
    incidents: { title: "Incident Center", body: "Der vollständige Lebenszyklus für Sicherheitsvorfälle, erweitert Ihre bestehenden Vorfälle.", cta: "Vorfälle öffnen" },
    stats: { score: "Security Score", detections: "Offene Erkennungen", incidents: "Offene Vorfälle", accounts: "Gefährdete Konten" },
    pending: "Ausstehend",
    detectOnly: "Nur Erkennung und Reaktion — keine neue Plattform-Mutationsbefugnis.",
  },
};

function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default async function SecurityCenterPage() {
  const locale = await getLocale();
  // Two independent gates, checked in order so each denial gets its OWN truthful
  // state and no tenant content ever renders on a denial:
  //   (1) RBAC — security:view is required. A role without it (e.g. Viewer) gets
  //       a clean access-denied state (not an HTTP 500 thrown error), on any plan.
  //   (2) Plan entitlement — a role WITH permission but a plan WITHOUT the suite
  //       gets the truthful CapabilityLockedState (upgrade), not access-denied.
  const session = await requireVerifiedSession();
  if (!can(session.role, Permission.SecurityView)) {
    return <AccessDeniedState locale={locale} />;
  }
  const cap = await requireDashboardCapability("securitySuite");
  if (!cap.allowed) {
    return <CapabilityLockedState capability={cap.locked.capability} plan={cap.locked.plan} locale={locale} />;
  }
  const t = COPY[locale];

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} />

      {/* Posture stat row — honest placeholders (no fake numbers) until S1–S3. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.stats.score} value="—" hint={t.pending} tone="brand" icon={<IconShield />} />
        <StatCard label={t.stats.detections} value="—" hint={t.pending} tone="neutral" />
        <StatCard label={t.stats.incidents} value="—" hint={t.pending} tone="neutral" />
        <StatCard label={t.stats.accounts} value="—" hint={t.pending} tone="neutral" />
      </div>

      {/* Security Score set-up notice. */}
      <div className="mt-6">
        <Card>
          <div className="flex items-start gap-4">
            <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
              <IconShield />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{t.postureTitle}</h2>
                <Badge tone="brand">{t.soon}</Badge>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-muted)]">{t.postureBody}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Module tiles. Incident Center links to the existing incidents surface. */}
      <div className="mt-8">
        <SectionHeader title={t.modulesTitle} description={t.detectOnly} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ModuleTile title={t.score.title} body={t.score.body} badge={t.soon} tone="brand" />
          <ModuleTile title={t.detections.title} body={t.detections.body} badge={t.soon} tone="warn" />
          <ModuleTile title={t.brand.title} body={t.brand.body} badge={t.soon} tone="neutral" />
          <ModuleTile
            title={t.incidents.title}
            body={t.incidents.body}
            badge={t.active}
            tone="ok"
            action={
              <Link href="/dashboard/incidents" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">
                {t.incidents.cta} →
              </Link>
            }
          />
        </div>
      </div>
    </>
  );
}

function ModuleTile({
  title,
  body,
  badge,
  tone,
  action,
}: {
  title: string;
  body: string;
  badge: string;
  tone: "brand" | "warn" | "ok" | "neutral";
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-muted)]">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}
