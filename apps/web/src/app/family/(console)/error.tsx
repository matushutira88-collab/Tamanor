"use client";
import { FamilyErrorBoundary } from "../family-error";
// CS-C6.1 — Family console route-level error boundary (safe, localized, no stack/PII/tenant).
export default function FamilyConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FamilyErrorBoundary error={error} reset={reset} boundary="family-console" />;
}
