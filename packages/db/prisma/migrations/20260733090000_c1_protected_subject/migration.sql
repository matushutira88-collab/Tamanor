-- C1 — Cyberbullying Protected Subject & Access Foundation. Two additive, tenant-scoped tables.
-- Victim-centric, ISOLATED from brand models. Enrolled into the RLS strict-table tenant_isolation
-- policy (ENABLE + FORCE) so isolation matches every other tenant table. Non-sensitive columns only.

-- CreateTable
CREATE TABLE "protected_subjects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicIdentifier" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "protected_subjects_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "protected_subject_relationships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "protectedSubjectId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "protected_subject_relationships_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "protected_subjects_tenantId_active_idx" ON "protected_subjects"("tenantId", "active");
-- CreateIndex
CREATE UNIQUE INDEX "protected_subjects_id_tenantId_key" ON "protected_subjects"("id", "tenantId");
-- CreateIndex
CREATE UNIQUE INDEX "protected_subjects_tenantId_publicIdentifier_key" ON "protected_subjects"("tenantId", "publicIdentifier");
-- CreateIndex
CREATE INDEX "protected_subject_relationships_tenantId_protectedSubjectId_idx" ON "protected_subject_relationships"("tenantId", "protectedSubjectId");
-- CreateIndex
CREATE UNIQUE INDEX "protected_subject_relationships_id_tenantId_key" ON "protected_subject_relationships"("id", "tenantId");
-- AddForeignKey
ALTER TABLE "protected_subjects" ADD CONSTRAINT "protected_subjects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "protected_subject_relationships" ADD CONSTRAINT "protected_subject_relationships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "protected_subject_relationships" ADD CONSTRAINT "protected_subject_relationships_protectedSubjectId_tenantI_fkey" FOREIGN KEY ("protectedSubjectId", "tenantId") REFERENCES "protected_subjects"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security: strict tenant_isolation (same policy as every tenant table).
-- Fail-closed: no app.tenant_id context => 0 rows, INSERT/UPDATE rejected.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "protected_subjects", "protected_subject_relationships" TO tamanor_app;

DO $strict$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['protected_subjects','protected_subject_relationships'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_app_tenant_id())
      WITH CHECK ("tenantId" = current_app_tenant_id())$p$, t);
  END LOOP;
END $strict$;
