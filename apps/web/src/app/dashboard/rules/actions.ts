"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Permission,
  RuleCategory,
  assertCan,
} from "@guardora/core";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

function backWithNotice(notice: string, kind: "ok" | "error" = "ok"): never {
  revalidatePath("/dashboard/rules");
  redirect(`/dashboard/rules?kind=${kind}&notice=${encodeURIComponent(notice)}`);
}

function parsePhrases(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function asCategory(raw: FormDataEntryValue | null): RuleCategory {
  const v = String(raw ?? "");
  if (!(Object.values(RuleCategory) as string[]).includes(v)) {
    throw new Error(`Unknown rule category: ${v}`);
  }
  return v as RuleCategory;
}

export async function createRule(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const brandId = String(formData.get("brandId") ?? "");
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!brand) throw new Error("Brand not found");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Rule name is required");
  const phrases = parsePhrases(formData.get("phrases"));
  if (phrases.length === 0) throw new Error("At least one phrase is required");

  const rule = await prisma.brandRule.create({
    data: {
      tenantId: session.tenantId,
      brandId,
      name,
      category: asCategory(formData.get("category")),
      phrases,
      enabled: formData.get("enabled") === "on",
    },
  });

  await writeAudit({
    session,
    event: "rule.created",
    brandId,
    targetType: "brand_rule",
    targetId: rule.id,
    metadata: { name: rule.name, category: rule.category, phrases: phrases.length },
  });

  backWithNotice(`Rule "${rule.name}" created.`);
}

export async function toggleRule(ruleId: string, enabled: boolean): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const rule = await prisma.brandRule.findFirst({
    where: { id: ruleId, tenantId: session.tenantId },
  });
  if (!rule) throw new Error("Rule not found");

  await prisma.brandRule.update({
    where: { id: rule.id },
    data: { enabled },
  });

  await writeAudit({
    session,
    event: enabled ? "rule.enabled" : "rule.disabled",
    brandId: rule.brandId,
    targetType: "brand_rule",
    targetId: rule.id,
    metadata: { name: rule.name },
  });

  backWithNotice(`Rule "${rule.name}" ${enabled ? "enabled" : "disabled"}.`);
}

export async function deleteRule(ruleId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const rule = await prisma.brandRule.findFirst({
    where: { id: ruleId, tenantId: session.tenantId },
  });
  if (!rule) throw new Error("Rule not found");

  await prisma.brandRule.delete({ where: { id: rule.id } });

  await writeAudit({
    session,
    event: "rule.deleted",
    brandId: rule.brandId,
    targetType: "brand_rule",
    targetId: rule.id,
    metadata: { name: rule.name, category: rule.category },
  });

  backWithNotice(`Rule "${rule.name}" deleted.`);
}
