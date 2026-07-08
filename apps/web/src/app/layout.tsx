import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";

/** Display serif — high-contrast headings, per Guardora brand (Canva mockup). */
const displaySerif = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif-src",
  display: "swap",
});

const TITLE = "Guardora.ai — AI Reputation Firewall for modern brands";
const DESCRIPTION =
  "Protect comments, reviews, and reputation across Facebook, Instagram, YouTube, LinkedIn, TikTok, and Google — from one unified inbox with an AI Risk Engine, human approval, and a full audit log.";

export const metadata: Metadata = {
  metadataBase: new URL("https://guardora.ai"),
  title: {
    default: TITLE,
    template: "%s",
  },
  description: DESCRIPTION,
  applicationName: "Guardora.ai",
  keywords: [
    "reputation management",
    "AI moderation",
    "brand safety",
    "social media comments",
    "review management",
  ],
  openGraph: {
    type: "website",
    siteName: "Guardora.ai",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://guardora.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={displaySerif.variable}>
      <body>{children}</body>
    </html>
  );
}
