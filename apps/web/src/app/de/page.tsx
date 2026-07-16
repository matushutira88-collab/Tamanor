import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

const dict = getDictionary("de");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "de"),
};

export default function LandingPageDe() {
  return <LandingV2 copy={dict.landingV2} startFree={dict.common.startFree} logIn={dict.common.logIn} footer={dict.footer} locale="de" />;
}
