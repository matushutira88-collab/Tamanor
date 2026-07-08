import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage } from "@/components/marketing-page";
import { IllusShield, IllusNetwork, IllusChart, IllusApproval } from "@/components/illustrations";

export const metadata: Metadata = {
  title: "Example scenarios — Guardora.ai",
  description:
    "Illustrative demo scenarios showing how Guardora protects brand reputation. Example scenarios only — not real customers.",
};

const CASES = [
  {
    tag: "Real estate brand",
    icon: <IllusShield size={72} />,
    problem: "Negative comments, fake or scam offers in the replies, and reputation risk on high-value listings.",
    solution: "A centralized reputation inbox across pages, AI risk scoring for every comment, and an approval workflow for anything sensitive.",
    outcome: "The team sees risk in one place and stays in control of every response — nothing acts on its own.",
  },
  {
    tag: "E-commerce brand",
    icon: <IllusNetwork size={72} />,
    problem: "Spam and scam links under product posts, plus a steady stream of customer complaints.",
    solution: "Automatic risk detection separates spam from genuine complaints, drafts safe suggested replies, and records an audit trail.",
    outcome: "Faster triage and a clearer picture of what customers actually care about.",
  },
  {
    tag: "Public institution",
    icon: <IllusApproval size={72} />,
    problem: "Misinformation and crisis comments that need careful, accountable handling.",
    solution: "An escalation workflow routes sensitive items to a human, with a complete audit log and approval before any action.",
    outcome: "Better oversight and control during sensitive moments — with a record of who decided what, and why.",
  },
  {
    tag: "Agency",
    icon: <IllusChart size={72} />,
    problem: "Many client brands and profiles to monitor across different platforms.",
    solution: "Multi-brand, multi-platform monitoring with per-brand rules and reports in a single workspace.",
    outcome: "One place to watch every brand and channel, instead of jumping between tools.",
  },
];

export default function CaseStudiesPage() {
  return (
    <MarketingPage
      eyebrow="Example scenarios"
      title="How brands could use Guardora."
      subtitle="Illustrative demo scenarios — not real customers, and no real numbers. They show the shape of the workflow, not a guarantee of results."
    >
      <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
        Example scenarios · illustrative only
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {CASES.map((c) => (
          <article key={c.tag} className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7">
            <div className="flex items-center gap-4">
              <span className="text-[var(--color-brand)]">{c.icon}</span>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-brand)]">Example</span>
                <h3 className="text-xl font-semibold">{c.tag}</h3>
              </div>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">Problem</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.problem}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">How Guardora helps</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.solution}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-fg)]">Outcome</dt>
                <dd className="mt-1 text-[var(--color-muted)]">{c.outcome}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 text-center">
        <p className="text-sm text-[var(--color-muted)]">
          These are example scenarios for illustration. Guardora is read-only by
          default, keeps humans in control of sensitive actions, and uses official
          OAuth/API connectors only — no scraping, no shared passwords.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link href="/book-demo" className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]">
            Book a demo
          </Link>
          <Link href="/login" className="rounded-xl border border-[var(--color-border-strong)] px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-surface-2)]">
            Start free trial
          </Link>
        </div>
      </div>
    </MarketingPage>
  );
}
