import { notFound } from "next/navigation";
import { e2eSeamEnabled } from "@/lib/e2e-seam";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { e2eSlowMutation } from "./actions";
import { ClientReady } from "./client-ready";

export const dynamic = "force-dynamic";

/**
 * V1.39C — TEST-ONLY page for the double-submit browser proof. Fail-closed: 404 unless
 * `E2E_TEST_MODE === "true"`. It hosts one real <SubmitButton/> (useFormStatus) bound to a
 * controlled slow mutation, so the E2E can prove a second submit is blocked while pending.
 */
export default async function DoubleSubmitTestPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  if (!e2eSeamEnabled()) notFound();
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <ClientReady />
      <h1 className="text-xl font-semibold">Double-submit test harness</h1>
      {sp.done ? <p data-testid="result" className="mt-3 text-[var(--color-ok)]">completed</p> : null}
      <form action={e2eSlowMutation} className="mt-6">
        <SubmitButton pendingLabel="Working…">Run mutation</SubmitButton>
      </form>
    </main>
  );
}
