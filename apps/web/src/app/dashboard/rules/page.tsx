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
import { createRule, toggleRule, deleteRule } from "./actions";

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
  const rules: RuleRow[] = brands.flatMap((b) =>
    b.brandRules.map((r) => ({ id: r.id, name: r.name, category: r.category, phrases: r.phrases, enabled: r.enabled, brandName: b.name })),
  );

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
      )}
    </>
  );
}
