"use client";

import Script from "next/script";

/**
 * V1.58.9 — Cloudflare Turnstile widget. Renders the challenge and injects a hidden `cf-turnstile-response`
 * token into the surrounding <form>, which the server action verifies against Cloudflare's siteverify (the
 * token alone is never trusted). The site key is PUBLIC; the secret lives only on the server. Privacy-
 * friendly (no image-labelling CAPTCHA).
 */
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  return (
    <div className="mt-4">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-appearance="interaction-only" />
    </div>
  );
}
