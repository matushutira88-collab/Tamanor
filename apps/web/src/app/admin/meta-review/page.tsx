/**
 * META-EXTERNAL-ACCESS-V1 — platform-admin Meta App Review readiness report.
 *
 * Booleans and PUBLIC identifiers only. It renders no environment value, no app id, no secret, no verify
 * token and no URL containing one — only whether each item is configured, plus the public route paths this
 * deployment implements (which the operator publishes to Meta by hand anyway).
 *
 * It NEVER claims Meta approval. Business verification and Advanced Access are shown strictly as OPERATOR
 * ATTESTATIONS read from configuration flags, labelled as such, and default to false.
 *
 * Reuses the existing platform-admin surface and guard — no new admin system.
 */
import { getLocale } from "@/i18n/locale-server";
import { Card, PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePlatformAccess, platformCapsFor } from "@/server/platform/guard";
import {
  getMetaReviewReadiness,
  META_OAUTH_CALLBACK_PATH, META_WEBHOOK_CALLBACK_PATH,
  META_DATA_DELETION_CALLBACK_PATH, META_DEAUTHORIZE_CALLBACK_PATH,
  META_PRIVACY_POLICY_PATH, META_DELETION_INSTRUCTIONS_PATH,
} from "@guardora/config";
import { ADMIN_COPY } from "../admin-i18n";
import { Unauthorized } from "../unauthorized";

export const dynamic = "force-dynamic";

function Row({ label, ok, note, yes, no }: { label: string; ok: boolean; note?: string; yes: string; no: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] py-2 last:border-0">
      <span className="text-sm">
        {label}
        {note ? <code className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px]">{note}</code> : null}
      </span>
      <Badge tone={ok ? "ok" : "warn"}>{ok ? yes : no}</Badge>
    </li>
  );
}

export default async function MetaReviewReadinessPage() {
  const t = ADMIN_COPY[await getLocale()];
  const platform = await requirePlatformAccess("admin.access");
  if (!platform) return <Unauthorized t={t} />;
  // Reuse the existing system-health capability — no new permission system.
  if (!platformCapsFor(platform.role).systemHealth) return <Unauthorized t={t} />;

  const r = getMetaReviewReadiness();
  const m = t.metaReview;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="🛰️" title={m.title} description={m.desc} />
      <Card className="p-4 text-xs text-[var(--color-muted)]">⚠️ {m.note}</Card>

      <Card className="p-4">
        <ul className="space-y-0">
          <Row label={m.appCredentials} ok={r.appCredentialsConfigured} yes={m.yes} no={m.no} />
          <Row label={m.oauthCallback} ok={r.oauthCallbackConfigured} note={META_OAUTH_CALLBACK_PATH} yes={m.yes} no={m.no} />
          <Row label={m.webhookVerifyToken} ok={r.webhookVerifyTokenConfigured} note={META_WEBHOOK_CALLBACK_PATH} yes={m.yes} no={m.no} />
          <Row label={m.webhookSync} ok={r.webhookSyncEnabled} yes={m.yes} no={m.no} />
          {/* Route presence is a property of this build — these endpoints ship with the deployment. */}
          <Row label={m.privacyRoute} ok note={META_PRIVACY_POLICY_PATH} yes={m.yes} no={m.no} />
          <Row label={m.deletionInstructions} ok note={META_DELETION_INSTRUCTIONS_PATH} yes={m.yes} no={m.no} />
          <Row label={m.deletionRoute} ok note={META_DATA_DELETION_CALLBACK_PATH} yes={m.yes} no={m.no} />
          <Row label={m.deauthRoute} ok note={META_DEAUTHORIZE_CALLBACK_PATH} yes={m.yes} no={m.no} />
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">{m.scopes}</h2>
        <ul className="space-y-0">
          {r.scopes.map((s) => (
            <Row key={s.scope} label={s.scope} ok={s.configured} yes={m.yes} no={m.no} />
          ))}
          <Row label={m.scopesAll} ok={r.allRequiredScopesConfigured} yes={m.yes} no={m.no} />
        </ul>
      </Card>

      <Card className="p-4">
        <ul className="space-y-0">
          <Row label={m.businessVerification} ok={r.businessVerificationAttested} yes={m.yes} no={m.no} />
          <Row label={m.advancedAccess} ok={r.advancedAccessAttested} yes={m.yes} no={m.no} />
        </ul>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{m.attestationNote}</p>
      </Card>
    </div>
  );
}
