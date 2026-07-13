import type { Metadata } from "next";
import { getTL } from "@/i18n/server";
import { SectionIndex } from "@/components/knowledge-view";

export const metadata: Metadata = {
  title: "Platform & architecture — Tamanor",
  description: "How Tamanor works: architecture, security, row-level security, audit, permissions, webhooks, worker, AI moderation, automation and roadmap.",
  alternates: { canonical: "/platform" },
};

export default async function PlatformIndex() {
  const { t, locale } = await getTL();
  return (
    <SectionIndex
      collection="platform"
      title="Platform & architecture"
      subtitle="How Tamanor works under the hood — and what it honestly does today."
      dict={t}
      locale={locale}
    />
  );
}
