import { listRecipientAuthorizationDecisions, FamilyForbiddenError } from "@guardora/db";
import { FamilyAction, parseDisclosureScopes } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";
import { ConfirmDialog } from "../../confirm-dialog";
import { revokeRecipientAuthorizationDecisionAction } from "./actions";

export const dynamic = "force-dynamic";
function fmt(d: Date | null): string { return d ? new Date(d).toISOString().slice(0, 10) : "—"; }

export default async function FamilyAuthorizationsPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const canRevoke = familyCan(actor, FamilyAction.SafetyRecipientAuthorizationRevoke);
  let page;
  try { page = await listRecipientAuthorizationDecisions(actor, { limit: 50 }); }
  catch (e) { if (e instanceof FamilyForbiddenError) return <NotAllowed t={t} />; throw e; }

  return (
    <div className="space-y-6">
      <PageHeader title={t.authorizations.title} description={t.guardians.intro} />
      <Card>
        <SectionHeader title={t.authorizations.title} />
        {page.items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.authorizations.emptyText}</p>
        ) : (
          <div className="space-y-2">
            {page.items.map((d) => {
              const scopes = parseDisclosureScopes(d.disclosureScope).scopes;
              const effective = d.decisionStatus === "authorized" && !d.revokedAt && !d.supersededAt;
              return (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={effective ? "ok" : d.decisionStatus === "denied" ? "danger" : "neutral"}>{famLabel(t.labels.decisionStatus, d.decisionStatus)}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.reasonCode, d.reasonCode)}</span>
                    {scopes.length > 0 && <span className="text-xs text-[var(--color-muted)]">· {scopes.map((s) => famLabel(t.labels.disclosureScope, s)).join(", ")}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--color-muted)]">{t.authorizations.evaluatedAt}: {fmt(d.evaluatedAt)}{d.validUntil ? ` · ${t.authorizations.validUntil}: ${fmt(d.validUntil)}` : ""}</span>
                    {canRevoke && effective ? (
                      <ConfirmDialog
                        action={revokeRecipientAuthorizationDecisionAction}
                        hiddenName="decisionId"
                        hiddenValue={d.id}
                        triggerLabel={t.authorizations.revoke}
                        title={t.dialog.revokeAuthTitle}
                        body={t.dialog.revokeAuthBody}
                        confirmLabel={t.dialog.revokeAuthConfirm}
                        cancelLabel={t.dialog.cancel}
                        workingLabel={t.dialog.working}
                        errorTitle={t.dialog.errorTitle}
                        errorMessages={t.actionErrors}
                        danger
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function NotAllowed({ t }: { t: ReturnType<typeof familyDict> }) {
  return <div><PageHeader title={t.authorizations.title} /><Card><p className="text-sm text-[var(--color-muted)]">{t.common.notAvailable}</p></Card></div>;
}
