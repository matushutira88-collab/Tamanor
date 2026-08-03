/**
 * META-EXTERNAL-ACCESS-V1 — PUBLIC status page for a Meta data-deletion request.
 *
 * This is the `url` returned by the data-deletion callback, so Meta and the person must be able to open it
 * with NO authentication. It is outside the middleware's `/dashboard/:path*` matcher and calls no session
 * helper, so it never redirects to login. The `code` query parameter is echoed back only after strict
 * validation (lowercase hex, bounded length) so a hostile URL cannot inject content; nothing is looked up by
 * it and no personal data is read or displayed.
 */
import type { Metadata } from "next";
import { MarketingPage, LegalBody } from "@/components/marketing-page";
import { getTL } from "@/i18n/server";
import { getLocale } from "@/i18n/locale-server";
import { metaDataDeletionStatus } from "@/content/meta-data-deletion";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const doc = metaDataDeletionStatus[await getLocale()];
  return {
    title: doc.metaTitle,
    description: doc.metaDescription,
    robots: { index: false, follow: false },
    alternates: { canonical: "/data-deletion" },
  };
}

/** Only a bounded lowercase-hex reference code is ever echoed back. Anything else is ignored entirely. */
function safeCode(raw: string | undefined): string | null {
  return typeof raw === "string" && /^[a-f0-9]{8,64}$/.test(raw) ? raw : null;
}

export default async function DataDeletionStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.code) ? sp.code[0] : sp.code;
  const code = safeCode(raw);
  const _lp = await getTL();
  const doc = metaDataDeletionStatus[_lp.locale];

  return (
    <MarketingPage dict={_lp.t} locale={_lp.locale} eyebrow={doc.eyebrow} title={doc.title} subtitle={doc.subtitle}>
      {code ? (
        <p className="mb-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 text-sm">
          <span className="text-[var(--color-muted)]">{doc.sections[0]?.title}</span>{" "}
          <code className="font-mono" data-testid="deletion-confirmation-code">{code}</code>
        </p>
      ) : null}
      <LegalBody doc={doc} />
    </MarketingPage>
  );
}
