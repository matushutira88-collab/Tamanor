import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg),transparent_25%)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="text-[var(--color-fg)]">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-[var(--color-muted)] md:flex">
          <a href="#platforms" className="transition hover:text-[var(--color-fg)]">Platforms</a>
          <a href="#features" className="transition hover:text-[var(--color-fg)]">Features</a>
          <a href="#control" className="transition hover:text-[var(--color-fg)]">AI + Human</a>
          <a href="#safety" className="transition hover:text-[var(--color-fg)]">Security</a>
          <a href="#pricing" className="transition hover:text-[var(--color-fg)]">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/book-demo"
            className="hidden rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] sm:inline-block"
          >
            Book a demo
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] shadow-[0_0_24px_rgba(25,195,154,0.35)] transition hover:bg-[var(--color-brand-strong)]"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}
