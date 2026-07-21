"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Permission, assertCan } from "@guardora/core";
import { CONTROL_MODES, NEVER_AUTONOMOUS, presetPolicies, type PresetName } from "@guardora/ai";
import { getLiveActionsConfig, metaCommentHideFeatureEnabled } from "@guardora/config";
import { withTenant, type TenantTx } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

function back(notice: string): never {
  revalidatePath("/dashboard/control-center");
  redirect(`/dashboard/control-center?kind=ok&notice=${encodeURIComponent(notice)}`);
}

async function assertBrand(db: TenantTx, brandId: string) {
  const brand = await db.brand.findFirst({ where: { id: brandId }, select: { id: true } });
  if (!brand) throw new Error("Brand not found");
}

/** Update one Control Policy (Autonomy Matrix cell). Safety-clamped. Audited. */
export async function updateControlPolicy(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const brandId = String(formData.get("brandId") ?? "");
  const category = String(formData.get("category") ?? "");
  let mode = String(formData.get("mode") ?? "monitor");
  if (!(CONTROL_MODES as readonly string[]).includes(mode)) mode = "monitor";
  // Hard safety: never-autonomous categories can be at most approval.
  if (NEVER_AUTONOMOUS.has(category as never) && mode === "autonomous") mode = "approval";
  // V1.68 (Release A / A3) — UI truth: never persist an "autonomous" policy that can never execute.
  // Autonomous live auto-hide needs BOTH the platform feature flag and live execution; when either is
  // off, clamp to "approval" so the customer isn't led to believe automation is armed.
  const liveAutoHideAvailable = metaCommentHideFeatureEnabled() && getLiveActionsConfig().canExecuteLive;
  if (mode === "autonomous" && !liveAutoHideAvailable) mode = "approval";
  const minConfidenceRaw = Number(formData.get("minConfidence") ?? "0.8");
  const minConfidence = Number.isFinite(minConfidenceRaw) ? Math.min(1, Math.max(0, minConfidenceRaw)) : 0.8;

  await withTenant(session.tenantId, async (db) => {
    await assertBrand(db, brandId);
    await db.controlPolicy.upsert({
      where: { brandId_platform_sourceType_category: { brandId, platform: "any", sourceType: "comment", category } },
      create: { tenantId: session.tenantId, brandId, platform: "any", sourceType: "comment", category, mode, minConfidence, isActive: true, createdBy: session.userId },
      update: { mode, minConfidence, isActive: true },
    });
    await writeAudit({
      session, db,
      event: mode === "autonomous" ? "autonomy_mode.changed" : "control_policy.updated",
      brandId, targetType: "control_policy", targetId: `${brandId}:${category}`,
      metadata: { category, mode, minConfidence, autonomous: mode === "autonomous" },
    });
  });
  back(`Control policy updated for ${category}.`);
}

/** Apply a protection preset — creates/updates policies only, no fake content. */
export async function applyPreset(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.RuleManage);

  const brandId = String(formData.get("brandId") ?? "");
  const preset = String(formData.get("preset") ?? "") as PresetName;
  if (!["conservative", "balanced", "aggressive"].includes(preset)) throw new Error("Unknown preset");

  await withTenant(session.tenantId, async (db) => {
    await assertBrand(db, brandId);
    for (const p of presetPolicies(preset as Exclude<PresetName, "custom">)) {
      await db.controlPolicy.upsert({
        where: { brandId_platform_sourceType_category: { brandId, platform: "any", sourceType: "comment", category: p.category } },
        create: { tenantId: session.tenantId, brandId, platform: "any", sourceType: "comment", category: p.category, mode: p.mode, minConfidence: 0.8, isActive: true, createdBy: session.userId },
        update: { mode: p.mode },
      });
    }
    await writeAudit({
      session, db, event: "preset.applied", brandId, targetType: "control_policy", targetId: brandId,
      metadata: { preset },
    });
  });
  back(`Applied the ${preset} preset.`);
}
