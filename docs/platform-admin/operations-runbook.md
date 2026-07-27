# Platform Admin & Analytics — Operations Runbook V1

Operational procedures for Tamanor platform operators. Everything here is **local-only** in this environment;
never place production secrets or credentials in the repository.

## 1. Grant the first platform owner (`info@tamanor.com`)

1. Ensure the user has **signed up / signed in** (they must exist in the normal identity system).
2. Set the env var (local/server config only): `TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL=info@tamanor.com`.
3. Run: `pnpm platform:bootstrap-owner` (idempotent; audited; fails safely on no-user/ambiguous).
4. Confirm: sign in as that user and open `/admin`.

Alternatively, the low-level operational CLI `pnpm platform-role:set --email <e> --role <owner|admin|analyst|support|none> --confirm` can assign/remove any platform role directly (DB-access only; never an HTTP route).

## 2. Add / change / remove other administrators

Use `/admin/administrators` (owner-only). The user must already exist. The **last active owner is protected**;
you cannot change or deactivate **your own** access. Sensitive changes require a **recent sign-in**
(re-authenticate if prompted). All changes are audited (`/admin/audit`).

## 3. Analytics maintenance (aggregation + retention)

Run locally / manually, or invoke from a production scheduler (this sprint changes **no** scheduler config):
```
pnpm analytics:maintenance [--days 2]
```
- **Aggregation**: rebuilds daily aggregates for the recent window (idempotent).
- **Retention**: deletes raw events older than 90 days in bounded batches (aggregates are retained ≤ 24 months).
- Both are concurrency-safe and record an auditable run; analytics failures never affect customer requests.
- **Production scheduling**: invoke `analytics:maintenance` once daily (e.g. shortly after midnight UTC) via the
  existing job infrastructure. Do not add a new single-point-of-failure scheduler in this sprint.

## 4. Configure production analytics before activation

- Set `TAMANOR_ANALYTICS_HASH_KEY` (server-only keyed secret for visitor/session hashing; ≥16 chars).
- Wire a **country-only** GeoIP source into `deriveCountryFromIpTransient` (the IP stays transient).
- Update the public **privacy policy** (first-party analytics, rotating pseudonyms, retention, consent).
- Enforce the **MFA / passkey** production hardening for `PLATFORM_OWNER` / `PLATFORM_ADMIN`.

## 5. Emergency: compromised platform-admin account

1. An owner **deactivates** the account in `/admin/administrators` (access revoked instantly; role preserved).
2. If the last owner is affected, add a second trusted owner first (bootstrap / existing owner).
3. Review `/admin/audit` (filter by actor/action) for `admin_*`, `analytics.exported`, `access_denied`.
4. Rotate the user's normal credentials via the standard identity flow.
5. Re-enable only after MFA/passkey hardening.

## 6. Platform-admin offboarding checklist

- [ ] Owner deactivates the departing operator's platform access.
- [ ] Confirm they are not the last active owner (add a replacement first if so).
- [ ] Verify the audit trail records the deactivation.
- [ ] If they held `analytics.export`, review recent `analytics.exported` events.
- [ ] Remove the email from `TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL` config if it was set to theirs.

## 7. What operators can and cannot see

- **Can**: aggregated, privacy-safe website analytics; platform-admin audit; administrator list; collection/
  retention health.
- **Cannot**: customer messages, Child Safety incidents/signals, raw partner signals, tenant documents,
  private keys, full IP addresses, visitor/session identifiers, exact per-user timelines, or any tenant-private
  content. There is no impersonation and no cross-tenant customer-data browsing.
