import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { landingFaqs } from "@/components/landing-v2/faqs";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { faqLd } from "@/lib/jsonld";

const dict = getDictionary("sk");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "sk"),
};

export default function LandingPageSk() {
  return (
    <>
      <JsonLd data={[faqLd(landingFaqs("sk"))]} />
      <LandingV2 copy={dict.landingV2} logIn={dict.common.logIn} locale="sk" />
    </>
  );
}
