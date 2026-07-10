import type { Metadata } from "next";
import { MarketingPage, Section, DraftNote } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Terms — Tamanor",
  description:
    "The terms that govern use of Tamanor during its early-access period.",
};

export default async function TermsPage() {
  const _lp = await getTL();
  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow="Legal"
      title="Terms of Service"
      subtitle="The basics of using Tamanor during early access."
    >
      <DraftNote />

      <Section title="Using the service">
        <p>
          Tamanor is provided for legitimate brand reputation management. You
          agree to use it in compliance with the terms and policies of the
          platforms you connect, and with applicable law. You are responsible for
          the actions you approve inside Tamanor.
        </p>
      </Section>

      <Section title="Connected accounts">
        <p>
          You may only connect accounts you are authorized to manage. Connections
          use official OAuth and can be revoked by you at any time from the
          platform or from Tamanor.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Tamanor may not be used to harass, deceive, or evade platform rules.
          Tamanor operates in read-only mode by default and gates sensitive
          actions behind human approval; you agree not to attempt to circumvent
          these controls.
        </p>
      </Section>

      <Section title="Availability & changes">
        <p>
          During early access the service is provided &ldquo;as is&rdquo; and may
          change. We will give reasonable notice of material changes to these
          terms. Final terms will be published before general availability.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms? Email{" "}
          <a className="text-[var(--color-brand)] hover:underline" href="mailto:legal@guardora.ai">
            legal@guardora.ai
          </a>
          .
        </p>
      </Section>
    </MarketingPage>
  );
}
