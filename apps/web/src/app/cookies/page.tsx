import type { Metadata } from "next";
import { MarketingPage, LegalBody } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { cookiePolicy } from "@/content/legal";

export async function generateMetadata(): Promise<Metadata> {
  const doc = cookiePolicy[await getLocale()];
  return { title: doc.metaTitle, description: doc.metaDescription, alternates: { canonical: "/cookies" } };
}

export default async function CookiesPage() {
  const _lp = await getTL();
  const doc = cookiePolicy[_lp.locale];
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
