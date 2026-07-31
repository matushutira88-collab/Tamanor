import type { Metadata } from "next";
import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess } from "@/server/platform/guard";
import { PlatformRole } from "@guardora/db";
import { ADMIN_COPY } from "../admin-i18n";
import { Unauthorized } from "../unauthorized";
import { loadCutoverView } from "@/server/platform/provider-credential-cutover-dispatch";
import { CutoverPanel } from "./cutover-panel";

/**
 * TEMPORARY owner-only Vercel-runtime provider-credential cutover console. Runs the bounded legacy→vault migration
 * INSIDE Vercel Production (the only runtime holding both the legacy TOKEN_ENCRYPTION_KEY and the vault KEK).
 *
 * REMOVAL CHECKLIST (delete once the cutover is complete and legacyPopulated === 0 in production):
 *   - this page + ./cutover-panel.tsx
 *   - apps/web/src/app/api/platform/provider-credential-cutover/route.ts
 *   - apps/web/src/server/platform/provider-credential-cutover-dispatch.ts
 *   - the "provider_credential.cutover_*" audit actions may stay (immutable audit history)
 *   - keep packages/db/src/provider-credential-* (the vault + backfill remain the canonical path)
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";
export const metadata: Metadata = { title: "Provider credential cutover", robots: { index: false, follow: false } };

export default async function ProviderCredentialCutoverPage() {
  const t = ADMIN_COPY[await getLocale()];
  // OWNER-only (not merely admin). Fresh role from DB; non-owner gets the non-revealing denial.
  const platform = await requirePlatformAccess("admin.access");
  if (!platform || platform.role !== PlatformRole.owner) return <Unauthorized t={t} />;

  const { readiness, inventory } = await loadCutoverView();
  const inv = inventory;
  const row = (k: string, v: number | string | boolean) => (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-1 last:border-0">
      <span className="text-[var(--color-muted)]">{k}</span><span className="font-mono">{String(v)}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="🔐" title="Provider credential cutover" description="Temporary owner-only tool. Runs the bounded legacy→vault credential migration inside the Vercel Production runtime. No provider/network call is ever made." />

      <Card className="p-3 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={readiness.ready ? "success" : "warning"}>{readiness.ready ? "runtime ready" : "runtime not ready"}</Badge>
          <span className="text-[var(--color-muted)]">deployment {readiness.deploymentSha ?? "n/a"} · db {readiness.hostFingerprint ?? "n/a"}</span>
        </div>
        {!readiness.ready ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {[...readiness.envReasons, ...readiness.dbReasons].map((r) => (
              <li key={r}><span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 font-mono text-[11px]">{r}</span></li>
            ))}
          </ul>
        ) : <p className="text-[var(--color-muted)]">All runtime preconditions satisfied (Vercel production, legacy + vault keys present and distinct, migration applied).</p>}
      </Card>

      <Card className="p-3 text-xs">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Inventory (counts only)</p>
        {row("total Meta accounts", inv.totalMetaAccounts)}
        {row("legacy token populated", inv.legacyPopulated)}
        {row("with active vault", inv.withActiveVault)}
        {row("legacy + vault", inv.legacyAndVault)}
        {row("legacy only", inv.legacyOnly)}
        {row("vault only", inv.vaultOnly)}
        {row("neither", inv.neither)}
        {row("legacy matches vault", inv.legacyMatchesVault)}
        {row("corrupt vault", inv.corruptVault)}
        {row("vault-only unusable", inv.vaultOnlyUnusable)}
        {row("capped", inv.capped)}
      </Card>

      <Card className="border-[var(--color-warning)] p-3 text-xs">
        ⚠️ Read-only inventory + a bounded (25/batch) cutover. No Meta/provider network call is made. Legacy columns are
        cleared only after the encrypted vault credential is verified. Apply is disabled when there are no legacy credentials.
      </Card>

      <CutoverPanel
        ready={readiness.ready}
        deploymentSha={readiness.deploymentSha}
        legacyPopulated={inv.legacyPopulated}
      />
    </div>
  );
}
