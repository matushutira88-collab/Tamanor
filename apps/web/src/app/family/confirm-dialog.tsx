"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { FamilyActionState } from "@/server/family-safe-error";
import { isFamilyActionErrorCode } from "./family-i18n";

/**
 * CS-C6.1 — accessible confirmation dialog for a DESTRUCTIVE Family action. Explicit two-step intent, with
 * NO `window.confirm`. It renders a trigger button; activating it opens a modal (role="dialog",
 * aria-modal, labelled + described) that submits the server action via `useActionState`. The client sends
 * only the single opaque record id (never tenantId / membershipId / actor). On failure the action returns a
 * SAFE, serializable error GROUP (see family-safe-error) which is localized here — never a stack, message,
 * SQL/Prisma detail, id or PII. Focus is moved into the dialog on open, trapped while open, restored to the
 * trigger on close; Escape and backdrop cancel (both disabled while the action is pending).
 */
export function ConfirmDialog(props: {
  action: (prev: FamilyActionState, fd: FormData) => Promise<FamilyActionState>;
  hiddenName: string;
  hiddenValue: string;
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  workingLabel: string;
  errorTitle: string;
  errorMessages: Record<string, string>;
  danger?: boolean;
}) {
  const { action, hiddenName, hiddenValue, triggerLabel, triggerClassName, title, body, confirmLabel, cancelLabel, workingLabel, errorTitle, errorMessages, danger } = props;
  const [state, formAction, isPending] = useActionState<FamilyActionState, FormData>(action, { ok: true });
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const close = () => {
    if (isPending) return; // never dismiss mid-submit
    setOpen(false);
    triggerRef.current?.focus(); // restore focus to the trigger
  };

  // On open, move focus into the dialog (the confirm button).
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  // Keyboard: Escape cancels; Tab is trapped within the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const errorCode = state.ok === false ? state.error : null;
  const errorText = errorCode && isFamilyActionErrorCode(errorCode)
    ? (errorMessages[errorCode] ?? errorMessages.retry_later ?? "")
    : null;

  return (
    <div className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? `rounded-md border border-[var(--color-border)] px-2 py-1 text-xs ${danger ? "text-[var(--color-danger)] hover:border-[var(--color-danger)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
          {/* Backdrop — a click cancels (unless pending). */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
          >
            <h2 id={titleId} className="text-base font-semibold text-[var(--color-fg)]">{title}</h2>
            <p id={bodyId} className="mt-2 text-sm text-[var(--color-muted)]">{body}</p>

            {errorText ? (
              <div role="alert" className="mt-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
                <span className="font-medium">{errorTitle}:</span> {errorText}
              </div>
            ) : null}

            <form action={formAction} className="mt-6 flex justify-end gap-3">
              <input type="hidden" name={hiddenName} value={hiddenValue} />
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={isPending}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-[var(--color-danger)]" : "bg-[var(--color-brand)]"}`}
              >
                {isPending ? workingLabel : confirmLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
