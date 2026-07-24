import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { landingFaqs } from "@/components/landing-v2/faqs";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { faqLd } from "@/lib/jsonld";

// V1.58D.4 — the dual-product Landing V2 is the single landing across all locales
// (/, /sk, /de). SEO metadata + hreflang alternates preserved from the dictionary.
const dict = getDictionary("en");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "en"),
};

export default function LandingPage() {
  return (
    <>
      {/* FAQPage structured data — sourced from the SAME landing FAQ content the page renders,
          so search + AI systems extract exactly the Q&A a visitor sees. */}
      <JsonLd data={[faqLd(landingFaqs("en"))]} />
      <LandingV2 copy={dict.landingV2} logIn={dict.common.logIn} locale="en" />
    </>
  );
}
