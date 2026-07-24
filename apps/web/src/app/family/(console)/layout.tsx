import { Suspense } from "react";
import { requireFamilyConsole } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { FamilyShell } from "../family-shell";
import { FamilyToaster } from "../family-feedback";
import { familyDict } from "../family-i18n";

export const dynamic = "force-dynamic";

/**
 * CS-C6 — Family console layout (route group, URL stays `/family/*`). Requires a FAMILY session with
 * COMPLETED onboarding (incomplete → the onboarding wizard) and renders the Family app shell.
 */
export default async function FamilyConsoleLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  return (
    <FamilyShell nav={t.nav} shell={t.shell} brand={t.brand} workspaceName={session.tenantName} userName={session.userName}>
      {children}
      {/* Success feedback for every Family server action, mounted once for the whole console.
          Suspense is required because the toaster reads the redirect's search params. */}
      <Suspense fallback={null}>
        <FamilyToaster strings={t.feedback} />
      </Suspense>
    </FamilyShell>
  );
}
