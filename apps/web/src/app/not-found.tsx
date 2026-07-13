import Link from "next/link";
import { SAFE_ERRORS } from "@/lib/errors";

export default function NotFound() {
  const e = SAFE_ERRORS.not_found;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-fg)]">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">404</p>
        <h1 className="mt-2 text-2xl font-semibold">{e.title}</h1>
        <p className="mt-3 text-[var(--color-muted)]">{e.message}</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{e.remediation}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)]">
            Go home
          </Link>
          <Link href="/contact" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold">
            Contact support
          </Link>
        </div>
      </div>
    </main>
  );
}
