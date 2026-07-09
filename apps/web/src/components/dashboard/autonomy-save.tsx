"use client";

/**
 * Submit button for an Autonomy Matrix row. If the row's mode select is set to
 * "autonomous", it asks for explicit confirmation before submitting — Guardora
 * never enables autonomous action without a deliberate confirm.
 */
export function AutonomySave({ label, confirmText }: { label: string; confirmText: string }) {
  return (
    <button
      type="submit"
      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]"
      onClick={(e) => {
        const form = e.currentTarget.form;
        const mode = form?.querySelector<HTMLSelectElement>('select[name="mode"]')?.value;
        if (mode === "autonomous" && !window.confirm(confirmText)) {
          e.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
