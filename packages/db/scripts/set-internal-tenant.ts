/**
 * V1.73 — designate the INTERNAL Tamanor admin tenant(s). The single authoritative, AUDITABLE mechanism
 * for granting `Tenant.internalAccess`. Run by an operator (deploy step or manually) — NEVER reachable
 * from the app / registration.
 *
 * Two safe, EXACT-match modes (no fuzzy/LIKE search):
 *   --tenant-id <id>   Grant a specific Tenant.id, but ONLY after verifying info@tamanor.sk is a member
 *                      of that exact tenant (any role, exact email). Refuses otherwise.
 *   (no arg)           Grant the tenant OWNED by each exact internal email (owner membership).
 * Idempotent: re-runs are no-ops. Writes a `tenant.internal_access_granted` audit row on each grant.
 *
 * Run: pnpm db:set-internal-tenant [-- --tenant-id <id>]   (uses the .env DATABASE_URL — point at the target DB)
 */
import { ActorKind } from "@prisma/client";
import { systemDb, withTenant } from "@guardora/db";

/** The authoritative internal-tenant emails. A CODE constant (not user-controlled input). */
export const INTERNAL_TENANT_EMAILS: readonly string[] = ["info@tamanor.sk"];

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const INTERNAL = INTERNAL_TENANT_EMAILS.map((e) => e.trim().toLowerCase());

/**
 * Grant a SPECIFIC Tenant.id. Runs inside withTenant(tenantId) so the query works whether the runtime
 * role is RLS-enforced (context grants access to exactly this tenant) or a bypass owner. Verifies an
 * internal email is an EXACT member of THIS tenant before granting; writes the audit row.
 */
async function byTenantId(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (db) => {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, internalAccess: true } });
    if (!t) { console.log(`✗ tenant ${tenantId}: NOT FOUND (not in this database, or not visible under its RLS context).`); return 0; }
    const members = await db.membership.findMany({ where: { tenantId }, select: { role: true, user: { select: { email: true } } } });
    console.log(`• tenant ${tenantId} (${t.name}) members: ${members.map((m) => `${m.user?.email}:${m.role}`).join(", ") || "(none)"}`);
    const match = members.find((m) => m.user?.email && INTERNAL.includes(m.user.email.toLowerCase()));
    if (!match) { console.log(`✗ refusing: no internal email (${INTERNAL.join(", ")}) is a member of tenant ${tenantId}.`); return 0; }
    console.log(`• verified internal email ${match.user!.email} is a member (${match.role}).`);
    if (t.internalAccess) { console.log(`• already internal (no change).`); return 0; }
    await db.tenant.updateMany({ where: { id: tenantId, internalAccess: false }, data: { internalAccess: true } });
    await db.auditLog.create({ data: { tenantId, event: "tenant.internal_access_granted", actorKind: ActorKind.system, targetType: "tenant", targetId: tenantId, metadata: { email: match.user!.email, memberRole: match.role, by: "set-internal-tenant --tenant-id" } } });
    console.log(`✓ tenant ${tenantId} → internalAccess=true (audited).`);
    return 1;
  });
}

/** Grant the tenant OWNED by each exact internal email (owner membership). Uses systemDb (bypass path). */
async function byEmail(): Promise<number> {
  let granted = 0;
  for (const email of INTERNAL) {
    const owners = await systemDb.membership.findMany({ where: { role: "owner", user: { email: { equals: email, mode: "insensitive" } } }, select: { tenantId: true } });
    if (owners.length === 0) { console.log(`• ${email}: no OWNER tenant visible — if it is a member, use --tenant-id <id>.`); continue; }
    for (const o of owners) {
      const upd = await systemDb.tenant.updateMany({ where: { id: o.tenantId, internalAccess: false }, data: { internalAccess: true } });
      if (upd.count > 0) {
        await systemDb.auditLog.create({ data: { tenantId: o.tenantId, event: "tenant.internal_access_granted", actorKind: ActorKind.system, targetType: "tenant", targetId: o.tenantId, metadata: { email, by: "set-internal-tenant email-owner" } } });
        granted++; console.log(`✓ tenant ${o.tenantId} → internalAccess=true (audited).`);
      } else console.log(`• tenant ${o.tenantId}: already internal (no change).`);
    }
  }
  return granted;
}

async function main(): Promise<void> {
  const tenantId = argValue("tenant-id");
  const granted = tenantId ? await byTenantId(tenantId) : await byEmail();
  console.log(`\nDone — ${granted} tenant(s) newly granted internal access.`);
  await systemDb.$disconnect();
}

main().catch(async (e) => { console.error(String(e).slice(0, 400)); await systemDb.$disconnect(); process.exit(1); });
