import type { Metadata } from "next";
import { Playfair_Display, Sora, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { JsonLd } from "@/components/json-ld";
import { CookieConsent } from "@/components/cookie-consent";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { AnalyticsMarker } from "@/components/analytics/analytics-marker";
import { organizationLd, websiteLd, softwareApplicationLd } from "@/lib/jsonld";

/** Display serif — high-contrast headings, per the Tamanor brand. */
const displaySerif = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif-src",
  display: "swap",
});

/** V1.58D — landing v2 "mission control" fonts, exposed as CSS variables consumed by LandingV2. */
const dispV2 = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-disp-v2", display: "swap" });
const sansV2 = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans-v2", display: "swap" });
const monoV2 = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono-v2", display: "swap" });

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
    <html lang="en" className={`${displaySerif.variable} ${dispV2.variable} ${sansV2.variable} ${monoV2.variable}`}>
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
