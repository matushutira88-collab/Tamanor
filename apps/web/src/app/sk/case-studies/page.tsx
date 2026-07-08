import type { Metadata } from "next";
import { CaseStudiesContent } from "@/components/case-studies-content";
import { getDictionary } from "@/i18n";
import { marketingAlternates } from "@/lib/seo";

const dict = getDictionary("sk");

export const metadata: Metadata = {
  title: dict.meta.caseStudiesTitle,
  description: dict.meta.caseStudiesDescription,
  alternates: marketingAlternates("/case-studies", "sk"),
};

export default function CaseStudiesPageSk() {
  return <CaseStudiesContent dict={dict} locale="sk" />;
}
