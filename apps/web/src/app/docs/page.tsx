import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";

export const metadata: Metadata = {
  title: "Documentation — Tamanor",
  description: "Getting started, connecting Facebook and Instagram, roles and permissions, webhooks and a security overview.",
  alternates: { canonical: "/docs" },
};

export default async function DocsIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="docs"
      title="Documentation"
      subtitle="Connect accounts and understand how Tamanor keeps you in control."
      dict={t}
      locale={locale}
    />
  );
}
