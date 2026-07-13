import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";

export const metadata: Metadata = {
  title: "Features — Tamanor",
  description: "Comment monitoring, reputation analytics, actor risk, action queue, approval workflow, auto-protection, control center, unified inbox and AI risk detection.",
  alternates: { canonical: "/features" },
};

export default async function FeaturesIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="features"
      title="Features"
      subtitle="What Tamanor does to protect your social presence."
      dict={t}
      locale={locale}
    />
  );
}
