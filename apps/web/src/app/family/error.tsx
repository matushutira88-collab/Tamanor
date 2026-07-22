"use client";
import { FamilyErrorBoundary } from "./family-error";
// CS-C6.1 — /family route-level error boundary (safe, localized, no stack/PII/tenant).
export default function FamilyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FamilyErrorBoundary error={error} reset={reset} boundary="family" />;
}
