import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * V1.72 (Release C1) — default social/AI preview card (OpenGraph + Twitter). A branded 1200×630 image
 * so shared/AI-answer cards are no longer blank. Self-contained (system fonts, inline styles — no
 * external asset, CSP-safe). Cascades to every public route that does not define its own image.
 */
export const runtime = "nodejs";
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", padding: "72px 80px",
          background: "linear-gradient(135deg, #0b1220 0%, #101a33 55%, #16224a 100%)",
          color: "#ffffff", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800 }}>T</div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 900 }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 30, color: "#9db2d9", lineHeight: 1.3, maxWidth: 940 }}>
            Detect reputation risk on Facebook &amp; Instagram — the AI proposes, your rules decide, a human approves. Built in the EU.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 24, color: "#7f96c4" }}>
          <span>tamanor.com</span>
          <span style={{ opacity: 0.5 }}>•</span>
          <span>European reputation-security platform</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
