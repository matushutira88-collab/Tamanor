import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section, Bullets } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, collectionLd } from "@/lib/jsonld";
import { entriesIn, pathForEntry } from "@/content/knowledge";

export const metadata: Metadata = {
  title: "Security — Tamanor",
  description:
    "How Tamanor protects your accounts and data: official OAuth only, no scraping, no client passwords, approval workflow, audit log, and read-only by default.",
  alternates: { canonical: "/security" },
  openGraph: {
    title: "Security — Tamanor",
    description: "Official OAuth only, read-only by default, encrypted tokens, RLS tenant isolation, append-only audit.",
    url: "/security",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Security — Tamanor", description: "Safe by design." },
};

export default async function SecurityPage() {
  const _lp = await getTL();
  const securityPages = entriesIn("security");
  const ld = [
    breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Security", path: "/security" },
    ]),
    collectionLd("Tamanor Security Center", "/security", securityPages.map((e) => ({ name: e.title, path: pathForEntry(e) }))),
  ];
  return (
    <>
      <JsonLd data={ld} />
      <MarketingPage dict={_lp.t} locale={_lp.locale}
        eyebrow="Trust & safety"
        title="Safe by design."
        subtitle="Tamanor is built to protect your brand without ever putting your accounts or your customers at risk."
      >
        <Section title="Connections">
          <p>
            Tamanor connects to platforms exclusively through their official OAuth
            and API integrations. We never scrape, and we never ask for or store
            your social passwords.
          </p>
          <Bullets
            items={[
              "Official OAuth / API connectors only",
              "No scraping of any platform",
              "No client passwords — ever",
              "Read-only mode by default",
              "Platform capability checks before any action is offered",
            ]}
          />
        </Section>

        <Section title="Tokens">
          <p>
            Access tokens obtained through OAuth are stored server-side only. They
            are never shown in the interface, never written to logs, and never
            included in the audit trail. Our production architecture is designed
            for encrypted-at-rest token storage backed by a key management service.
          </p>
        </Section>

        <Section title="Actions & control">
          <p>
            Sensitive actions (reply, hide, delete) are approval-gated. AI can
            quickly classify and propose, but nothing is executed without an
            authorized human review, and every decision is recorded.
          </p>
          <Bullets
            items={[
              "Human approval workflow for sensitive actions",
              "Complete, append-only audit log",
              "Role-based permissions across the workspace",
              "No automatic execution of moderation actions",
            ]}
          />
        </Section>

        <Section title="Security topics">
          <p>Detailed, honest write-ups of Tamanor's security posture:</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {securityPages.map((e) => (
              <li key={e.slug}>
                <Link href={pathForEntry(e)} className="text-[var(--color-brand)] hover:underline">
                  {e.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Responsible disclosure">
          <p>
            If you believe you have found a security issue, please reach us through the{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/contact">
              contact page
            </Link>
            . A dedicated security mailbox is configurable before production and will be
            announced when live — we do not publish a placeholder address that is not
            monitored. See{" "}
            <Link className="text-[var(--color-brand)] hover:underline" href="/security/disclosure">
              security disclosure
            </Link>{" "}
            for details.
          </p>
        </Section>
      </MarketingPage>
    </>
  );
}
