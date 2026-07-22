"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createFamilyGuardianInvitationAction, type CreateInvitationState } from "./actions";
import { isFamilyInvitationErrorCode } from "@/app/family/family-i18n";

type Option = { value: string; label: string };
type Strings = {
  invitedEmail: string; emailHint: string; familyRoleLabel: string; guardianRoleLabel: string; relationshipLabel: string; submit: string;
  linkTitle: string; linkWarning: string; copyLink: string; copied: string; copyAria: string; linkGoneHint: string; back: string; errorTitle: string; profileLabel: string;
};

/**
 * CS-C8 — create-invitation form + ONE-TIME link reveal. The raw token lives ONLY in this component's React
 * state after a successful create — never in the URL, a cookie, a log or the audit. On success the invite
 * link is shown once with a clear "we don't send this" warning + an accessible copy button (aria-live
 * feedback, no analytics/logging of the URL). Errors render as SAFE localized groups only.
 */
export function CreateInvitationForm({ profiles, familyRoles, guardianRoles, relationshipTypes, errorMessages, strings }: {
  profiles: Option[]; familyRoles: Option[]; guardianRoles: Option[]; relationshipTypes: Option[];
  errorMessages: Record<string, string>; strings: Strings;
}) {
  const [state, formAction, isPending] = useActionState<CreateInvitationState, FormData>(createFamilyGuardianInvitationAction, { status: "idle" });
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const field = "mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";
  const label = "block text-sm font-medium text-[var(--color-fg)]";

  if (state.status === "ok") {
    const link = origin ? `${origin}/invite/family/${state.token}` : `/invite/family/${state.token}`;
    const copy = async () => {
      try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
    };
    return (
      <div className="rounded-2xl border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-6">
        <h2 className="text-base font-semibold text-[var(--color-fg)]">{strings.linkTitle}</h2>
        <p className="mt-2 text-sm text-[var(--color-fg)]">{strings.linkWarning}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg)]">{link}</code>
          <button type="button" onClick={copy} aria-label={strings.copyAria} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{copied ? strings.copied : strings.copyLink}</button>
        </div>
        <p aria-live="polite" className="mt-2 text-xs text-[var(--color-muted)]">{copied ? strings.copied : strings.linkGoneHint}</p>
        <Link href="/family/invitations" className="mt-5 inline-block rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)]">{strings.back}</Link>
      </div>
    );
  }

  const errText = state.status === "error" && isFamilyInvitationErrorCode(state.error) ? (errorMessages[state.error] ?? errorMessages.retry_later ?? "") : null;

  return (
    <form action={formAction} className="space-y-4">
      {errText ? (
        <div role="alert" className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          <span className="font-medium">{strings.errorTitle}:</span> {errText}
        </div>
      ) : null}
      <div>
        <label htmlFor="protectedProfileId" className={label}>{strings.profileLabel}</label>
        <select id="protectedProfileId" name="protectedProfileId" required className={field} defaultValue="">
          <option value="" disabled>—</option>
          {profiles.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="invitedEmail" className={label}>{strings.invitedEmail}</label>
        <input id="invitedEmail" name="invitedEmail" type="email" required autoComplete="off" inputMode="email" aria-describedby="email-hint" className={field} />
        <p id="email-hint" className="mt-1 text-xs text-[var(--color-muted)]">{strings.emailHint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="intendedFamilyRole" className={label}>{strings.familyRoleLabel}</label>
          <select id="intendedFamilyRole" name="intendedFamilyRole" required className={field} defaultValue="guardian">
            {familyRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="intendedGuardianRole" className={label}>{strings.guardianRoleLabel}</label>
          <select id="intendedGuardianRole" name="intendedGuardianRole" required className={field} defaultValue="secondary">
            {guardianRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="intendedRelationshipType" className={label}>{strings.relationshipLabel}</label>
          <select id="intendedRelationshipType" name="intendedRelationshipType" required className={field} defaultValue="parent">
            {relationshipTypes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" disabled={isPending} className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] disabled:opacity-60">{strings.submit}</button>
    </form>
  );
}
