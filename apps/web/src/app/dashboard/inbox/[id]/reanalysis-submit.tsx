"use client";

import { useFormStatus } from "react-dom";

export function ReanalysisSubmit({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      disabled={status.pending}
      aria-disabled={status.pending}
      className="rounded-lg border border-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand)] transition hover:bg-[var(--color-surface-2)] disabled:cursor-wait disabled:opacity-60"
    >
      {status.pending ? pending : idle}
    </button>
  );
}
