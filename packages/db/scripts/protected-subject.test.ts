/**
 * C1 — ProtectedSubject & relationship: model + RLS tenant isolation (local DB).
 * Verifies tenant-scoped persistence, cross-tenant isolation + WITH CHECK,
 * per-tenant unique public identifier, and composite-FK cascade. No service/
 * business logic is exercised (C1 is foundation). Run: pnpm protected-subject:test
 */
import { systemDb, withTenant } from "../src/index";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};
const rejects = async (fn: () => Promise<unknown>) => {
  try { await fn(); return false; } catch { return true; }
};

const sfx = `ps_${process.pid}`;
const tA = `tenA_${sfx}`;
const tB = `tenB_${sfx}`;

async function main() {
  for (const id of [tA, tB]) {
    await systemDb.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id, plan: "growth" } });
  }

  // Create a subject + a trusted-contact relationship under tenant A (RLS context).
  const subjA = await withTenant(tA, (db) =>
    db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: "subj-1", displayLabel: "Subject One", subjectType: "individual" } }),
  );
  check("A: subject created with active default true", subjA.active === true && subjA.subjectType === "individual");
  await withTenant(tA, (db) =>
    db.protectedSubjectRelationship.create({ data: { tenantId: tA, protectedSubjectId: subjA.id, relationshipType: "trusted_contact" } }),
  );

  // 1) A sees its subject; B sees none (RLS isolation).
  const aList = await withTenant(tA, (db) => db.protectedSubject.findMany({ where: {} }));
  check("A sees exactly its 1 subject", aList.length === 1 && aList[0]!.id === subjA.id);
  const bList = await withTenant(tB, (db) => db.protectedSubject.findMany({ where: {} }));
  check("B sees 0 of A's subjects (tenant isolation)", bList.length === 0);

  // 2) B cannot INSERT a subject tagged as tenant A (WITH CHECK).
  const blockedInsert = await rejects(() =>
    withTenant(tB, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: "evil", displayLabel: "x", subjectType: "individual" } })),
  );
  check("B cannot INSERT a subject for tenant A (WITH CHECK)", blockedInsert);

  // 3) Per-tenant unique publicIdentifier: duplicate in A rejected; same id fine in B.
  const dupInA = await rejects(() =>
    withTenant(tA, (db) => db.protectedSubject.create({ data: { tenantId: tA, publicIdentifier: "subj-1", displayLabel: "dup", subjectType: "individual" } })),
  );
  check("duplicate publicIdentifier within a tenant is rejected", dupInA);
  const sameIdInB = await withTenant(tB, (db) => db.protectedSubject.create({ data: { tenantId: tB, publicIdentifier: "subj-1", displayLabel: "B one", subjectType: "individual" } }));
  check("same publicIdentifier in a DIFFERENT tenant is allowed", sameIdInB.tenantId === tB);

  // 4) Relationship is tenant-isolated too.
  const aRel = await withTenant(tA, (db) => db.protectedSubjectRelationship.findMany({ where: {} }));
  check("A sees its 1 relationship", aRel.length === 1 && aRel[0]!.relationshipType === "trusted_contact");
  const bRel = await withTenant(tB, (db) => db.protectedSubjectRelationship.findMany({ where: {} }));
  check("B sees 0 relationships of A", bRel.length === 0);

  // 5) Composite-FK cascade: deleting the subject cascades its relationships.
  await withTenant(tA, (db) => db.protectedSubject.delete({ where: { id: subjA.id } }));
  const aRelAfter = await withTenant(tA, (db) => db.protectedSubjectRelationship.findMany({ where: {} }));
  check("deleting a subject cascades its relationships (composite FK)", aRelAfter.length === 0);

  // Cleanup.
  await systemDb.protectedSubjectRelationship.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.protectedSubject.deleteMany({ where: { tenantId: { in: [tA, tB] } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: [tA, tB] } } });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — protected subject model + RLS: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
