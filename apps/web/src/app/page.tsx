import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/landing-v2";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

// V1.58D — homepage now renders the "mission control" landing v2. SEO metadata + hreflang
// alternates are preserved from the existing dictionary (unchanged). The old LandingContent
// stays in the repo and still serves /sk and /de until v2 i18n lands.
const dict = getDictionary("en");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "en"),
};

export default function LandingPage() {
  return <LandingV2 />;
}
