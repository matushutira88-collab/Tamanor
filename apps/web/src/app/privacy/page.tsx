import type { Metadata } from "next";
import { MarketingPage, Section, Bullets, DraftNote } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Privacy — Guardora.ai",
  description:
    "How Guardora.ai handles data: what we process, why, and the choices you have. Early-product privacy wording.",
};

export default async function PrivacyPage() {
  const _lp = await getTL();
  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale}
      eyebrow="Legal"
      title="Privacy"
      subtitle="How Guardora handles data — described plainly."
    >
      <DraftNote />

      <Section title="What we process">
        <p>
          To provide the service, Guardora processes public content you connect
          via official platform integrations (for example, comments and reviews),
          basic authorship metadata provided by those platforms, and the
          moderation state you create inside Guardora. We also process account
          information for the people who use the product.
        </p>
      </Section>

      <Section title="What we do not do">
        <Bullets
          items={[
            "We do not scrape platforms.",
            "We do not ask for or store your social passwords.",
            "We do not sell your data.",
            "We do not display or log access tokens.",
          ]}
        />
      </Section>

      <Section title="Why we process it">
        <p>
          We process data to detect reputational risk, prepare proposed actions
          for human review, and maintain an audit trail. Processing is limited to
          what is needed to operate the product for your workspace.
        </p>
      </Section>

      <Section title="Retention & your choices">
        <p>
          You can disconnect a platform at any time, which stops further syncing
          for that account. Data deletion, export and retention controls are part
          of our roadmap and will be documented before general availability.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy? Email{" "}
          <a className="text-[var(--color-brand)] hover:underline" href="mailto:privacy@guardora.ai">
            privacy@guardora.ai
          </a>
          .
        </p>
      </Section>
    </MarketingPage>
  );
}
