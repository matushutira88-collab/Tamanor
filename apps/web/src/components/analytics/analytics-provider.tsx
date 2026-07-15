"use client";
/**
 * V1.53 — loads the analytics providers and wires Consent Mode v2. Renders NOTHING unless a provider
 * id is configured in production, so the app ships zero third-party code until launch. Order that
 * matters is enforced via the dataLayer queue: `consent default` (all denied) is pushed before any
 * `config`, so no cookie is written until the visitor grants consent. SPA `page_view` is sent on
 * initial load and every client route change — but, like all events, only after consent.
 */
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  GTAG_ENABLED, GA4_ENABLED, GOOGLE_ADS_ENABLED, GA_MEASUREMENT_ID, GOOGLE_ADS_ID,
  META_PIXEL_ENABLED, META_PIXEL_ID,
} from "@/lib/analytics/config";
import { getStoredConsent, applyProviderConsent } from "@/lib/analytics/consent";
import { trackPageView } from "@/lib/analytics/track";

export function AnalyticsProvider() {
  const pathname = usePathname();

  // Re-apply a previously-stored consent choice on load (a returning consented visitor is tracked).
  useEffect(() => {
    const stored = getStoredConsent();
    if (stored) applyProviderConsent(stored === "granted");
  }, []);

  // SPA page_view on initial mount + every route change (no-op until consent is granted).
  useEffect(() => {
    if (pathname) trackPageView(pathname);
  }, [pathname]);

  const gtagSrcId = GA_MEASUREMENT_ID || GOOGLE_ADS_ID;

  return (
    <>
      {GTAG_ENABLED ? (
        <>
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied','wait_for_update':500});
gtag('js',new Date());
${GA4_ENABLED ? `gtag('config','${GA_MEASUREMENT_ID}',{'send_page_view':false});` : ""}
${GOOGLE_ADS_ENABLED ? `gtag('config','${GOOGLE_ADS_ID}');` : ""}`}
          </Script>
          <Script id="gtag-js" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${gtagSrcId}`} />
        </>
      ) : null}

      {META_PIXEL_ENABLED ? (
        <Script id="meta-pixel-init" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('consent','revoke');
fbq('init','${META_PIXEL_ID}');`}
        </Script>
      ) : null}
    </>
  );
}
