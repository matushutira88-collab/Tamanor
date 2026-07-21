-- V1.73 (internal Tamanor admin tenant) — additive. Authoritative, operator-set flag; never user-settable.

-- AddColumn
ALTER TABLE "tenants" ADD COLUMN "internalAccess" BOOLEAN NOT NULL DEFAULT false;

-- Designate the internal Tamanor admin tenant by its EXACT owner email (case-insensitive, exact match —
-- never LIKE/contains, so a "similar" registration can never inherit internal access). Idempotent: if the
-- tenant doesn't exist yet, this sets nothing and the set-internal-tenant admin script designates it later.
UPDATE "tenants" t SET "internalAccess" = true
WHERE t.id IN (
  SELECT m."tenantId" FROM "memberships" m
  JOIN "users" u ON u.id = m."userId"
  WHERE lower(u.email) = 'info@tamanor.sk' AND m.role = 'owner'
);
