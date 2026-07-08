import Link from "next/link";
import {
  Permission,
  RuleCategory,
  ALL_RULE_CATEGORIES,
  can,
} from "@guardora/core";
import {
  PageHeader,
  Card,
  Badge,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
  PrimaryButton,
} from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
import { createRule, toggleRule, deleteRule, createMemoryRule, toggleMemoryRule, deleteMemoryRule, updateAutoProtectPolicy } from "./actions";
import { AUTO_PROTECT_CATEGORIES } from "@guardora/ai";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/rules");

/** Illustrative severity preview per category (matches how the engine weights). */
const SEVERITY: Record<RuleCategory, { key: string; tone: string }> = {
  [RuleCategory.CrisisKeywords]: { key: "critical", tone: "danger" },
  [RuleCategory.BlockedWords]: { key: "high", tone: "danger" },
  [RuleCategory.CustomPhrases]: { key: "medium", tone: "warn" },
  [RuleCategory.CompetitorMentions]: { key: "awareness", tone: "brand" },
};

type RuleRow = {
  id: string;
  name: string;
  category: string;
  phrases: string[];
  enabled: boolean;
  brandName: string;
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const hdrT = await getT();
  const sp = await searchParams;
  const manage = can(session.role, Permission.RuleManage);
  const categoryOptions = Object.values(RuleCategory).map((v) => ({
    value: v,
    label: tEnum(hdrT, "ruleCategory", v),
  }));

  const brands = await prisma.brand.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
    include: { brandRules: { orderBy: { createdAt: "asc" } } },
  });

  const brandOptions = brands.map((b) => ({ value: b.id, label: b.name }));
  const brandNameById = new Map(brands.map((b) => [b.id, b.name]));
  const rules: RuleRow[] = brands.flatMap((b) =>
    b.brandRules.map((r) => ({ id: r.id, name: r.name, category: r.category, phrases: r.phrases, enabled: r.enabled, brandName: b.name })),
  );

  const memoryRules = await prisma.brandRiskMemoryRule.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "desc" },
  });

  const autoPolicies = await prisma.brandAutoProtectPolicy.findMany({
    where: { tenantId: session.tenantId },
  });
  const policyKey = (brandId: string, category: string) => `${brandId}:${category}`;
  const policyMap = new Map(autoPolicies.map((p) => [policyKey(p.brandId, p.category), p]));

  return (
    <>
      <PageHeader
        title={hdrT.dashHeaders[nav.icon].title}
        description={hdrT.dash.rulesSubtitle}
        action={<Badge tone="brand">{hdrT.dash.usedByAiRiskEngine}</Badge>}
      />
      <Notice notice={sp.notice} kind={sp.kind} />

      {brands.length === 0 ? (
        <EmptyState
          title={hdrT.dash.createBrandToAddRules}
          body={hdrT.dash.rulesEmptyBody}
          action={
            <Link href="/dashboard/brands" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">
              {hdrT.dash.goToBrands}
            </Link>
          }
        />
      ) : (
        <>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Category cards */}
          <div className="space-y-4">
            {ALL_RULE_CATEGORIES.map((cat) => {
              const sev = SEVERITY[cat];
              const catRules = rules.filter((r) => r.category === cat);
              return (
                <Card key={cat}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold">{withEmoji("ruleCategory", cat, tEnum(hdrT, "ruleCategory", cat))}</h3>
                        <Badge tone={sev.tone}>{tEnum(hdrT, "severity", sev.key)}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--color-muted)]">{tEnum(hdrT, "ruleCategoryDesc", cat)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {catRules.length} {catRules.length === 1 ? hdrT.dash.ruleOne : hdrT.dash.ruleOther}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {catRules.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                        {hdrT.dash.noCategoryRules}
                      </div>
                    ) : (
                      catRules.map((rule) => (
                        <div key={rule.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{rule.name}</span>
                                <Badge tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? hdrT.dash.active : hdrT.dash.inactive}</Badge>
                              </div>
                              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{rule.brandName}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {rule.phrases.map((p) => (
                                  <span key={p} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-fg)]">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {manage ? (
                              <div className="flex shrink-0 gap-1.5">
                                <form action={toggleRule.bind(null, rule.id, !rule.enabled)}>
                                  <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] bg-white px-2.5 py-1 text-xs transition hover:border-[var(--color-brand)]">
                                    {rule.enabled ? hdrT.dash.disable : hdrT.dash.enable}
                                  </button>
                                </form>
                                <form action={deleteRule.bind(null, rule.id)}>
                                  <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] bg-white px-2.5 py-1 text-xs transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">
                                    {hdrT.dash.delete}
                                  </button>
                                </form>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* New rule */}
          {manage ? (
            <Card className="h-fit">
              <h3 className="mb-4 text-sm font-semibold">{hdrT.dash.newRule}</h3>
              <form action={createRule} className="space-y-3">
                <Field label={hdrT.dash.brand}>
                  <Select name="brandId" options={brandOptions} />
                </Field>
                <Field label={hdrT.dash.name}>
                  <Input name="name" required placeholder={hdrT.dash.blockedWordsPlaceholder} />
                </Field>
                <Field label={hdrT.dash.category}>
                  <Select name="category" options={categoryOptions} />
                </Field>
                <Field label={hdrT.dash.phrases} hint={hdrT.dash.phrasesHint}>
                  <Textarea name="phrases" rows={4} placeholder={"scam\nripoff\nboycott"} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked />
                  <span>{hdrT.dash.active}</span>
                </label>
                <PrimaryButton type="submit" className="w-full">{hdrT.dash.createRule}</PrimaryButton>
              </form>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                {hdrT.dash.rulesFooter}
              </p>
            </Card>
          ) : (
            <Card className="h-fit text-xs text-[var(--color-muted)]">
              {hdrT.dash.roleCanViewRules}
            </Card>
          )}
        </div>

        {/* Brand Risk Memory */}
        <section className="mt-8">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">🧠 {hdrT.memory.memoryTitle}</h2>
            <p className="text-sm text-[var(--color-muted)]">{hdrT.memory.memorySubtitle}</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <Card className="overflow-x-auto">
              {memoryRules.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-muted)]">{hdrT.memory.memoryEmpty}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                      <th className="py-2 pr-2">{hdrT.memory.colPhrase}</th>
                      <th className="px-2">{hdrT.memory.colType}</th>
                      <th className="px-2">{hdrT.memory.colSeverity}</th>
                      <th className="px-2">{hdrT.memory.colSource}</th>
                      <th className="px-2">{hdrT.memory.colLanguage}</th>
                      <th className="px-2">{hdrT.memory.colCreated}</th>
                      <th className="px-2 text-right">{hdrT.memory.colActive}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memoryRules.map((m) => (
                      <tr key={m.id} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-2 pr-2 font-medium">{m.phrase} <span className="text-[11px] text-[var(--color-muted)]">· {brandNameById.get(m.brandId) ?? ""}</span></td>
                        <td className="px-2"><Badge>{tEnum(hdrT, "memoryType", m.type)}</Badge></td>
                        <td className="px-2">{tEnum(hdrT, "severity", m.severity)}</td>
                        <td className="px-2">{tEnum(hdrT, "memorySource", m.source)}</td>
                        <td className="px-2">{m.language ? tEnum(hdrT, "detectedLang", m.language) : "—"}</td>
                        <td className="px-2 text-xs text-[var(--color-muted)]">{formatDate(m.createdAt)}</td>
                        <td className="px-2 text-right">
                          {manage ? (
                            <div className="flex justify-end gap-1.5">
                              <form action={toggleMemoryRule.bind(null, m.id, !m.isActive)}>
                                <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs hover:border-[var(--color-border-strong)]">
                                  {m.isActive ? hdrT.memory.deactivate : hdrT.memory.activate}
                                </button>
                              </form>
                              <form action={deleteMemoryRule.bind(null, m.id)}>
                                <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-danger)] hover:border-[var(--color-danger)]">✕</button>
                              </form>
                            </div>
                          ) : (
                            <Badge tone={m.isActive ? "ok" : "neutral"}>{m.isActive ? hdrT.dash.active : hdrT.dash.inactive}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {manage ? (
              <Card className="h-fit">
                <h3 className="mb-3 text-sm font-semibold">{hdrT.memory.addMemoryRule}</h3>
                <form action={createMemoryRule} className="space-y-3">
                  <Field label={hdrT.dash.brand}>
                    <Select name="brandId" options={brandOptions} />
                  </Field>
                  <Field label={hdrT.memory.colPhrase}>
                    <Input name="phrase" required placeholder={hdrT.memory.phrasePlaceholder} />
                  </Field>
                  <Field label={hdrT.memory.colType}>
                    <Select name="type" options={(["watch_phrase", "allow_phrase", "block_phrase", "competitor_phrase", "crisis_phrase", "increase_risk_pattern", "reduce_risk_pattern"] as const).map((v) => ({ value: v, label: tEnum(hdrT, "memoryType", v) }))} />
                  </Field>
                  <Field label={hdrT.memory.colSeverity}>
                    <Select name="severity" options={(["low", "medium", "high", "critical"] as const).map((v) => ({ value: v, label: tEnum(hdrT, "severity", v) }))} />
                  </Field>
                  <PrimaryButton type="submit" className="w-full">{hdrT.memory.add}</PrimaryButton>
                </form>
              </Card>
            ) : null}
          </div>
        </section>

        {/* Auto-Protect */}
        <section className="mt-8">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">🛡️ {hdrT.autoProtect.title}</h2>
            <p className="text-sm text-[var(--color-muted)]">{hdrT.autoProtect.subtitle}</p>
            <p className="mt-1 text-xs text-[var(--color-warn)]">⚠️ {hdrT.autoProtect.shadowExplain} · {hdrT.autoProtect.liveDisabled}</p>
          </div>
          <div className="space-y-6">
            {brands.map((b) => (
              <Card key={b.id} className="overflow-x-auto">
                <h3 className="mb-3 text-sm font-semibold">{b.name}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted)]">
                      <th className="py-2 pr-2">{hdrT.autoProtect.colCategory}</th>
                      <th className="px-2">{hdrT.autoProtect.colMode}</th>
                      <th className="px-2">{hdrT.autoProtect.colMinConfidence}</th>
                      <th className="px-2">{hdrT.autoProtect.colActive}</th>
                      <th className="px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {AUTO_PROTECT_CATEGORIES.map((cat) => {
                      const p = policyMap.get(policyKey(b.id, cat));
                      const isCriticism = cat === "normal_criticism";
                      return (
                        <tr key={cat} className="border-b border-[var(--color-border)] last:border-0 align-top">
                          <td className="py-2 pr-2">
                            <div className="font-medium">{tEnum(hdrT, "autoProtectCategory", cat)}</div>
                            <div className="text-[11px] text-[var(--color-muted)]">{tEnum(hdrT, "autoProtectCategoryDesc", cat)}</div>
                          </td>
                          <td className="px-2 py-2" colSpan={4}>
                            <form action={updateAutoProtectPolicy} className="flex flex-wrap items-center gap-2">
                              <input type="hidden" name="brandId" value={b.id} />
                              <input type="hidden" name="category" value={cat} />
                              {manage ? (
                                <>
                                  <select name="mode" defaultValue={p?.mode ?? "monitor"} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                                    {(["monitor", "approval", ...(isCriticism ? [] : ["auto_hide_shadow"])] as const).map((m) => (
                                      <option key={m} value={m}>{tEnum(hdrT, "autoProtectMode", m)}</option>
                                    ))}
                                  </select>
                                  <input name="minConfidence" type="number" step="0.05" min="0" max="1" defaultValue={p?.minConfidence ?? 0.7} className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
                                  <label className="flex items-center gap-1 text-xs">
                                    <input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> {hdrT.autoProtect.colActive}
                                  </label>
                                  <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">{hdrT.autoProtect.save}</button>
                                </>
                              ) : (
                                <span className="text-xs">
                                  <Badge>{tEnum(hdrT, "autoProtectMode", p?.mode ?? "monitor")}</Badge>
                                  {p?.isActive === false ? <span className="ml-2 text-[var(--color-muted)]">({hdrT.dash.inactive})</span> : null}
                                </span>
                              )}
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-[var(--color-muted)]">{hdrT.autoProtect.reservedNote}</p>
              </Card>
            ))}
          </div>
        </section>
        </>
      )}
    </>
  );
}
