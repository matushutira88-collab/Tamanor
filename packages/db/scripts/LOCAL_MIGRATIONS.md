# Local Prisma migration workflow (Tamanor)

**Local only.** Everything here uses `localhost:5433` (the `tamanor-local-pg` Docker container) via
`.env.local`. Never point any of this at Supabase / a remote DB. No `push`, `deploy` to prod, or `seed`.

## Root cause — why `prisma migrate dev` fails

`prisma migrate dev` builds a **shadow database** and replays the whole migration history into it to
detect drift. Prisma's shadow replay executes each migration's SQL **without first creating its internal
`_prisma_migrations` table** (verified locally on Prisma 6.19.3: a pre-seeded `_prisma_migrations` is
dropped by the shadow reset and never recreated during replay).

The accepted migration
[`20260720090000_v1_58_5_rls_security_hardening`](../prisma/migrations/20260720090000_v1_58_5_rls_security_hardening/migration.sql)
runs, as a security hardening step:

```sql
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM tamanor_app;
```

In the shadow that table does not exist, so the migration fails: **P3006 → P1014
“The underlying table for model `_prisma_migrations` does not exist.”**

We must **not** modify that (or any) accepted migration, so `migrate dev` cannot be used. This is not a
real problem for this repo: our migrations are **hand-authored** (RLS `ENABLE`/`FORCE`/policies,
`GRANT`/`REVOKE`, composite `(id, tenantId)` FKs) — none of which `migrate dev` would generate anyway.

`prisma migrate deploy` **creates `_prisma_migrations` before applying migrations**, so the REVOKE
succeeds. A fresh `migrate deploy` into a disposable local DB is therefore the reliable replay path.

## Local DBs

| Name | URL (in `.env.local`) | Role |
|------|-----------------------|------|
| `tamanor`        | `DATABASE_URL` → `localhost:5433/tamanor`        | your working dev DB (never reset by this workflow) |
| `tamanor_shadow` | `SHADOW_DATABASE_URL` → `localhost:5433/tamanor_shadow` | **disposable** validation/diff baseline (dropped+recreated on demand) |

`SHADOW_DATABASE_URL` lives only in the git-ignored `.env.local`. It is **not** wired into
`schema.prisma` (that would not fix `migrate dev`, and it would make `prisma generate` require the var).

## Validate the full migration set locally

Recreates `tamanor_shadow` and replays **every** migration into it:

```bash
pnpm db:migrate:replay
```

Green output means all migrations (including any new CS-C1 one) apply cleanly on a fresh local DB.
For the full RLS/role integration suite against a throwaway container, `pnpm rls-security:test` still works.

## Creating the CS-C1 migration (repeatable)

1. **Edit the schema** — add the CS-C1 models to `packages/db/prisma/schema.prisma`.

2. **Pick a correctly-ordered folder name.** Migrations apply in lexicographic order, and this repo uses
   synthetic timestamps. The current latest is `20260801090000_v1_73_internal_tenant`, so CS-C1 must sort
   after it, e.g. `20260802090000_cs_c1_family_domain`.

3. **Scaffold + author the SQL by hand** (the repo pattern). A rough starting draft of the pure
   table/column changes can be produced with a **shadow-free** diff against the `tamanor_shadow` baseline
   — but it is only a draft: it omits RLS/`GRANT` and prints spurious drops for hand-authored composite
   FKs, so review and complete it by hand.

   ```bash
   cd packages/db
   pnpm db:migrate:replay          # (re)build the tamanor_shadow baseline at the current schema
   NEW=prisma/migrations/20260802090000_cs_c1_family_domain
   mkdir -p "$NEW"
   # optional rough draft (hand-edit afterwards — add RLS ENABLE/FORCE/policy + GRANTs, fix FK/index names):
   pnpm exec dotenv -e ../../.env.local -- prisma migrate diff \
     --from-url "$SHADOW_DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma \
     --script > "$NEW/migration.sql"
   ```

4. **Validate** the new migration replays cleanly on a fresh local DB:

   ```bash
   pnpm db:migrate:replay
   ```

5. **Apply to your local `tamanor`** dev DB (records it in `tamanor`'s `_prisma_migrations`):

   ```bash
   pnpm db:migrate:deploy
   ```

Never run `prisma migrate dev` — it will fail on the shadow as described above.
