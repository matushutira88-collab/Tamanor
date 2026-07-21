import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { faqLd } from "@/lib/jsonld";

// V1.58D.4 — the "mission control" Landing V2 is the single landing across all locales
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
      {/* V1.72 (Release C1) — FAQPage structured data from the landing FAQ, so search + AI systems can
          extract answers to "does Tamanor delete comments?", "which platforms?", etc. as structured Q&A. */}
      <JsonLd data={[faqLd(dict.landingV2.faqs)]} />
      <LandingV2 copy={dict.landingV2} logIn={dict.common.logIn} locale="en" />
    </>
  );
}
