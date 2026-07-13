"use server";

import { redirect } from "next/navigation";
import { e2eSeamEnabled, e2eMutationDelayMs } from "@/lib/e2e-seam";

/**
 * V1.39C — a controlled, non-destructive mutation used ONLY by the double-submit browser
 * proof. It sleeps for a gated delay so the SubmitButton's disabled/pending window is
 * observable, then redirects. Fail-closed: refuses unless `E2E_TEST_MODE === "true"`.
 * It touches no business data.
 */
export async function e2eSlowMutation(): Promise<void> {
  if (!e2eSeamEnabled()) throw new Error("e2e seam disabled");
  await new Promise((r) => setTimeout(r, e2eMutationDelayMs()));
  redirect("/e2e/double-submit?done=1");
}
