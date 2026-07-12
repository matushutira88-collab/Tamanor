"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Permission,
  RuleCategory,
  assertCan,
} from "@guardora/core";
import { normalize, LIVE_ELIGIBLE_CATEGORIES } from "@guardora/ai";
import { getLiveActionsConfig } from "@guardora/config";
import { withTenant } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

const MEMORY_TYPES = [
  "watch_phrase", "block_phrase", "allow_phrase", "reduce_risk_pattern",
  "increase_risk_pattern", "competitor_phrase", "crisis_phrase",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

// Selectable Auto-Protect modes. `auto_hide_live_reserved` is intentionally NOT
// here — it is reserved for a future action-enable phase and must not be chosen.
const SELECTABLE_MODES = ["monitor", "approval", "auto_hide_shadow"] as const;

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
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Rule name is required");
  const phrases = parsePhrases(formData.get("phrases"));
  if (phrases.length === 0) throw new Error("At least one phrase is required");
  const category = asCategory(formData.get("category"));
  const enabled = formData.get("enabled") === "on";

  const rule = await withTenant(session.tenantId, async (db) => {
    const brand = await db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true } });
    if (!brand) throw new Error("Brand not found");
    const rule = await db.brandRule.create({
      data: { tenantId: session.tenantId, brandId, name, category, phrases, enabled },
    });
    await writeAudit({
      session, db,
      event: "rule.created",
      brandId, targetType: "brand_rule", targetId: rule.id,
      metadata: { name: rule.name, category: rule.category, phrases: phrases.length },
    });
    return rule;
  });

  backWithNotice(`Rule "${rule.name}" created.`);
}

export async function toggleRule(ruleId: string, enabled: boolean): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const rule = await withTenant(session.tenantId, async (db) => {
    const rule = await db.brandRule.findFirst({ where: { id: ruleId, tenantId: session.tenantId } });
    if (!rule) throw new Error("Rule not found");
    await db.brandRule.update({ where: { id: rule.id }, data: { enabled } });
    await writeAudit({
      session, db,
      event: enabled ? "rule.enabled" : "rule.disabled",
      brandId: rule.brandId, targetType: "brand_rule", targetId: rule.id,
      metadata: { name: rule.name },
    });
    return rule;
  });

  backWithNotice(`Rule "${rule.name}" ${enabled ? "enabled" : "disabled"}.`);
}

export async function deleteRule(ruleId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const rule = await withTenant(session.tenantId, async (db) => {
    const rule = await db.brandRule.findFirst({ where: { id: ruleId, tenantId: session.tenantId } });
    if (!rule) throw new Error("Rule not found");
    await db.brandRule.delete({ where: { id: rule.id } });
    await writeAudit({
      session, db,
      event: "rule.deleted",
      brandId: rule.brandId, targetType: "brand_rule", targetId: rule.id,
      metadata: { name: rule.name, category: rule.category },
    });
    return rule;
  });

  backWithNotice(`Rule "${rule.name}" deleted.`);
}

/* ---------------------------------------------- Brand Risk Memory (V1.17) --- */

export async function createMemoryRule(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const brandId = String(formData.get("brandId") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!(MEMORY_TYPES as readonly string[]).includes(type)) throw new Error("Unknown memory rule type");
  const phrase = String(formData.get("phrase") ?? "").trim();
  if (!phrase) throw new Error("Phrase is required");
  const severityRaw = String(formData.get("severity") ?? "medium");
  const severity = (SEVERITIES as readonly string[]).includes(severityRaw) ? severityRaw : "medium";
  const language = String(formData.get("language") ?? "").trim() || null;

  await withTenant(session.tenantId, async (db) => {
    const brand = await db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true } });
    if (!brand) throw new Error("Brand not found");
    const rule = await db.brandRiskMemoryRule.create({
      data: {
        tenantId: session.tenantId, brandId, type, phrase,
        normalizedPhrase: normalize(phrase), language, severity,
        source: "manual", isActive: true, createdBy: session.userId,
      },
    });
    await writeAudit({
      session, db,
      event: "memory_rule.created",
      brandId, targetType: "brand_memory_rule", targetId: rule.id,
      metadata: { type, severity, source: "manual" },
    });
  });

  backWithNotice(`Brand memory rule added.`);
}

