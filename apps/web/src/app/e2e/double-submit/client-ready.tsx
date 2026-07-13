"use client";

import { useEffect } from "react";

/**
 * V1.39C — sets a deterministic hydration marker so the double-submit E2E clicks ONLY after
 * React has wired the form's client action (otherwise the form would native-submit and
 * useFormStatus could never engage). Test-only page; no effect elsewhere.
 */
export function ClientReady() {
  useEffect(() => {
    document.documentElement.setAttribute("data-e2e-hydrated", "1");
  }, []);
  return null;
}
