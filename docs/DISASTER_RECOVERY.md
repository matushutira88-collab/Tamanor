# Tamanor — Backup & Disaster Recovery (V1.48P)

Production data lives in **one Postgres database**. There is no other durable customer-data store
(tokens are encrypted columns; webhook payloads are minimized/purged; erasure receipts are opaque).
Recovery therefore reduces to **Postgres backup + restore**. This document is the operator's plan;
Part §7 records the **restore drill actually performed** in this environment.

> Privacy: a restored backup re-materializes data that may include content that was later **erased**
> (tenant/user/lead). Backups have a finite retention; after that window the erased data is gone from
> backups too. This is the truthful backup disclosure surfaced in the product (deletion "cannot be
> undone", but "encrypted backups may retain data for a limited period per infrastructure retention").

## 1. Backup strategy
- **Managed Postgres with automated daily snapshots** (RDS / Cloud SQL / Neon / Supabase — whichever
  hosts production). Enable automated backups at provisioning.
- **Encryption at rest** for backups (managed providers do this by default; verify it is ON).
- **Retention:** **14–30 days** of daily snapshots (choose per data-retention policy). This bounds how
  long erased data can persist in backups — document the exact number for the privacy policy.
- Application-level dumps are NOT required (single DB); a periodic `pg_dump` to encrypted object
  storage is an optional second copy for the pilot.

## 2. PITR strategy
- Enable **Point-In-Time Recovery** (continuous WAL archiving) on the managed instance — the standard
  toggle on RDS/Cloud SQL/Neon. PITR lets you restore to any second within the retention window.
- **Target RPO ≤ 5 minutes** (WAL-based PITR). **Without PITR** (snapshots only) RPO = up to 24h — not
  acceptable beyond a trusted pilot.

## 3. Restore procedure (managed provider)
1. Identify the target timestamp (or snapshot).
2. **Restore into a NEW instance** (never overwrite the live DB blindly).
3. Point a staging app at the restored instance; verify (§5).
4. If good, cut over: put the app in maintenance, repoint `DATABASE_URL`/`APP_DATABASE_URL`, run
   `prisma migrate status` (must be "up to date"), bring the app back.
5. Re-verify readiness `GET /api/ready` = 200.

## 4. Restore procedure (self-managed / logical)
```
# Backup (encrypted):
pg_dump --format=custom "$DATABASE_URL" | gpg -c > tamanor_$(date +%F).dump.gpg
# Restore into a fresh DB:
createdb tamanor_restore
gpg -d tamanor_YYYY-MM-DD.dump.gpg | pg_restore --no-owner --dbname tamanor_restore
# Verify migrations applied + row counts, then repoint the app.
```

## 5. Verification / recovery-validation checklist
- [ ] `prisma migrate status` → "up to date" (no pending/failed migrations).
- [ ] `GET /api/ready` → 200 (DB, RLS runtime, encryption, session config all healthy).
- [ ] Row-count sanity vs pre-incident (tenants, users, memberships, connected_accounts).
- [ ] RLS enforced: the runtime role is the non-superuser `tamanor_app` (not owner/bypassrls).
- [ ] A representative tenant can log in and see only its own inbox (spot cross-tenant check).
- [ ] Token encryption mode is production-safe (no plaintext).
- [ ] Worker connects and a maintenance tick runs (no `worker.fatal`).

## 6. Rollback plan (see also docs/RUNBOOKS.md)
- **Bad deploy:** redeploy the previous build; migrations are additive (no schema rollback needed).
- **Bad migration:** `migrate deploy` is per-migration transactional; if a partial state occurred,
  restore from the pre-deploy snapshot (§3) — migrations never delete customer data, so forward-fix
  is usually preferable.
- **Accidental erasure / retention over-delete:** restore the affected rows from the latest snapshot
  into a staging instance and re-import the specific rows (do NOT wholesale-overwrite live data).
- **Credential compromise:** rotate `tamanor_app` + owner passwords, rotate `TOKEN_ENCRYPTION_KEY`
  (re-encrypt tokens or force reconnect), rotate `META_APP_SECRET`; restore is not required unless data
  integrity is in doubt.

## 7. RPO / RTO targets
- **RPO:** ≤ 5 min (PITR) — pilot minimum: ≤ 24h (daily snapshot) with a documented accepted risk.
- **RTO:** ≤ 2h to restore into a new instance and cut over.
- **Who can restore:** the named incident owner + one backup operator with managed-DB console access.

## 8. Restore drill PERFORMED (this environment)
A **logical restore-cycle drill** was executed against a disposable database (no `pg_dump`/managed PITR
available in this dev environment — the managed-provider steps in §3 are the production path):
1. Created a fresh empty database.
2. `prisma migrate deploy` → **all 34 migrations applied cleanly; 39 tables** (proves a from-scratch
   rebuild + schema recovery works).
3. Seeded representative rows, captured counts, dropped the database, re-created + re-migrated, and
   re-verified `migrate status` = up to date.
4. Dropped the disposable database.

**Result: PASS** for the schema/logical rebuild path. **Outstanding for production:** enable managed
automated backups + PITR and run one **provider-level PITR restore drill** (§3) before multi-customer.
```
```

### 8b. V1.51 — automated logical backup/restore drill (repeatable, `pg_dump`/`pg_restore`)
A committed, one-command drill now exists: **`bash packages/db/scripts/restore-drill.sh`**. It runs the
FULL loop against a **disposable** database (never the real DB): create → `prisma migrate deploy` (all
**40** migrations) → seed a representative tenant/user/membership/**subscription**/brand/connected-account
→ **`pg_dump -Fc`** → **simulate catastrophic loss** (drop + recreate empty, verified 0 tables) →
**`pg_restore`** → verify → destroy. Verification asserts row counts (tenants/users/memberships/
subscriptions/brands/connected_accounts), the migration count, FK integrity (membership→tenant), and that
**`FORCE ROW LEVEL SECURITY` is preserved after restore on BOTH `content_items` and the new
`subscriptions` table**.

**Last run: PASS** — 40 migrations, all counts intact, RLS + FKs preserved post-restore. This is the
strongest drill runnable locally (uses the Docker Postgres client tools). The **provider-level managed
PITR restore drill** (§3) remains the one outstanding operator action before multi-customer.

## 9. Release-verdict impact
- **Trusted pilot:** CONDITIONAL — requires (a) a **manual snapshot immediately before launch** and
  (b) a scheduled provider-level restore drill during the pilot. RPO ≤ 24h accepted for one tenant.
- **Multi-customer:** **NO-GO** until automated backups + PITR + a **tested** provider restore exist,
  with RPO ≤ 5 min and RTO ≤ 2h validated.
