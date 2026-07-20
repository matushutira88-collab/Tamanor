import Link from "next/link";
import { Role } from "@guardora/core";
import { getMetaConfig } from "@guardora/config";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { LanguageSwitcher } from "@/components/language-switcher";
import { OnboardingSettingsCard } from "@/components/dashboard/onboarding-settings-card";
import { loadOnboarding, resumeOnboarding, restartOnboarding } from "../onboarding-actions";
import { DangerZone } from "@/components/dashboard/danger-zone";
import { AccountDangerZone } from "@/components/dashboard/account-danger-zone";
import { requireSession } from "@/server/auth";
import { analyzeUserErasability } from "@guardora/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { getDictionary } from "@/i18n";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/settings");

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ danger?: string; account?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  // V1.45C2 — advisory sole-owner analysis for the account Danger Zone (the erasure service re-checks
  // atomically). Uses the authenticated user's OWN id; blockers are the user's own owned workspaces.
  const erasability = await analyzeUserErasability(session.userId);
  const hdrT = await getT();
  const meta = getMetaConfig();
  const locale = await getLocale();
  const t = getDictionary(locale);
  // V1.66 — this member's own onboarding, so Settings is a stable way back into the setup guide.
  const onboarding = await loadOnboarding(session.tenantId, session.userId);

  const sections = [
    {
      title: t.dash.brandProfile,
      body: t.dash.brandProfileBody,
      href: "/dashboard/brands",
      cta: t.dash.manageBrands,
      badge: null as null | { tone: string; text: string },
    },
    {
      title: t.dash.moderationRules,
      body: t.dash.moderationRulesBody,
      href: "/dashboard/rules",
      cta: t.dash.manageRules,
      badge: null,
    },
    {
      title: t.dash.automations,
      body: t.dash.automationsBody,
      href: "/dashboard/accounts",
      cta: t.dash.viewAccounts,
      badge: { tone: "ok", text: t.dash.actionsDisabled },
    },
    {
      title: t.dash.webhooks,
      body: t.dash.webhooksBody,
      href: "/dashboard/accounts",
      cta: t.dash.viewWebhookStatus,
      badge: meta.webhookVerifyToken ? { tone: "ok", text: t.dash.verifyTokenSet } : { tone: "warn", text: t.dash.notConfigured },
    },
    {
      title: t.dash.security,
      body: t.dash.securityBody,
      href: "/dashboard/audit",
      cta: t.dash.openAuditLog,
      badge: { tone: "brand", text: t.dash.oauthOnly },
    },
  ];

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t.common.language}</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.dash.languageHintClean}</p>
        </div>
        <LanguageSwitcher current={locale} variant="app" />
      </Card>

      {onboarding ? (
        <div className="mb-4">
          <OnboardingSettingsCard
            status={onboarding.status}
            copy={{
              settingsTitle: t.onboarding.settingsTitle, settingsBody: t.onboarding.settingsBody,
              continueSetup: t.onboarding.continueSetup, reopen: t.onboarding.reopen, restart: t.onboarding.restart,
              restartTitle: t.onboarding.restartTitle, restartBody: t.onboarding.restartBody,
              restartConfirm: t.onboarding.restartConfirm, cancel: t.onboarding.cancel,
              completedTitle: t.onboarding.completedBody,
            }}
            onResume={resumeOnboarding}
            onRestart={restartOnboarding}
          />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">{s.title}</h3>
              {s.badge ? <Badge tone={s.badge.tone}>{s.badge.text}</Badge> : null}
            </div>
            <p className="mt-1.5 flex-1 text-sm text-[var(--color-muted)]">{s.body}</p>
            <Link
              href={s.href}
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-medium transition hover:bg-[var(--color-surface-2)]"
            >
              {s.cta} →
            </Link>
          </Card>
        ))}
      </div>

      {/* V1.45C1 — Owner-only Danger Zone. Server authorization is authoritative; this gate only
          controls visibility. Admin/Analyst/Reviewer/Viewer never see it and are denied server-side. */}
      {session.role === Role.Owner ? (
        <DangerZone
          workspaceName={session.tenantName}
          showMismatch={sp?.danger === "mismatch"}
          copy={{
            title: t.dangerZone.title,
            deleteHeading: t.dangerZone.deleteHeading,
            description: t.dangerZone.description,
            credentialsNote: t.dangerZone.credentialsNote,
            providerNote: t.dangerZone.providerNote,
            backupsNote: t.dangerZone.backupsNote,
            confirmLabel: t.dangerZone.confirmLabel,
            confirmCheckbox: t.dangerZone.confirmCheckbox,
            button: t.dangerZone.button,
            mismatchNotice: t.dangerZone.mismatchNotice,
          }}
        />
      ) : null}

      {/* V1.45C2 — Account (global identity) Danger Zone. Visible to EVERY authenticated user; NO tenant
          role gates it. Server authorization (self-only) is authoritative; this is self-service. */}
      <AccountDangerZone
        email={session.userEmail}
        blockers={erasability.blockers}
        notice={sp?.account === "mismatch" ? "mismatch" : sp?.account === "owner" ? "owner" : null}
        copy={{
          title: t.accountDangerZone.title,
          deleteHeading: t.accountDangerZone.deleteHeading,
          description: t.accountDangerZone.description,
          historyNote: t.accountDangerZone.historyNote,
          workspaceNote: t.accountDangerZone.workspaceNote,
          soleOwnerHeading: t.accountDangerZone.soleOwnerHeading,
          soleOwnerNote: t.accountDangerZone.soleOwnerNote,
          soleOwnerDeleting: t.accountDangerZone.soleOwnerDeleting,
          confirmLabel: t.accountDangerZone.confirmLabel,
          confirmCheckbox: t.accountDangerZone.confirmCheckbox,
          button: t.accountDangerZone.button,
          mismatchNotice: t.accountDangerZone.mismatchNotice,
          blockedNotice: t.accountDangerZone.blockedNotice,
        }}
      />
    </>
  );
}
