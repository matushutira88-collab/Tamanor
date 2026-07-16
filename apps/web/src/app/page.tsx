import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

// V1.58D.4 — the "mission control" Landing V2 is the single landing across all locales
// (/, /sk, /de). SEO metadata + hreflang alternates preserved from the dictionary.
const dict = getDictionary("en");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "en"),
};

export default function LandingPage() {
  return <LandingV2 copy={dict.landingV2} startFree={dict.common.startFree} logIn={dict.common.logIn} footer={dict.footer} locale="en" />;
}
