# Production Security Hardening V1 — Release Provenance & Readiness

Companion to the [download-incident audit](./production-download-incident-audit.md). Closes the repository-side
findings and prepares operator runbooks for the provider-side actions. **No absolute-security claim is made.**
Blocked/deferred items are listed explicitly.

## Baseline

- Branch `main`, baseline commit `c7b4dfa8daec695ab0dae201a830926aaff52a82`.
- Scope: **local repository implementation + tests only.** No deploy, push, production migration/DB write, DNS
  change, secret access/rotation, or provider-account change was performed.

## Architecture (what was added)

- **Release provenance** — a pure resolver `@guardora/core` `release-provenance.ts` turns an explicit env object
  into sanitized, immutable metadata (environment, full 40-char SHA, ref, repo, deployment id/host, source,
  `provenanceValid`, stable error codes). Consumed by a **fail-closed build gate**
  (`apps/web/scripts/assert-production-release-provenance.ts`, wired into `apps/web` `build`) and an
  **authenticated route** `GET /api/platform/release` (`system_health.view` only).
- **Privacy-safe structured logger** — `redactDeep` (recursive, bounded, circular-safe) + `emitSafeLog` added to
  `@guardora/core` `observability.ts` (the single existing logging module; the legacy single-level `redact` is
  untouched). Integrated into the release route's invalid-provenance path.
- **CSP** — a typed canonical builder `@guardora/core` `csp-policy.ts` (enforced-parity + a strict Report-Only
  candidate with nonce + strict-dynamic). See CSP status below.
- **CI/CD governance** — sanctioned `production-deploy.yml`; all workflow actions pinned to commit SHAs;
  least-privilege `permissions:` on every workflow; `CODEOWNERS`; `SECURITY.md`; `dependabot.yml`;
  `dependency-review.yml`.
- **Regression gates** — `file-response-inventory.test.ts` (new attachment route ⇒ fail), `workflow-safety.test.ts`
  (unpinned action / missing env-gate ⇒ fail), and a Playwright `auto-download.spec.ts`.

## Changes

Added: `packages/core/src/{release-provenance,csp-policy}.ts`; `packages/core/scripts/{release-provenance,
log-redaction,csp-policy}.test.ts`; `apps/web/scripts/{assert-production-release-provenance(.test).ts,
file-response-inventory.test.ts,workflow-safety.test.ts}`; `apps/web/src/app/api/platform/release/route.ts`;
`apps/web/e2e/auto-download.spec.ts`; `.github/workflows/{production-deploy,dependency-review}.yml`;
`.github/{CODEOWNERS,dependabot.yml}`; `SECURITY.md`; `docs/security/*` runbooks.
Modified: `packages/core/src/{index.ts,observability.ts}`; `apps/web/package.json` (build gate), `playwright.config.ts`;
`apps/web/scripts/production-readiness.test.ts` (F-04 fixes); `apps/web/src/app/dashboard/billing/page.tsx` +
`components/dashboard/platform-owner-entry.server.tsx` (acknowledged-console markers); the evidence-export route
(`nosniff` added); all 7 existing workflows (pinned actions + permissions).

## Tests (green locally)

`release-provenance:test`, `release-provenance-gate:test`, `log-redaction:test`, `csp-policy:test`,
`file-response-inventory:test`, `workflow-safety:test`, `production-readiness:test` (rc=0), plus regression on
`observability:test`, `cron-auth:test`. Exact commands + counts are in the final report. **Deferred:** the full
Playwright e2e RUN (`pnpm e2e` — needs the `.next-e2e` production build + server) is not executed in this change.

## CSP status (honest)

**`'unsafe-inline'` is NOT closed.** The enforced production CSP is unchanged (no `unsafe-eval`, `object-src
'none'`, locked base-uri/form-action/frame-ancestors, explicit hosts, `unsafe-inline` retained for Next
hydration). A typed **strict Report-Only candidate** (nonce + strict-dynamic, no `unsafe-inline`) exists in
`csp-policy.ts`. **Enforcing it requires** a nonce threaded via middleware to the inline `<Script>` components
(gtag/meta), which opts the layout into dynamic rendering — evaluate against caching/latency/cost first (Option
B: keep enforced, roll out Report-Only, then flip only with browser evidence). The `csp-policy:test` guards
against wildcard drift and asserts parity with `next.config.mjs`.

