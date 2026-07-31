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
`observability:test`, `cron-auth:test`. Exact commands + counts are in the final report.

**V1.1 checkpoint (second commit) — browser gate EXECUTED + Next.js patched.** The auto-download Playwright
suite is now **run**, not merely authored: **12/12 passed** (`public-auto-download` desktop + `public-auto-download-mobile`),
on a fresh production build with **Next.js 15.5.21**. Proven at runtime: zero download events on landing load, no
service worker registered, `/sw.js` + `/service-worker.js` return 404, no `a[download]`/meta-refresh/iframe,
core assets (`/`, manifest, robots, sitemap, favicon) correct MIME + never `Content-Disposition: attachment`,
and consent-banner interaction triggers no download — desktop and mobile. E2E-harness fix: `global-setup` now
**skips the DB-backed auth bootstrap for public-only runs** (pure, unit-tested `runNeedsAuthBootstrap` +
`e2e-global-setup-selection:test`), so the public gates run deterministically without a seeded fixture tenant;
authenticated projects still bootstrap.

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

Frozen lockfile OK; **no install lifecycle scripts; no non-registry deps.**

**V1.1 checkpoint (second commit) — advisories closed.** `pnpm audit --prod` went from **12 advisories (6 high /
6 moderate)** to **0**, and the full `pnpm audit` (incl. dev) is also **0**. Actions taken:
- **Next.js `15.5.20 → 15.5.21`** (exact patched 15.5 line; no major upgrade). Closed 8 of the 12; the lockfile
  delta is `next` + `@next/env` + the `@next/swc-*` binaries only.
- Remaining transitive highs bundled by Next were closed with the **smallest compatible patched overrides**
  (registry versions, not unsafe silencing): `postcss@<8.5.18 → >=8.5.18` (resolved 8.5.25 — closes
  GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-qx2v-qp2m-jg93; postcss is a build-time CSS tool over the
  project's own trusted CSS), `sharp@<0.35.0 → >=0.35.0` (resolved 0.35.3 — closes GHSA-f88m-g3jw-g9cj).
- A dev-only `brace-expansion@5.0.7` high (GHSA-mh99-v99m-4gvg, via eslint) closed with `→ >=5.0.8` (resolved
  5.0.9).
Every lockfile change is a legitimate transitive of these (nanoid via postcss; `@img/sharp-*` binaries); no
git/tarball deps, no new lifecycle scripts, no mass upgrade. `dependency-review.yml` + Dependabot keep these
current going forward. **No residual known critical/high/moderate in prod or dev.**

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
