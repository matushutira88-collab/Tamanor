import { listSafetySignalDeliveries } from "@guardora/db";
import { FamilyAction, parseDisclosureScopes } from "@guardora/core";
import { requireFamilyConsole, familyCan } from "@/server/family-guard";
import { getLocale } from "@/i18n/locale-server";
import { PageHeader, Card, SectionHeader, Badge } from "@/components/dashboard/ui";
import { familyDict, famLabel } from "../../family-i18n";
import { makeSafetySignalDeliveryAvailableAction, acknowledgeSafetySignalDeliveryAction, declineSafetySignalDeliveryAction, revokeSafetySignalDeliveryAction, archiveSafetySignalDeliveryAction } from "./actions";

export const dynamic = "force-dynamic";
function fmt(d: Date | null): string { return d ? new Date(d).toISOString().slice(0, 10) : "—"; }

const ActBtn = ({ action, id, label, danger }: { action: (fd: FormData) => Promise<void>; id: string; label: string; danger?: boolean }) => (
  <form action={action}><input type="hidden" name="deliveryId" value={id} /><button type="submit" className={`rounded-md border border-[var(--color-border)] px-2 py-1 text-xs ${danger ? "text-[var(--color-danger)] hover:border-[var(--color-danger)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}>{label}</button></form>
);

export default async function FamilyDeliveriesPage() {
  const { actor } = await requireFamilyConsole();
  const t = familyDict(await getLocale());
  const canManage = familyCan(actor, FamilyAction.SafetyDeliveryCreate);
  const canRevoke = familyCan(actor, FamilyAction.SafetyDeliveryRevoke);
  const page = await listSafetySignalDeliveries(actor, { limit: 50 });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t.deliveries.title} description={t.privacy.delivery} />
      <Card>
        <SectionHeader title={t.deliveries.title} />
        {page.items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t.deliveries.emptyText}</p>
        ) : (
          <div className="space-y-2">
            {page.items.map((d) => {
              const scopes = parseDisclosureScopes(d.disclosureScope).scopes.map((s) => famLabel(t.labels.disclosureScope, s)).join(", ");
              return (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.deliveryStatus === "available" || d.deliveryStatus === "acknowledged" ? "ok" : d.deliveryStatus === "declined" || d.deliveryStatus === "revoked" ? "danger" : "neutral"}>{famLabel(t.labels.deliveryStatus, d.deliveryStatus)}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">{famLabel(t.labels.signalType, d.signalType)} · {scopes}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--color-muted)]">{t.deliveries.preparedAt}: {fmt(d.preparedAt)}</span>
                    {canManage && d.deliveryStatus === "prepared" ? <ActBtn action={makeSafetySignalDeliveryAvailableAction} id={d.id} label={t.deliveries.makeAvailable} /> : null}
                    {d.deliveryStatus === "available" ? <><ActBtn action={acknowledgeSafetySignalDeliveryAction} id={d.id} label={t.deliveries.acknowledge} /><ActBtn action={declineSafetySignalDeliveryAction} id={d.id} label={t.deliveries.decline} /></> : null}
                    {canRevoke && (d.deliveryStatus === "prepared" || d.deliveryStatus === "available") ? <ActBtn action={revokeSafetySignalDeliveryAction} id={d.id} label={t.deliveries.revoke} danger /> : null}
                    {canRevoke && d.deliveryStatus !== "archived" ? <ActBtn action={archiveSafetySignalDeliveryAction} id={d.id} label={t.deliveries.archive} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--color-muted)]">{t.deliveries.availableMeans}</p>
      </Card>
    </div>
  );
}
