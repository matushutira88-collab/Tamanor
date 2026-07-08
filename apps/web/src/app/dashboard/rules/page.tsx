import Link from "next/link";
import {
  Permission,
  RuleCategory,
  RULE_CATEGORY_META,
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
import { createRule, toggleRule, deleteRule } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/rules");

const categoryOptions = Object.values(RuleCategory).map((v) => ({
  value: v,
  label: RULE_CATEGORY_META[v].label,
}));

/** Illustrative severity preview per category (matches how the engine weights). */
const SEVERITY: Record<RuleCategory, { label: string; tone: string }> = {
  [RuleCategory.CrisisKeywords]: { label: "Critical", tone: "danger" },
  [RuleCategory.BlockedWords]: { label: "High", tone: "danger" },
  [RuleCategory.CustomPhrases]: { label: "Medium", tone: "warn" },
  [RuleCategory.CompetitorMentions]: { label: "Awareness", tone: "brand" },
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
  const sp = await searchParams;
  const manage = can(session.role, Permission.RuleManage);

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
        title={nav.label}
        description="Deterministic, phrase-based policies that shape how the AI Risk Engine scores your content."
        action={<Badge tone="brand">Used by AI Risk Engine</Badge>}
      />
      <Notice notice={sp.notice} kind={sp.kind} />

      {brands.length === 0 ? (
        <EmptyState
          title="Create a brand to add rules"
          body="Brand rules belong to a brand. Create your first brand, then define blocked words, competitors, and crisis keywords."
          action={
            <Link href="/dashboard/brands" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)]">
              Go to brands
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Category cards */}
          <div className="space-y-4">
            {ALL_RULE_CATEGORIES.map((cat) => {
              const meta = RULE_CATEGORY_META[cat];
              const sev = SEVERITY[cat];
              const catRules = rules.filter((r) => r.category === cat);
              return (
                <Card key={cat}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold">{meta.label}</h3>
                        <Badge tone={sev.tone}>{sev.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--color-muted)]">{meta.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {catRules.length} rule{catRules.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {catRules.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                        No {meta.label.toLowerCase()} yet.
                      </div>
                    ) : (
                      catRules.map((rule) => (
                        <div key={rule.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{rule.name}</span>
                                <Badge tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? "Active" : "Inactive"}</Badge>
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
                                    {rule.enabled ? "Disable" : "Enable"}
                                  </button>
                                </form>
                                <form action={deleteRule.bind(null, rule.id)}>
                                  <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] bg-white px-2.5 py-1 text-xs transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">
                                    Delete
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
              <h3 className="mb-4 text-sm font-semibold">New rule</h3>
              <form action={createRule} className="space-y-3">
                <Field label="Brand">
                  <Select name="brandId" options={brandOptions} />
                </Field>
                <Field label="Name">
                  <Input name="name" required placeholder="Blocked words" />
                </Field>
                <Field label="Category">
                  <Select name="category" options={categoryOptions} />
                </Field>
                <Field label="Phrases" hint="One per line or comma-separated. Case-insensitive.">
                  <Textarea name="phrases" rows={4} placeholder={"scam\nripoff\nboycott"} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked />
                  <span>Active</span>
                </label>
                <PrimaryButton type="submit" className="w-full">Create rule</PrimaryButton>
              </form>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Rules feed the AI Risk Engine when classifying new content — they never execute actions on their own.
              </p>
            </Card>
          ) : (
            <Card className="h-fit text-xs text-[var(--color-muted)]">
              Your role ({session.role}) can view rules but not manage them.
            </Card>
          )}
        </div>
      )}
    </>
  );
}
