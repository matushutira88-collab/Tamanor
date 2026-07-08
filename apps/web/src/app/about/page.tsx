import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section } from "@/components/marketing-page";

export const metadata: Metadata = {
  title: "About — Guardora.ai",
  description:
    "Guardora.ai is an AI Reputation Firewall that helps modern brands protect their reputation across social media, comments and reviews.",
};

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title="An AI Reputation Firewall for modern brands."
      subtitle="Guardora helps brands protect their reputation across social media, comments and reviews — with AI speed and human control."
    >
      <Section title="Why Guardora">
        <p>
          Public feedback moves fast. A single harmful comment, scam or
          coordinated attack can damage trust before a team even notices.
          Guardora brings comments, reviews and mentions from every public
          channel into one place, detects risk, and prepares safe actions — while
          keeping humans firmly in control.
        </p>
      </Section>

      <Section title="Our approach">
        <p>
          We believe reputation tooling should be powerful and safe. That means
          official integrations only, no scraping, no shortcuts around a
          platform&rsquo;s rules, and an approval workflow so nothing sensitive
          happens automatically. Speed from AI, accountability from people.
        </p>
      </Section>

      <Section title="Where we are">
        <p>
          Guardora is an early-stage product being built in the open with its
          first design partners. If that sounds like your team, we&rsquo;d love
          to talk.
        </p>
        <p>
          <Link href="/book-demo" className="text-[var(--color-brand)] hover:underline">
            Book a demo
          </Link>{" "}
          or reach us at{" "}
          <a href="mailto:hello@guardora.ai" className="text-[var(--color-brand)] hover:underline">
            hello@guardora.ai
          </a>
          .
        </p>
      </Section>
    </MarketingPage>
  );
}
