import type { Metadata } from "next";
import { MarketingPage, LegalBody } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { informationSecurity } from "@/content/legal-compliance";

export async function generateMetadata(): Promise<Metadata> {
  const doc = informationSecurity[await getLocale()];
  return { title: doc.metaTitle, description: doc.metaDescription, alternates: { canonical: "/information-security" } };
}

export default async function Page() {
  const _lp = await getTL();
  const doc = informationSecurity[_lp.locale];
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
