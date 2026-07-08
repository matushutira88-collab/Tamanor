import Link from "next/link";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Inbox", href: "/login" },
      { label: "Approvals", href: "/login" },
      { label: "Insights", href: "/login" },
      { label: "Reports", href: "/login" },
      { label: "Audit Log", href: "/login" },
    ],
  },
  {
    title: "Platforms",
    links: [
      { label: "Facebook", href: "/#platforms" },
      { label: "Instagram", href: "/#platforms" },
      { label: "YouTube", href: "/#platforms" },
      { label: "LinkedIn", href: "/#platforms" },
      { label: "TikTok", href: "/#platforms" },
      { label: "Google", href: "/#platforms" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Security", href: "/security" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <span className="text-lg font-semibold">
              Guardora<span className="text-[var(--color-brand)]">.ai</span>
            </span>
            <p className="mt-3 max-w-xs text-sm text-[var(--color-muted)]">
              AI Reputation Firewall. Protect your brand across social media,
              comments and reviews.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/login"
                className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]"
              >
                Start free trial
              </Link>
              <Link
                href="/book-demo"
                className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--color-surface-2)]"
              >
                Book a demo
              </Link>
            </div>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className="text-sm font-semibold">{c.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="transition hover:text-[var(--color-fg)]">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-muted)] md:flex-row">
          <span>© {new Date().getFullYear()} Guardora.ai — AI Reputation Firewall for modern brands</span>
          <span>Read-only by default · Official OAuth only · No scraping</span>
        </div>
      </div>
    </footer>
  );
}
