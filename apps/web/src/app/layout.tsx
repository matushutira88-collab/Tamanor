import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { JsonLd } from "@/components/json-ld";
import { CookieConsent } from "@/components/cookie-consent";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { AnalyticsMarker } from "@/components/analytics/analytics-marker";
import { organizationLd, websiteLd, softwareApplicationLd } from "@/lib/jsonld";

/**
 * V1.62 — ONE warm humanist typeface across the entire product (landing, marketing,
 * app). Plus Jakarta Sans (latin + latin-ext for SK/DE diacritics). The single
 * `--font-app` variable is aliased in globals.css to every legacy font token
 * (--font-serif-src / --font-disp-v2 / --font-sans-v2 / --font-mono-v2), so the old
 * serif + terminal-mono references all render in this one friendly font.
 */
const appFont = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-app",
  display: "swap",
});

const TITLE = "Tamanor — European reputation-security platform for social accounts";
const DESCRIPTION =
  "Tamanor helps organisations detect reputation risk, protect connected social accounts and coordinate trusted, auditable responses across markets, teams and platforms — with humans in control of automation. Built around European privacy and governance.";

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
    <html lang="en" className={appFont.variable}>
      <body>
        <JsonLd data={[organizationLd(), websiteLd(), softwareApplicationLd()]} />
        <AnalyticsProvider />
        <AnalyticsMarker />
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
