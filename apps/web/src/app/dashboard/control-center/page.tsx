import { Permission, can } from "@guardora/core";
import { CONTROL_CATEGORIES, CONTROL_MODES, NEVER_AUTONOMOUS } from "@guardora/ai";
import { getLiveActionsConfig } from "@guardora/config";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { AutonomySave } from "@/components/dashboard/autonomy-save";
import { updateControlPolicy, applyPreset } from "./actions";

export const dynamic = "force-dynamic";

export default async function ControlCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const session = await requireSession();
  const sp = await searchParams;
  const manage = can(session.role, Permission.RuleManage);
  const realMode = await getRealModeFilter(session.tenantId);

  const brands = await prisma.brand.findMany({
    where: { tenantId: session.tenantId, ...(realMode.isRealMode ? { id: { in: realMode.realBrandIds } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const policies = await prisma.controlPolicy.findMany({ where: { tenantId: session.tenantId } });
  const modeFor = (brandId: string, cat: string) => policies.find((p) => p.brandId === brandId && p.category === cat)?.mode ?? "monitor";
  const confFor = (brandId: string, cat: string) => policies.find((p) => p.brandId === brandId && p.category === cat)?.minConfidence ?? 0.8;

  return (
    <>
      <PageHeader eyebrow={t.cc.neverHideCriticism} title={t.cc.controlTitle} description={t.cc.controlSubtitle} />
      <Notice notice={sp.notice} kind={sp.kind} />

      {(() => {
        const live = getLiveActionsConfig();
        const label = live.canExecuteLive ? t.cc.gatesLive : (live.liveEnabled && live.facebookHideEnabled) ? t.cc.gatesDryRun : t.cc.gatesOff;
        const tone = live.canExecuteLive ? "danger" : (live.liveEnabled && live.facebookHideEnabled) ? "warn" : "ok";
        return (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="font-medium">{t.cc.liveGatesStatus}:</span>
            <Badge tone={tone}>{label}</Badge>
          </div>
        );
      })()}
      <div className="mb-4 rounded-lg border border-[var(--color-warn)] p-3 text-xs">
        ⚠️ <span className="font-medium">{t.cc.autonomousWarn}</span>
      </div>

      {brands.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">{t.dash.createBrandFirst}</Card>
      ) : (
        <div className="space-y-8">
          {brands.map((brand) => (
            <section key={brand.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">🎛️ {brand.name} — {t.cc.autonomyMatrix}</h2>
                {manage ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-[var(--color-muted)]">{t.cc.presetsTitle}:</span>
                    {(["conservative", "balanced", "aggressive"] as const).map((preset) => (
                      <form key={preset} action={applyPreset}>
                        <input type="hidden" name="brandId" value={brand.id} />
                        <input type="hidden" name="preset" value={preset} />
                        <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                          {preset === "conservative" ? t.cc.presetConservative : preset === "balanced" ? t.cc.presetBalanced : t.cc.presetAggressive}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mb-2 text-xs text-[var(--color-muted)]">{t.cc.autonomyMatrixDesc} · {t.cc.presetsHint}</p>

              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                      <th className="py-2 pr-2">{t.cc.colCategory}</th>
                      <th className="px-2">{t.cc.colMode}</th>
                      <th className="px-2">{t.cc.colMinConf}</th>
                      <th className="px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONTROL_CATEGORIES.map((cat) => {
                      const neverAuto = NEVER_AUTONOMOUS.has(cat);
                      const mode = modeFor(brand.id, cat);
                      return (
                        <tr key={cat} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-2 pr-2">
                            {tEnum(t, "autoProtectCategory", cat)}
                            {neverAuto ? <Badge tone="ok">🛡️</Badge> : null}
                          </td>
                          <td className="px-2 py-2" colSpan={3}>
                            {manage ? (
                              <form action={updateControlPolicy} className="flex flex-wrap items-center gap-2">
                                <input type="hidden" name="brandId" value={brand.id} />
                                <input type="hidden" name="category" value={cat} />
                                <select name="mode" defaultValue={mode} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                                  {(CONTROL_MODES.filter((m) => m !== "autonomous" || !neverAuto)).map((m) => (
                                    <option key={m} value={m}>{tEnum(t, "controlMode", m)}</option>
                                  ))}
                                </select>
                                <input name="minConfidence" type="number" step="0.05" min="0" max="1" defaultValue={confFor(brand.id, cat)} className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
                                <AutonomySave label={t.cc.save} confirmText={t.cc.autonomousWarn} />
                              </form>
                            ) : (
                              <Badge>{tEnum(t, "controlMode", mode)}</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
              <div className="mt-2 grid gap-1 text-[11px] text-[var(--color-muted)] sm:grid-cols-2">
                <span>• {t.cc.modeMonitor}</span>
                <span>• {t.cc.modeAssist}</span>
                <span>• {t.cc.modeApproval}</span>
                <span>• {t.cc.modeAutonomous}</span>
                <span className="sm:col-span-2">💡 {t.cc.autonomousExample}</span>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
