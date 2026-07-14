import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";
import { JsonLd } from "@/components/json-ld";
import { CookieConsent } from "@/components/cookie-consent";
import { organizationLd, websiteLd, softwareApplicationLd } from "@/lib/jsonld";

/** Display serif — high-contrast headings, per the Tamanor brand. */
const displaySerif = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif-src",
  display: "swap",
});

const TITLE = "Tamanor — Social Account Firewall";
const DESCRIPTION =
  "Tamanor protects social accounts from spam, scams, harmful comments and repeated risky behavior with self-service rules, reputation analytics and actor risk.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tamanor.com"),
  title: {
    default: TITLE,
    template: "%s",
  },
  description: DESCRIPTION,
  applicationName: "Tamanor",
  keywords: [
    "social account firewall",
    "reputation management",
    "AI moderation",
    "brand safety",
    "social media comments",
  ],
  openGraph: {
    type: "website",
    siteName: "Tamanor",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://tamanor.com",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/",
    types: { "application/atom+xml": "/feed.xml" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={displaySerif.variable}>
      <body>
        <JsonLd data={[organizationLd(), websiteLd(), softwareApplicationLd()]} />
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
