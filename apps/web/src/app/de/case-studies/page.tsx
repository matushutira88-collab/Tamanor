import type { Metadata } from "next";
import { CaseStudiesContent } from "@/components/case-studies-content";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

const dict = getDictionary("de");

export const metadata: Metadata = {
  title: dict.meta.caseStudiesTitle,
  description: dict.meta.caseStudiesDescription,
  alternates: marketingAlternates("/case-studies", "de"),
};

export default function CaseStudiesPageDe() {
  return <CaseStudiesContent dict={dict} locale="de" />;
}
