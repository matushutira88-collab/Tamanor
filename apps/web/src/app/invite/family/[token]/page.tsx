import type { Metadata } from "next";
import Link from "next/link";
import { getFamilyInvitationPreview, type FamilyInvitationTokenError } from "@guardora/db";
import { Logo } from "@/components/logo";
import { requireSession } from "@/server/auth";
import { getLocale } from "@/i18n/locale-server";
import { familyDict, famLabel } from "@/app/family/family-i18n";
import { AcceptDeclinePanel } from "./accept-panel";

export const metadata: Metadata = { title: "Family invitation — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C8 — the Family guardian invitation ACCEPT screen. Requires a signed-in session (login first). The
 * opaque token is resolved server-side by its hash; the invited email MUST match the session email. Only
 * CONTENT-FREE data is shown (guardian-chosen profile label, intended role/relationship, expiry, workspace
 * name) — never a tenant/membership/invitation id, the token, raw enums, audit metadata or child PII. The
 * raw token is never rendered back or logged.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <Logo />
      <div className="mt-8 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 text-left">{children}</div>
    </main>
  );
}

export default async function FamilyInviteAcceptPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const session = await requireSession();
  const { token } = await params;
  const sp = await searchParams;
  const t = familyDict(await getLocale());
  const c = t.c8;

  // Terminal confirmations (post accept/decline) — never re-resolve the (now spent) token.
  if (sp.outcome === "accepted") {
    return <Shell><h1 className="text-xl font-semibold text-[var(--color-fg)]">{c.acceptedTitle}</h1><p className="mt-3 text-sm text-[var(--color-muted)]">{c.acceptedBody}</p><Link href="/family" className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)]">{c.goToFamily}</Link></Shell>;
  }
  if (sp.outcome === "declined") {
    return <Shell><h1 className="text-xl font-semibold text-[var(--color-fg)]">{c.declinedTitle}</h1><p className="mt-3 text-sm text-[var(--color-muted)]">{c.declinedBody}</p></Shell>;
  }

  const preview = await getFamilyInvitationPreview(token, session.userId, session.userEmail);
  if (!preview.ok) {
    const messages: Record<FamilyInvitationTokenError, { title: string; body: string }> = {
      invalid_token: { title: c.acceptTitle, body: c.invalidLink },
      expired: { title: c.acceptTitle, body: c.expiredLink },
      revoked: { title: c.acceptTitle, body: c.revokedLink },
      already_accepted: { title: c.alreadyAcceptedTitle, body: c.acceptedBody },
      already_declined: { title: c.alreadyDeclinedTitle, body: c.declinedBody },
      identity_mismatch: { title: c.identityMismatchTitle, body: c.identityMismatchBody },
    };
    const m = messages[preview.reason];
    return <Shell><h1 className="text-xl font-semibold text-[var(--color-fg)]">{m.title}</h1><p className="mt-3 text-sm text-[var(--color-muted)]">{m.body}</p></Shell>;
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-[var(--color-fg)]">{c.acceptTitle}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{c.acceptIntro}</p>
      <dl className="mt-5 space-y-2 text-sm">
        {preview.workspaceName ? <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{t.settings.workspaceName}</dt><dd className="font-medium text-[var(--color-fg)]">{preview.workspaceName}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{c.forProfile}</dt><dd className="font-medium text-[var(--color-fg)]">{preview.profileLabel ?? famLabel(t.labels.ageBand, preview.ageBand)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{c.guardianRoleLabel}</dt><dd className="font-medium text-[var(--color-fg)]">{famLabel(t.c7.roles, preview.intendedGuardianRole)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{c.relationshipLabel}</dt><dd className="font-medium text-[var(--color-fg)]">{famLabel(t.labels.relationshipType, preview.intendedRelationshipType)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">{c.expiresOn}</dt><dd className="font-medium text-[var(--color-fg)]">{new Date(preview.expiresAt).toISOString().slice(0, 10)}</dd></div>
      </dl>
      <AcceptDeclinePanel
        token={token}
        errorMessages={c.errors}
        strings={{
          accept: c.accept, decline: c.decline,
          acceptTitle: c.acceptTitle, acceptBody: c.acceptIntro, acceptConfirm: c.accept,
          declineTitle: c.declineDialogTitle, declineBody: c.declineDialogBody, declineConfirm: c.declineDialogConfirm,
          cancel: t.dialog.cancel, working: t.dialog.working, errorTitle: t.dialog.errorTitle,
        }}
      />
    </Shell>
  );
}
