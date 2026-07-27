# Tamanor Platform Admin V1

Internal, cross-tenant platform administration for **Tamanor operators**. It is completely independent of
tenant memberships and roles, and it never grants access to tenant-private data (customer messages, Child
Safety incidents/signals, tenant documents, private keys).

## Platform-role model

Authorization is a persisted per-user **platform role** (`User.platformRole`), read **fresh** on every check
and **fail-closed** (missing user, absent role, deactivated access, or a DB error → no access). It is resolved
by the single authoritative module `packages/db/src/platform-repo.ts` (`resolvePlatformRole` /
`requirePlatformCapability`). Building on the V1.45A foundation, V1 adds the operator tiers:

| Role | Capabilities |
| --- | --- |
| `owner` (PLATFORM_OWNER) | Everything, incl. **managing platform administrators** (`admin_users.manage`). |
| `admin` (PLATFORM_ADMIN) | Admin area, analytics view **+ export**, admin_users **view**, audit view, system-health — **not** admin management. |
| `analyst` (PLATFORM_ANALYST) | Analytics **view** (aggregated) + audit view (**actor identity redacted**) + admin area. No export, no management, no system-health. |
| `support` (PLATFORM_SUPPORT) | Admin area + **system-health** view only. No analytics, no management. |
| `staff` (legacy) | Leads read/write only — **no admin area**. |
| `none` / tenant users | **Denied**. A tenant Owner has **no** platform access. |

Permissions (`platform.admin.access`, `platform.analytics.view`, `platform.analytics.export`,
`platform.admin_users.view`, `platform.admin_users.manage`, `platform.audit.view`,
`platform.system_health.view`) are enforced in the **service and API layers**, not only the UI.

## Why email is not used as ongoing authorization

`info@tamanor.com` (or any email) is **never** an authorization condition. There is no `user.email === "…"`
check anywhere. After the initial bootstrap, access is decided **only** by the persisted platform role, so
revoking a role takes effect immediately and no one can gain access by controlling an email string.

## Bootstrapping the initial `info@tamanor.com` owner (safely)

1. The user must **already exist** in the normal identity system (sign up / sign in first). Bootstrap never
   creates a user or handles a password.
2. Configure the email in local/server configuration **only**:
   ```
   TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL=info@tamanor.com
   ```
3. Run the explicit, operator-invoked, idempotent bootstrap (never runs at startup or via any HTTP route):
   - **Local (dev DB only):** `pnpm platform:bootstrap-owner` (uses `.env.local` + localhost — does **not**
     touch production).
   - **Production (the live site):** the `production`-gated **`platform-owner-bootstrap` GitHub Actions
     workflow** (`gh workflow run platform-owner-bootstrap.yml -f environment=production -f
     owner_email=info@tamanor.com -f confirmation=BOOTSTRAP_PLATFORM_OWNER --ref main`). See the
     [operations runbook](./operations-runbook.md) §1b (incl. the migration prerequisite).

   Either path normalizes the email, requires **exactly one** matching **existing** user, assigns `owner`,
   and **audits** the assignment. It fails safely if the env is unset (`no_env`), no user matches
   (`no_user`), or **multiple** users match (`ambiguous_users` — no silent elevation). It never creates a user.
4. After bootstrap, further administrators are added only by an existing **owner** through `/admin/administrators`.

Do not place real secrets or production credentials in the repository.

## Privileged-session security

- Platform authorization is **re-checked server-side on every request** (`requirePlatformAccess`), fresh from
  the DB — never trusted from the session.
- Sensitive mutations (add/remove admins, change roles, export analytics) require **recent authentication**:
  V1 uses **session freshness** (the session `createdAt` must be within `PRIVILEGED_FRESHNESS_MS` = 30 min).
  A stale session is rejected with `reauth_required`.
- Same-origin protection on all admin mutations; secure cookies use the existing production conventions; no
  session token in URLs; no sensitive data in client storage; no admin bypass in middleware.
- Successful and denied privileged access is **audited** with bounded, content-free metadata.

> **MFA / passkey (production hardening — NOT implemented in V1):** step-up re-authentication (re-entering a
> password or passkey) is a documented **required production hardening step** for `PLATFORM_OWNER` /
> `PLATFORM_ADMIN`. V1 uses session freshness as the recent-auth signal and **does not claim MFA is active**.

## Admin routes

`/admin`, `/admin/analytics`, `/admin/administrators`, `/admin/audit`. Each is server-guarded by its
capability; a denied user sees a **safe, non-enumerating** denial (the UI never reveals who is a platform
admin). The layout is a **visually distinct restricted-area shell** with a persistent audited-area warning.
There is no tenant selector that grants arbitrary tenant access.

## Administrator management

- Owner-only. Users must already exist; no password handling.
- The **last active owner cannot be removed or deactivated** (last-owner protection).
- No self-elevation / self-management (an owner cannot change or deactivate their own access).
- Optimistic concurrency (`expectedUpdatedAt`), recent-auth requirement, full audit trail, anti-enumeration.

## Incident response — compromised platform-admin account

1. An owner immediately **deactivates** the affected account (`/admin/administrators` → Deactivate), which
   revokes platform access instantly (role preserved for later review).
2. Rotate the user's normal credentials via the standard identity flow (out of scope here).
3. Review `/admin/audit` for the account's recent `admin_*`, `analytics.exported`, and access events.
4. If the last-owner is affected, add a second trusted owner first (bootstrap or an existing owner) so
   last-owner protection never blocks remediation.
5. Enforce the MFA/passkey production hardening before re-enabling elevated access.

See also: [privacy-analytics.md](./privacy-analytics.md), [analytics-metrics.md](./analytics-metrics.md),
[operations-runbook.md](./operations-runbook.md).
