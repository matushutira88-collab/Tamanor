"use client";

import { ConfirmDialog } from "@/app/family/confirm-dialog";
import { acceptFamilyInvitationAction, declineFamilyInvitationAction } from "./actions";

/**
 * CS-C8 — accept / decline controls. Both are explicit confirmations with a pending state (reusing the
 * accessible ConfirmDialog: role=dialog, aria-modal/labelledby/describedby, focus trap, Escape, no
 * window.confirm). The opaque token rides a hidden field; the acting identity is session-authoritative.
 */
export function AcceptDeclinePanel({ token, errorMessages, strings }: {
  token: string;
  errorMessages: Record<string, string>;
  strings: { accept: string; decline: string; acceptTitle: string; acceptBody: string; acceptConfirm: string; declineTitle: string; declineBody: string; declineConfirm: string; cancel: string; working: string; errorTitle: string };
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <ConfirmDialog
        action={acceptFamilyInvitationAction}
        hiddenName="token" hiddenValue={token}
        triggerLabel={strings.accept}
        triggerClassName="w-full rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-center text-sm font-semibold text-[var(--color-brand-fg)] sm:flex-1"
        title={strings.acceptTitle} body={strings.acceptBody} confirmLabel={strings.acceptConfirm}
        cancelLabel={strings.cancel} workingLabel={strings.working} errorTitle={strings.errorTitle} errorMessages={errorMessages}
      />
      <ConfirmDialog
        action={declineFamilyInvitationAction}
        hiddenName="token" hiddenValue={token}
        triggerLabel={strings.decline}
        triggerClassName="w-full rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-center text-sm font-semibold text-[var(--color-fg)] sm:flex-1"
        title={strings.declineTitle} body={strings.declineBody} confirmLabel={strings.declineConfirm}
        cancelLabel={strings.cancel} workingLabel={strings.working} errorTitle={strings.errorTitle} errorMessages={errorMessages} danger
      />
    </div>
  );
}
