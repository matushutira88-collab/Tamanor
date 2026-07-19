"use client";

import { useEffect, useRef } from "react";
import { reportClientError, computeReferenceId, newClientReference } from "@/lib/client-diagnostics";

/**
 * Root error boundary — the last line of defense. It REPLACES the root layout, so it
 * ships its own <html>/<body> and inline styles (globals.css may not be present here).
 * It NEVER shows the raw error message, stack, digest internals, DB role or any secret —
 * only a safe message + a correlation id the user can quote to support.
 *
 * V1.63 — the reference id is pinned ONCE via useRef (stable across re-renders and until reset), and a
 * safe report is sent to the diagnostics sink on mount (deduped). "Try again" (reset) never changes the
 * id for the current error.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = computeReferenceId(error.digest, undefined, newClientReference());
  const correlationId = idRef.current;
  useEffect(() => {
    reportClientError({
      referenceId: correlationId, boundary: "global",
      route: typeof window !== "undefined" ? window.location.pathname : "/",
      errorName: error.name, safeMessage: error.message, digest: error.digest,
    });
  }, [correlationId, error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0f14", color: "#e6edf3", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
            <p style={{ color: "#9aa7b4", marginTop: 12 }}>
              An unexpected error occurred. Nothing sensitive was exposed. You can retry, or contact support with the id below.
            </p>
            <p style={{ color: "#6b7887", fontSize: 13, marginTop: 8 }}>
              Reference: <code>{correlationId}</code>
            </p>
            <div style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => reset()}
                style={{ background: "#19c39a", color: "#04120e", border: 0, borderRadius: 12, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
              >
                Try again
              </button>
              <a
                href="/contact"
                style={{ border: "1px solid #2a3441", color: "#e6edf3", borderRadius: 12, padding: "10px 20px", fontWeight: 600, textDecoration: "none" }}
              >
                Contact support
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
