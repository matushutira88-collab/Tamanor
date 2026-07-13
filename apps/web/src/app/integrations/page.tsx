import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";

export const metadata: Metadata = {
  title: "Integrations — Tamanor",
  description: "Facebook Page protection and Instagram monitoring are live; Google Business review monitoring is a foundation; YouTube, LinkedIn and TikTok are planned.",
  alternates: { canonical: "/integrations" },
};

export default async function IntegrationsIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="integrations"
      title="Integrations"
      subtitle="The platforms Tamanor connects to — with honest status for each."
      dict={t}
      locale={locale}
    />
  );
}
