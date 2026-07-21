/**
 * V1.73 — designate the INTERNAL Tamanor admin tenant(s). The single authoritative, AUDITABLE mechanism
 * for granting `Tenant.internalAccess`. Run by an operator (deploy step or manually) — NEVER reachable
 * from the app / registration. Matches the EXACT owner email (case-insensitive, exact string — never
 * LIKE/contains), so a "similar" registration (info2@…, info@tamanor.sk.evil) can never inherit internal
 * access. Idempotent: re-runs are no-ops; if the tenant isn't registered yet it sets nothing and reports.
 *
 * Run: pnpm db:set-internal-tenant   (uses the .env DATABASE_URL — point it at the target DB)
 */
import { ActorKind } from "@prisma/client";
import { systemDb } from "@guardora/db";

/** The authoritative internal-tenant owner emails. A CODE constant (not user-controlled input). */
export const INTERNAL_TENANT_EMAILS: readonly string[] = ["info@tamanor.sk"];

async function main(): Promise<void> {
  let granted = 0;
  for (const raw of INTERNAL_TENANT_EMAILS) {
    const email = raw.trim().toLowerCase();
    // Tenants OWNED by this exact email (owner membership). Exact, case-insensitive match only.
    const owners = await systemDb.membership.findMany({
      where: { role: "owner", user: { email: { equals: email, mode: "insensitive" } } },
      select: { tenantId: true },
    });
    if (owners.length === 0) {
      console.log(`• ${email}: no owner tenant found yet — nothing set (re-run after it registers).`);
      continue;
    }
    for (const o of owners) {
      const upd = await systemDb.tenant.updateMany({ where: { id: o.tenantId, internalAccess: false }, data: { internalAccess: true } });
      if (upd.count > 0) {
        await systemDb.auditLog.create({
          data: { tenantId: o.tenantId, event: "tenant.internal_access_granted", actorKind: ActorKind.system, targetType: "tenant", targetId: o.tenantId, metadata: { email, by: "set-internal-tenant" } },
        });
        granted++;
        console.log(`✓ ${email}: tenant ${o.tenantId} → internalAccess=true (audited).`);
      } else {
        console.log(`• ${email}: tenant ${o.tenantId} already internal (no change).`);
      }
    }
  }
  console.log(`\nDone — ${granted} tenant(s) newly granted internal access.`);
  await systemDb.$disconnect();
}

main().catch(async (e) => { console.error(String(e).slice(0, 400)); await systemDb.$disconnect(); process.exit(1); });
