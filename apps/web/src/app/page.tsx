import type { Metadata } from "next";
import { LandingContent } from "@/components/landing/landing-content";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

const dict = getDictionary("en");

export const metadata: Metadata = {
  title: dict.meta.landingTitle,
  description: dict.meta.landingDescription,
  alternates: marketingAlternates("/", "en"),
};

export default function LandingPage() {
  return <LandingContent dict={dict} locale="en" />;
}
