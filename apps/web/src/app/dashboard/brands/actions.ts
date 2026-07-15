"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BrandStatus,
  BrandTone,
  Permission,
  assertCan,
  EntitlementError,
  emitOpsEvent,
} from "@guardora/core";
import { DEFAULT_AUTO_PROTECT_POLICIES } from "@guardora/ai";
import { withTenant, createWithinResourceLimit } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

function enumValue<T extends Record<string, string>>(
  e: T,
  raw: FormDataEntryValue | null,
  fallback: T[keyof T],
): T[keyof T] {
  const v = String(raw ?? "");
  return (Object.values(e) as string[]).includes(v)
    ? (v as T[keyof T])
    : fallback;
}

export async function createBrand(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.BrandManage);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Brand name is required");

  // V1.50F — ATOMIC brand limit: the advisory-locked count + create run in ONE transaction, so two
  // concurrent creates can never exceed maxBrands; a restricted tenant (limit 0) is denied; a failed
  // create consumes no capacity. Downgrade preserves existing brands — only NEW creation is blocked.
  let brand;
  try {
    brand = await createWithinResourceLimit(session.tenantId, "brands", async (db) => {
      const b = await db.brand.create({
        data: {
          tenantId: session.tenantId,
          name,
          displayName: String(formData.get("displayName") ?? "").trim() || null,
          defaultLocale: String(formData.get("defaultLocale") ?? "en").trim() || "en",
          timezone: String(formData.get("timezone") ?? "UTC").trim() || "UTC",
          defaultTone: enumValue(BrandTone, formData.get("defaultTone"), BrandTone.Professional),
          status: enumValue(BrandStatus, formData.get("status"), BrandStatus.Active),
        },
      });
      await db.brandAutoProtectPolicy.createMany({
        data: DEFAULT_AUTO_PROTECT_POLICIES.map((p) => ({
          tenantId: session.tenantId, brandId: b.id, category: p.category, mode: p.mode,
          minConfidence: 0.7, isActive: true, createdBy: session.userId,
        })),
      });
      await writeAudit({ session, db, event: "brand.created", brandId: b.id, targetType: "brand", targetId: b.id, metadata: { name: b.name, autoProtectDefaults: DEFAULT_AUTO_PROTECT_POLICIES.length } });
      return b;
    });
  } catch (e) {
    if (e instanceof EntitlementError) {
      emitOpsEvent("entitlement.limit_reached", { operation: "create_brand", reason: e.reason });
      redirect(`/dashboard/brands?error=${e.reason}`);
    }
    throw e;
  }

  revalidatePath("/dashboard/brands");
  redirect(`/dashboard/brands/${brand.id}`);
}

export async function updateBrandStatus(
  brandId: string,
  status: string,
): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, Permission.BrandManage);

  const nextStatus = enumValue(BrandStatus, status, BrandStatus.Active);
  await withTenant(session.tenantId, async (db) => {
    await db.brand.updateMany({
      where: { id: brandId, tenantId: session.tenantId },
      data: { status: nextStatus },
    });
    await writeAudit({
      session, db,
      event: "brand.status_changed",
      brandId,
      targetType: "brand",
      targetId: brandId,
      metadata: { status: nextStatus },
    });
  });

  revalidatePath(`/dashboard/brands/${brandId}`);
  revalidatePath("/dashboard/brands");
}