## Provenance status

The gate enforces only on a real deploy (`VERCEL_ENV` set, or `APPROVED_CI_RELEASE=true`) — local `NODE_ENV=
production` builds stay usable. To make it effective in production the operator must either use **Vercel Git
integration** (populates `VERCEL_GIT_COMMIT_SHA`) or the `production-deploy` workflow (arms approved-CI
provenance). Repo/branch pinning is opt-in via `EXPECTED_RELEASE_OWNER/SLUG/REFS` (defaults: slug `Tamanor`, ref
`main`). **Today production deploys are unattested CLI deploys** — adopting one of these sources closes gap G-1.

## Observability / DNS / Access / Signing status

All **PREPARED, NOT ACTIVATED** — see the runbooks: [observability & retention](./production-observability-and-log-retention.md),
[DNS/TLS](./domain-dns-tls-hardening.md), [access review](./production-access-review.md), [signing & release
integrity](./commit-signing-and-release-integrity.md).

## Supply chain

Frozen lockfile OK; **no install lifecycle scripts; no non-registry deps.** `pnpm audit --prod` reports **12
advisories (6 high / 6 moderate)** against `next@15.5.20` and its transitive `postcss`/`sharp` (GHSA-955p-x3mx-jcvp
et al.). **Not bumped in this change** (a framework update needs the full e2e + regression pass — "update only
scoped, tested packages"). Recommended follow-up: a scoped Next.js patch update in its own PR, gated by
`dependency-review.yml` + Dependabot (both added here). **Residual risk until then.**

## Branch-protection operator instructions (repo settings — not in code)

On `main`: require a PR (no direct push); require ≥1 review + **Code Owners** review; **dismiss stale approvals**
on new commits; **required status checks** = CI (typecheck/lint/build) + `dependency-review` (and, once wired,
the security suite); **require conversation resolution**; **no force-push / no deletion**; restrict who can
deploy via the `Production` Environment (required reviewers); minimal admin-bypass; enable **signed commits only
after** bot/CI identities can sign (see signing plan).

## Rollback

- Repo changes: revert the single hardening commit (docs + tests + gate) — no runtime behavior of shipped product
  changed except two comment-only markers, one `nosniff` header, and the build now runs a (locally no-op)
  provenance gate.
- The gate cannot block a legitimate local build (not enforced off-Vercel). If it ever false-blocks a real deploy
  (unexpected slug/ref), set `EXPECTED_RELEASE_SLUG=""`/`EXPECTED_RELEASE_REFS=""` to relax repo/ref pinning while
  keeping the SHA requirement, or investigate the missing Git metadata.

## Activation sequence (NO activation performed now)

1. Review this local commit; owner-approved **push**.
2. Configure the GitHub **`Production` Environment** + required reviewers; add `VERCEL_TOKEN`/`VERCEL_ORG_ID`/
   `VERCEL_PROJECT_ID` secrets; apply branch protection above.
3. Enable **Vercel Git integration** (or use `production-deploy`) so builds carry a commit SHA; expose the Vercel
   system vars; set `EXPECTED_RELEASE_*`.
4. Configure/verify the **log drain** (observability runbook); confirm a redacted test receipt.
5. Verify Vercel **Root Directory = `apps/web`**.
6. Run an **approved exact-SHA deploy** via `production-deploy`.
7. Confirm the **running SHA** (`/api/platform/release`) equals the attestation SHA.
8. `/api/ready` healthy; CSP/security headers present.
9. Clean-browser **no-download** check (desktop + mobile) — `pnpm e2e` `public-auto-download*` and a manual pass.
10. Family canary action; capture a **redacted log receipt**.
11. Apply DNS/TLS hardening (CAA after issuer verification); access review.
12. Observe; then mark **activated**.
