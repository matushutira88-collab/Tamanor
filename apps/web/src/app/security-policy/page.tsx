import type { Metadata } from "next";
import { MarketingPage, LegalBody } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { securityPolicy } from "@/content/legal-compliance";

export async function generateMetadata(): Promise<Metadata> {
  const doc = securityPolicy[await getLocale()];
  return { title: doc.metaTitle, description: doc.metaDescription };
}

export default async function Page() {
  const _lp = await getTL();
  const doc = securityPolicy[_lp.locale];
  return (
    <MarketingPage
      dict={_lp.t}
      locale={_lp.locale}
      eyebrow={doc.eyebrow}
      title={doc.title}
      subtitle={doc.subtitle}
    >
      <LegalBody doc={doc} />
    </MarketingPage>
  );
}