export async function toggleMemoryRule(ruleId: string, isActive: boolean): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  await withTenant(session.tenantId, async (db) => {
    const rule = await db.brandRiskMemoryRule.findFirst({ where: { id: ruleId, tenantId: session.tenantId } });
    if (!rule) throw new Error("Memory rule not found");
    await db.brandRiskMemoryRule.update({ where: { id: rule.id }, data: { isActive } });
    await writeAudit({
      session, db,
      event: isActive ? "memory_rule.activated" : "memory_rule.deactivated",
      brandId: rule.brandId, targetType: "brand_memory_rule", targetId: rule.id,
      metadata: { type: rule.type },
    });
  });

  backWithNotice(`Brand memory rule ${isActive ? "activated" : "deactivated"}.`);
}

export async function deleteMemoryRule(ruleId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  await withTenant(session.tenantId, async (db) => {
    const rule = await db.brandRiskMemoryRule.findFirst({ where: { id: ruleId, tenantId: session.tenantId } });
    if (!rule) throw new Error("Memory rule not found");
    await db.brandRiskMemoryRule.delete({ where: { id: rule.id } });
    await writeAudit({
      session, db,
      event: "memory_rule.deleted",
      brandId: rule.brandId, targetType: "brand_memory_rule", targetId: rule.id,
      metadata: { type: rule.type },
    });
  });

  backWithNotice(`Brand memory rule deleted.`);
}

/* ---------------------------------------------- Auto-Protect (V1.18) -------- */

export async function updateAutoProtectPolicy(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const brandId = String(formData.get("brandId") ?? "");
  const category = String(formData.get("category") ?? "");
  let mode = String(formData.get("mode") ?? "monitor");
  const liveCfg = getLiveActionsConfig();
  // Live mode is only permitted when globally enabled AND the category is
  // live-eligible AND it is not normal_criticism. Otherwise fall back safely.
  const liveAllowed = liveCfg.liveEnabled && LIVE_ELIGIBLE_CATEGORIES.has(category as never) && category !== "normal_criticism";
  const selectable = liveAllowed ? [...SELECTABLE_MODES, "auto_hide_live_reserved"] : [...SELECTABLE_MODES];
  if (!selectable.includes(mode)) mode = "monitor";
  // Safety floor: normal criticism must never be auto-hidden.
  if (category === "normal_criticism" && (mode === "auto_hide_shadow" || mode === "auto_hide_live_reserved")) mode = "approval";
  const liveEnabling = mode === "auto_hide_live_reserved";

  const minConfidenceRaw = Number(formData.get("minConfidence") ?? "0.7");
  const minConfidence = Number.isFinite(minConfidenceRaw) ? Math.min(1, Math.max(0, minConfidenceRaw)) : 0.7;
  const isActive = formData.get("isActive") === "on";

  await withTenant(session.tenantId, async (db) => {
    const brand = await db.brand.findFirst({ where: { id: brandId, tenantId: session.tenantId }, select: { id: true } });
    if (!brand) throw new Error("Brand not found");
    await db.brandAutoProtectPolicy.upsert({
      where: { brandId_category: { brandId, category } },
      create: { tenantId: session.tenantId, brandId, category, mode, minConfidence, isActive, createdBy: session.userId },
      update: { mode, minConfidence, isActive },
    });
    await writeAudit({
      session, db,
      event: liveEnabling ? "policy.live_enabled" : "auto_protect_policy.updated",
      brandId, targetType: "auto_protect_policy", targetId: `${brandId}:${category}`,
      metadata: { category, mode, minConfidence, isActive, live: liveEnabling },
    });
  });

  backWithNotice(`Auto-Protect updated for ${category}.`);
}
