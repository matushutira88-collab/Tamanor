# Production Unsolicited-Download — Security Audit (Read-Only / Forensic-First)

> **Status: UNRESOLVED.** Comprehensive production security audit completed to the available evidence
> boundary. The unsolicited-download report remains unresolved; **no safety claim is permitted until the exact
> URL, artifact and production-log timeline are correlated.** The **static repository audit and the safe live
> header probe found NO Tamanor-originated mechanism that triggers an automatic download**, but the incident
> intake data (exact URL, artifact, browser/OS, timeline) and live provider logs were unavailable, so a
> Tamanor origin cannot be *fully* excluded and an external origin cannot be *fully* confirmed.
>
> **Update — Part III (CONFIRMED incident date `2026-07-18`, URL `https://www.tamanor.com/`):** The previously
> broad estimated window (07-14 → 07-20) is **superseded** by the confirmed local day **2026-07-18 CEST**
> (= 2026-07-17 22:00 → 2026-07-18 22:00 UTC). A read-only Vercel + Git reconstruction enumerated **~19 production
> deployments that served `tamanor.com` on 07-18** (the alias churned ~19 times that day), **all** correlating by
> second-accurate timestamp to 07-18 `main` commits **present in the trusted repo**, **none** to a non-repo SHA.
> **Every 07-18-served build was download-free at the code level:** no service worker, no `createObjectURL`/blob,
> no `download` anchor/synthetic click, no meta-refresh, no auto-`Content-Disposition`, no manifest/PWA download,
> no user-agent-conditioned serving; `public/` held only images; the only external scripts were GTM/Meta/Turnstile.
> Notably **no download-capable route existed on 07-18 at all** (CSV/evidence export routes were added 07-21). It
> does **not** prove runtime safety: deployments carry **no commit-SHA attestation** (CLI deploys), immutable
> 07-18 URLs are **SSO-gated**, and **07-18 runtime logs are expired**. **Verdict remains UNRESOLVED; leading,
> strengthened hypothesis: origin external to Tamanor.** See Part III below (Part II retained as corroborating
> wider-window context).
>
> **Disposition & handling:** This is an **internal security record**. Based on all repository-side and read-only
> live evidence, **no site takedown, no deployment rollback, and no mass secret rotation is indicated**; production
> may remain online while the residual runtime-evidence gap is closed. The two decisive missing items are the
> **downloaded artifact (SHA-256 + magic bytes)** and the **affected browser's** service-worker/extension state.
> **Sanitization (V1):** the provider account slug, internal deployment IDs, IP addresses, the GitHub owner slug,
> and the developer's personal name have been genericized in this document; no tokens, cookies, secret values, DB
> URLs, sensitive query strings, or child data are present. The confirmed-date reconstruction evidence (short
> deployment slugs, timeline, correlated SHAs, verdict) is preserved intact.
>
> **No changes were made.** No deploy, migration, DB write, DNS change, secret read/rotation, rollback, commit,
> or push was performed. All live actions were read-only (HTTP `HEAD`/header probes, `dig`, `openssl`).

Audit date: 2026-07-31 · Repo baseline: `c7b4dfa` (== `origin/main`) · Trusted code SHA at audit: `c7b4dfa`.

---

## 1. Executive summary

A user reported that opening the Tamanor production site apparently caused the browser to auto-download a
file. Treated as a potential security incident. Within the **tested scope** — full static repository forensics
plus a safe read-only live header probe of the production apex and common paths — **no code path, header, route,
service worker, or third-party script was found that initiates a file download on page load or without user
action.** The production landing page serves correctly (`text/html`, `content-disposition: inline`, `nosniff`).
Git history, dependencies, CI/CD, and the DNS/TLS chain show **no compromise indicators**.

The report is nonetheless **UNRESOLVED** because the decisive evidence is missing: the **exact incident URL**,
the **downloaded artifact** (hash/magic-bytes), the **client environment** (browser/OS/extensions/incognito),
and **live production logs** (Vercel/Supabase) were not available to this audit. The **leading hypothesis is an
origin external to Tamanor** (browser extension / adware / PUP, or a non-`tamanor.com` link), but this cannot be
asserted as fact until the artifact and the exact-URL live response are examined.

**No CRITICAL or HIGH findings.** Minor defense-in-depth items (CSP `unsafe-inline`, unpinned GitHub Actions, no
CAA record) and pre-existing non-incident test failures are recorded below.

## 2. Incident classification

Potential client-side unsolicited-download incident on production `tamanor.com`. Current classification:
**UNRESOLVED / most-likely-external, pending artifact + exact-URL + log correlation.** Not confirmed as a
Tamanor-originated download; not confirmed benign.

## 3. Evidence and missing evidence

**Available (this audit):** full repo working tree at `c7b4dfa`; git history/integrity; CI/CD workflows;
dependency manifests + lockfile; `next.config.mjs`, `middleware.ts`, `vercel.json`; safe live header probes of
`tamanor.com` (apex, www, manifest, robots, sitemap, favicon, sw.js); read-only DNS + TLS.

**Missing (blocks resolution) — all marked `unknown`, not guessed:**
| Item | Status |
|---|---|
| Exact incident URL (path/subdomain/query) | **unknown** |
| Local time + timezone of the event | **unknown** |
| OS + version, browser + version, normal/incognito | **unknown** |
| Active browser extensions | **unknown** |
| Whether user was logged in | **unknown** |
| Downloaded filename / extension / size | **unknown** |
| Browser-reported source URL of the download | **unknown** |
| Whether download began without a click | **unknown** |
| Whether the file auto-opened / AV alert fired | **unknown** |
| SHA-256 + magic bytes of the artifact | **unknown** (see §6 — cannot classify without it) |
| Reproducibility / other affected users | **unknown** |
| Vercel access/build/deploy logs, env-change history | **unavailable (no live provider access)** |
| Supabase auth/DB/storage logs | **unavailable** |
| Actual deployed production SHA (dashboard) | **unavailable** (trusted `origin/main` = `c7b4dfa`) |
| Browser-side service-worker / cache state | **unavailable** (needs the affected browser) |

## 4. Exact deployed SHA / project / domain

- **Vercel project:** `tamanor-web` (linked at repo root, `.vercel/project.json`).
- **Production apex:** `https://tamanor.com`; `www.tamanor.com` 308-redirects to apex (matches
  `next.config.mjs` canonical-host redirects); `guardora.ai`/`www.guardora.ai` configured to redirect to apex.
- **Server:** `Vercel` (response header). **A** `<Vercel-anycast-IP redacted>` (Vercel anycast); **www** CNAME
  `…vercel-dns-017.com`; **NS** `ns1/2/3.websupport.sk`. **TLS:** Let's Encrypt, `CN=tamanor.com`, valid
  2026-07-16 → 2026-10-14.
- **Trusted code SHA:** `origin/main == HEAD == c7b4dfa`. **Actual live deployed SHA: unknown** (requires the
  Vercel dashboard — a blocked, live-only check). No evidence of an unexpected/preview promotion was found in
  the repo, but this can only be *confirmed* against the dashboard.

## 5. Timeline

**Not reconstructable** from available evidence — the incident time and the production logs are both unknown/
unavailable. The only datable facts are repo commits (latest `c7b4dfa`, a docs-only commit) and the TLS cert
window. **Log correlation is a required, currently-blocked step.**

## 6. Artifact classification

**Impossible without the artifact.** Do not infer type from the extension. Required (operator, safe): compute
SHA-256 without opening; read the first magic bytes to distinguish HTML / JSON / PDF / ZIP / image / Windows PE
(`MZ`) / Mach-O / ELF / unknown; run a local trusted AV/EDR scan. Do **not** upload to public scanners if it may
contain personal/confidential data.

## 7. Reproduction

**Not yet attempted** (requires the exact URL + a disposable VM/fresh browser profile). Passive audit was
completed first, per protocol. Prescribed when the URL is known: disposable VM, fresh no-extension profile,
ask-before-download, DevTools "preserve log" + network (HAR) capture, same OS/browser family, test anonymous +
(only if necessary) a canary login, and a `curl` of the exact URL with the reported source origin. Preserve HAR,
initiator chain, headers, final URL, service-worker state, and the artifact hash. No real child/customer data.

## 8. Git / repository

Read-only (`git status/log/rev-parse/fsck/show-signature`):
- `HEAD == origin/main == c7b4dfa`; **clean tree**; **no divergence**, **no unpushed commits**.
- Last 30 commits: **single author** (the repository owner), coherent feature history; **no unknown authors**, **no
  force-push/rewrite indicators**, `git fsck` reported no corruption.
- Commits are **unsigned** (`%G? = N`) — consistent across all history (no GPG signing configured); not an
  anomaly, but see remediation (enable signing).
- Remote is `github.com/<github-owner>/Tamanor` over HTTPS; **no token embedded** in the remote URL.
- **No** non-registry (git/tarball/url) dependencies; **no** `.npmrc`/registry override; **no** pnpm
  overrides/patches; **no** install lifecycle scripts (`preinstall`/`postinstall`/`prepare`) in any workspace
  manifest; **no** runtime shell-exec (`child_process`/`curl`/`wget`/`eval`) in app source.

## 9. Deployment

- Project/domain/region consistent (`tamanor-web`, `tamanor.com`, `fra1`). Effective cron config in
  `apps/web/vercel.json` = 4 jobs (meta-dispatch, webhook-retry, maintenance, family-notifications) — none
  serves downloadable content.
- **Blocked/live-only:** actual deployed SHA, creator/trigger/time, build & runtime logs, env-var change
  history, deploy hooks, preview-promoted-to-prod check, Root-Directory confirmation, access roles. These
  require the Vercel dashboard and were **not** inspected. No repo-side evidence of anomaly.

## 10. DNS / TLS

- **A** `<Vercel-anycast-IP redacted>` (Vercel anycast) · **www** CNAME → `…vercel-dns-017.com` · **NS** `websupport.sk` ·
  **TLS** Let's Encrypt `CN=tamanor.com` (valid). Chain is internally consistent → **no hijack/takeover
  indicators** in the visible data.
- **Finding F-03 (INFO):** no **CAA** record present (issuance not restricted to a chosen CA).
- **Not checked (tool/live limits):** registrar lock, DNSSEC, Certificate-Transparency logs for unexpected
  certs, dangling/wildcard subdomains. Recommended as operator follow-ups.

## 11. HTTP / headers (safe live probe)

`tamanor.com` (Chrome UA) → **HTTP 200**, `content-type: text/html; charset=utf-8`,
`content-disposition: inline`, `x-content-type-options: nosniff`, CSP present, HSTS present,
`x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`. `www` → 308 → apex (clean).
Common paths (iPhone-Safari UA): `/manifest.webmanifest` → `application/manifest+json`; `/robots.txt` →
`text/plain`; `/sitemap.xml` → `application/xml`; `/favicon.ico` → `image/x-icon`; **all `inline`, none
`attachment`, none `octet-stream`**. `/sw.js` and `/service-worker.js` → **404** (no SW served by current prod).
→ **No download-forcing header (`attachment` / wrong-MIME + `nosniff`) was observed on any safely-probed URL.**
The **exact incident URL / authed routes were not probed** (unknown) and remain the gap.

## 12. Download code (auto-trigger search)

Repo-wide search (excl. `node_modules/.next/dist/coverage`) for
`createObjectURL/revokeObjectURL/.download/download=/window.open/location.(href|assign|replace)/serviceWorker/`
`importScripts/CacheStorage/atob/eval/new Function/WebAssembly/arrayBuffer/.blob/Content-Disposition/attachment`
plus synthetic-anchor-click, `meta refresh`, `iframe`, `srcDoc`, `data:`/`javascript:`/`blob:` URLs, and binary
asset links (`.apk/.exe/.dmg/.pkg/.msi`):
- **No** programmatic anchor+`click()` download, **no** `createObjectURL`/blob download, **no** synthetic
  navigation to a file, **no** `meta refresh`/`iframe`/`srcDoc`, **no** `data:`/`javascript:`/`blob:` URLs,
  **no** binary-asset links, **no** `eval`/`new Function` in shipped client code.
- The only `Content-Disposition: attachment` emitters are **server API export/evidence routes**, all reached by
  an explicit user `<a href>` click — **never on initial load/hydration** (see §13). Classification: **legitimate
  + user-initiated**.

## 13. Routes / MIME

61 API route handlers. Six emit downloadable/inline file content — all **auth-scoped**:
| Route | Guard | Disposition |
|---|---|---|
| `api/export` (tenant CSV) | `requireSession` + `ReportView` permission + RLS tenant scope | `attachment` `text/csv` |
| `api/platform/analytics/export` | session + emailVerified + platform-role (403) | `attachment` `text/csv` no-store |
| `api/v1/child-safety/reviewer/analytics/export` | reviewer actor | `attachment` |
| `…/reviewer/incidents/[id]/evidence/export` | reviewer actor | `attachment` |
| `…/reviewer/evidence/[id]/download` | reviewer actor (403) | `attachment` + `nosniff` |
| `…/reviewer/evidence/[id]/preview` | reviewer actor (403) | `inline` + `nosniff` |

All are click-initiated, tenant/role-scoped, and not reachable anonymously → **not an auto-download vector and
not an anonymous data-exfil surface**. Evidence preview serves stored bytes **inline + nosniff** to authorized
reviewers only (acceptable).

## 14. Service worker

**None.** No SW source in repo, no `next-pwa`/`workbox`/`serwist` dependency, no `serviceWorker.register`, empty
`public/`, and current production returns **404** for `/sw.js` + `/service-worker.js`. Only a benign Next.js
`manifest.ts` (web app manifest, no SW). **Residual, live-only:** a service worker registered in the *user's*
browser by a *past* deployment cannot be excluded from the repo/current-prod alone — verify in the affected
browser (DevTools → Application → Service Workers; `chrome://serviceworker-internals`). Do **not** mass-unregister
before capturing state.

## 15. Third-party / XSS

Runtime external scripts (only three, all env+consent gated, CSP-allowlisted):
- **Cloudflare Turnstile** `challenges.cloudflare.com/turnstile/v0/api.js` (bot check; login/registration).
- **Google gtag.js** `googletagmanager.com/gtag/js` (GA4 / Google Ads) — **not** a full GTM container.
- **Meta Pixel** `connect.facebook.net/en_US/fbevents.js`.
All load `afterInteractive`, render nothing unless a `NEXT_PUBLIC_*` id is configured, and enforce Consent
Mode v2 (all denied by default). **XSS sinks:** no `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/
`document.write`/`DOMParser` in app source. Content-free enforcement denylists in `@guardora/core` block raw
message/attachment/filename fields → stored-XSS-to-download via DB content is not a supported path.
- **Finding F-02 (LOW):** production CSP uses `script-src 'unsafe-inline'` (documented follow-up: nonce +
  `strict-dynamic`). It has **no `unsafe-eval'`, `object-src 'none'`, `base-uri/form-action 'self'`,
  `frame-ancestors 'none'`. `unsafe-inline` weakens XSS defense-in-depth but is not itself the download vector.
- **Hypothesis H4 (LOW):** a compromised GA/Google-Ads/Meta **account** could push a malicious tag. gtag.js/
  fbevents are measurement libraries (not an arbitrary-tag GTM container) under a restrictive host allowlist, so
  a download via them is unlikely — but account security + a live network capture should confirm.

## 16. Supply chain

Clean: no install lifecycle scripts, no `.npmrc`/registry override, no overrides/patches, no non-registry deps,
no runtime shell-exec. `pnpm audit` / `licenses` were **not** run offline in this pass (network-dependent) —
recommended as a follow-up in a disposable environment with `--ignore-scripts`.

## 17. CI/CD

Seven workflows. **No `pull_request_target` and no `workflow_run`** (the two high-risk triggers). Production
workflows are `workflow_dispatch`-only, gated behind the GitHub `Production` Environment with reviewers, and
never print secrets. **Finding F-01 (LOW):** actions are pinned to floating major tags (`actions/checkout@v4`,
`pnpm/action-setup@v4`, `actions/setup-node@v4`) rather than full commit SHAs — low risk (all first-party) but
SHA-pinning is best practice.

## 18. Secrets / access

Static presence only (no values ever read/printed). `CRON_SECRET`, `DATABASE_URL`/`APP_DATABASE_URL`,
`AUTH_SECRET`, `TOKEN_ENCRYPTION_*`, Stripe/Meta/Google/Resend/Turnstile keys are referenced by **name** in code
and expected as Vercel env vars. No secret was found committed in the working tree, and no token is embedded in
the git remote. **Not verifiable here (blocked):** provider access-history, membership/role changes, secret in
git *history* / build logs / client bundle / source maps, `NEXT_PUBLIC_` misuse audit, and access reviews for
GitHub/Vercel/Supabase/Stripe. No rotation is indicated by current evidence; none was performed.

## 19. DB / storage

**Not accessed** (read-only, no aggregate queries run against production). Static review of the download-capable
paths (§13) shows filenames/MIME originate from server-side evidence services with reviewer auth, not from
unauthenticated user-controlled input on a public page. Supabase Storage bucket policies / public-bucket audit
is a **blocked, live-only** follow-up. No child-safety content was read.

## 20. Logs

**Unavailable.** Vercel access/edge/function/build logs, deployment events, WAF, GitHub audit, Supabase logs,
and app ops telemetry were not accessible. Correlating the exact incident timestamp against a 3xx chain /
`Content-Disposition` / binary MIME / unexpected path / multi-user spike / new deployment / config change is the
**single most important blocked step** to move from UNRESOLVED to a verdict.

## 21. Auth / redirect

204 `redirect()`/`NextResponse.redirect` usages sampled; the dynamic-target matches are all
`new URL("/login" | "/dashboard/accounts?…", req.url)` — **static internal paths** (req.url used only as the
resolution base). No external/open redirect and no user-controlled `returnTo`/`next` open-redirect found in the
sample. `next.config.mjs` canonical redirects target only `https://tamanor.com`. Full open-redirect fuzzing of
auth/callback params is a recommended local/test follow-up (not run against production).

## 22. Root cause / ranked hypotheses

| # | Hypothesis | Likelihood | Basis / next check |
|---|---|---|---|
| H1 | **External to Tamanor** — browser extension/adware/PUP, or the download came from a non-`tamanor.com` link (search result/email/social) attributed to the site | **Leading** | Clean apex serving (`text/html`+`inline`+`nosniff`), clean code, no SW, no auto-download path. Confirm with the artifact + browser extension list + the download's real source URL. |
| H2 | A **specific unprobed URL / authed route / asset** mis-serves `Content-Type` (or sends `attachment`/octet-stream) and forces a download | Low–Med | Needs the **exact incident URL** → `curl -I` it (Content-Type vs magic bytes). |
| H3 | **Stale service worker** in the user's browser from a past deploy serving/rewriting content | Low | Current prod serves no SW; verify in the affected browser, then unregister safely. |
| H4 | **Compromised third-party tag account** (GA/Google Ads/Meta) injecting a download | Low | gtag.js/fbevents under restrictive CSP; audit account security + live network/initiator capture. |
| H5 | **Deploy/domain compromise** (unexpected SHA / preview promoted / domain reassigned) | Very Low | DNS→Vercel, cert valid, git clean; fully exclude via the Vercel dashboard (deployed SHA + domain + env history). |

## 23. Scope / time window

Unknown — depends on the incident timestamp and whether other users are affected (both `unknown`). No repo/live
evidence of a multi-user event was available. Determine via logs once the time window is known.

## 24. Findings by severity

**Critical:** none. **High:** none.
- **F-01 (LOW, confirmed):** GitHub Actions pinned to floating `@v4` tags, not SHAs. *Fix:* pin to full commit
  SHAs. *Not incident-related.*
- **F-02 (LOW, confirmed):** CSP `script-src 'unsafe-inline'`. *Fix:* nonce-based `strict-dynamic` via
  middleware (already the documented follow-up). *Defense-in-depth.*
- **F-03 (INFO, confirmed):** no DNS **CAA** record. *Fix:* add a CAA record restricting issuance.
- **F-04 (LOW, confirmed, pre-existing, non-incident):** `production-readiness.test.ts` fails 3 assertions —
  `#23` `console.log` in `dashboard/billing/page.tsx`, `platform-owner-entry.server.tsx`,
  `server/diagnostics/login-trace.ts`; `#30` a `dashboard` `loading.tsx`; `#33` `window.location.pathname`
  **read** in `dashboard/error.tsx` (**false positive** — diagnostics only, no navigation/download) — plus a
  stale `ENOENT` for a removed `landing-v2/footer-v2.tsx`. *Fix:* strip stray `console.log`, update the stale
  test path; `#33` is safe as-is. *Not a download vector.*
- **INFO:** commits unsigned (no GPG); enabling signing improves provenance.

## 25. Containment proposal

**No confirmed compromise → no emergency containment is warranted by current evidence.** Preserve all evidence.
Containment is triggered **only** if a live check confirms one of: executable/installer auto-download; download
without user action; malicious third-party script; stored XSS; unknown deployed SHA; unauthorized deploy/domain
reassignment; malicious service worker; DNS hijack; public same-origin active HTML/SVG/executable; cross-tenant
leak; multiple affected users. **If confirmed, after approval, in order:** preserve logs/deployment evidence →
freeze deploys → disable the compromised integration/hook → revert domain to last known-good or maintenance mode
→ disable the affected route/script → safely invalidate malicious cache → revoke compromised access → rotate
secrets in dependency order → verify DB/storage integrity → deploy a focused tested fix → monitor. **Never delete
outbox/audit/incident/consent/notification/child-safety data.**

## 26. Remediation proposal (post-approval, none applied)

1. Complete the **live gap**: obtain the artifact (hash/magic-bytes/AV), the exact URL, and correlate Vercel/
   Supabase logs to the timestamp (closes UNRESOLVED). 2. Check the affected browser for a **stale SW** +
   extensions. 3. Confirm the **deployed SHA / domain / env history** in the Vercel dashboard. 4. Defense-in-depth
   (not urgent): CSP nonce/`strict-dynamic` (F-02), SHA-pin actions (F-01), add CAA (F-03), remove stray
   `console.log` + fix the stale test (F-04), enable commit signing.

## 27. Verification

Non-production green gate (this audit): `child-safety-evidence-ui` **22/0 PASS** (download nosniff+attachment
safety), `family-notifications-source` **93/0 PASS** (no ws/polling/eval in UI). `production-readiness` **exit 1**
— pre-existing failures F-04 (non-incident). `typecheck`/`lint`/`build` were `rc=0` on this exact code tree in
the immediately-preceding task (only uncommitted docs changed since). Exact commands + exit codes recorded in the
session transcript.

## 28. Rollback

**Not recommended.** No defective or unauthorized deployment was identified; `origin/main` (`c7b4dfa`) is clean.
A rollback would be justified only if the Vercel dashboard reveals an unexpected deployed SHA or a
preview-promoted-to-production, or a live check confirms malicious served content — none observed in scope.

## 29. Residual risks

The exact incident URL, the artifact, and live logs are unexamined; a Tamanor origin is **not fully excluded**
(H2–H5 remain open at low likelihood). A stale browser-side service worker and third-party-account compromise are
only closable with browser + account access. CSP `unsafe-inline` leaves an XSS defense-in-depth gap.

## 30. Limitations

Read-only, forensic-first. No browser automation (the ECC/Chrome DevTools MCP tools are disconnected this
session), no Vercel/Supabase dashboard or log access, no incident intake data, and the downloaded artifact was
never in scope. Live probing was limited to safe HTTP `HEAD`/header requests, `dig`, and `openssl` against the
public apex + common paths. Authenticated routes, subdomains, and the exact incident URL were not probed.

## 31. Operator decisions required

1. Provide the **incident intake** (§3): exact URL, time+TZ, OS/browser/version, incognito?, extensions,
   logged-in?, and the download's browser-reported source URL. 2. Provide the **artifact** metadata (path, size,
   times) + **SHA-256** + first magic bytes (do not open/upload). 3. Authorize **read-only log access**
   (Vercel/Supabase/GitHub audit) for timeline correlation. 4. Decide whether to **keep production online**
   (recommended — no static/live evidence requires takedown) while the live gap is closed. 5. Approve (or not)
   any containment/remediation — **nothing will be changed, committed, pushed, deployed, rotated, or DNS-altered
   without explicit approval.**

---

### Appendix — commands run (all read-only)
`git status/branch/rev-parse/log/show-signature/fsck/diff/rev-list`; `rg`/`grep` code searches;
`find`/`node -e` manifest inspection; `curl -sSIL`/`curl -sSI` header probes (no body saved);
`dig +short A/AAAA/NS/CAA/CNAME`; `openssl s_client | x509 -noout`. No write, deploy, migration, DB, DNS, or
secret operation was performed.

---

# Part II — Historical Production Reconstruction (incident window 2026-07-14 → 2026-07-20, Europe/Bratislava)

Added after the observation that **the current deployment is not the one that served during the incident**:
`tamanor.com` has been re-deployed many times since. Incident URL confirmed as **`https://www.tamanor.com/`**
(308 → apex). This part reconstructs what actually served production during the window. **Still read-only; nothing
changed; main preserved at `c7b4dfa`.** Vercel access was read-only via the already-authenticated CLI
(account `<owner-account>`, project `tamanor-web`); no promote/rollback/deploy/alias/secret/DNS action taken.

## II.1 Vercel deployment & alias history

- **Project / owner:** `tamanor-web` under personal team `<owner-account>'s projects`. **Current** production
  alias `tamanor.com` → deployment **`tamanor-gdyk5xmsl`** (`<deployment-id redacted>`), created
  **2026-07-29 13:47 +02** — i.e., production has moved **past** the incident window.
- **Deployments carry NO Git metadata.** Every production deployment inspected has empty `meta`
  (`githubCommitSha`/`githubCommitRef`/`author` = null; top-level keys `id,name,url,target,readyState,createdAt,`
  `aliases,builds,contextName`). → These are **`vercel deploy --prod` CLI / prebuilt deploys, not Git-integration
  deploys.** **Vercel never recorded which commit SHA each deployment was built from.** Consequently the deployed
  SHA can only be **inferred by timestamp correlation** with the local repo — **not cryptographically confirmed
  from Vercel** (evidence gap G-1).
- **Retention gap (evidence gap G-2):** the **oldest retained** production deployment is **~2026-07-17 12:41 UTC
  (14:41 +02)**. Queries for production deployments before ~07-17 14:41 return **nothing** — Vercel no longer
  retains deployment records for **2026-07-14 00:00 → ~2026-07-17 14:41**, roughly the **first half of the incident
  window**. That sub-period is reconstructable from Git only, not from Vercel.
- **Cadence:** very high — all CLI production deploys by the owner account. Sampled `created` timestamps (UTC):
  `07-17 12:41, 12:44, 13:02, 13:03, 13:06 … 19:19, 19:34, 19:52, 20:34, 21:06, 21:16`, `07-18 16:47`,
  `07-20 16:39`. ~20 production deploys in the 07-17 evening alone. All `target=production`; none was a
  preview-listed deploy; creator = the owner account.
- **Alias-serving intervals** are inferred as `[created_N, created_{N+1})` on the retained set (the production
  alias always points to the most recent Ready production deployment). Exact historical alias-assignment
  timestamps are **not exposed by the CLI** (evidence gap G-3); no manual rollback was observed but cannot be
  excluded for the unretained sub-period.

### Representative production-serving timeline (retained portion; SHA = timestamp-correlated, not Vercel-attested)
| Deployment | Created (UTC) | Approx. serving interval | Correlated git HEAD (±build lag) |
|---|---|---|---|
| *(none retained)* | 07-14 00:00 → ~07-17 14:41 | first half of window | `f5e4b05`(07-14 08:20) … through `~092e069`(07-17 15:24) — **Git-only, no Vercel record** |
| `tamanor-fjll0zw72` | 07-17 12:41 | 07-17 12:41 → 12:44 | ~`a84a8a3`/`aaefd0c` (07-17 ~11–12) |
| `tamanor-mzpd522y5` | 07-17 13:06 | 07-17 13:06 → … | ~`0e90a78`/`092e069` (07-17 15:xx) |
| `tamanor-8r32tmvu8` | 07-17 19:19 | 07-17 19:19 → 19:34 | ~`578421d`/`df1fd18` (07-17 19:0x–19:51) |
| `tamanor-pwqbihy8c` | 07-17 21:16 | 07-17 21:16 → 07-18 16:47 | ~`ab5266b`/`751a9f6` (07-17 21:1x cron fixes) |
| `tamanor-ztvnlrzxt` | 07-18 16:47 | 07-18 16:47 → 07-20 16:39 | ~`73df869`/`f8b2fda` (07-18) → `e3f668f` (07-20) |
| `tamanor-89mj3hmtn` | 07-20 16:39 | 07-20 16:39 → next prod deploy | ~`3419599`/`e3f668f`/`bcda65e` (07-20 18:3x) |

All correlated SHAs are **present in the trusted repo** (verified `git cat-file -e`), single author
the repository owner, clean linear history, `git fsck` clean, no force-push/rewrite indicators. **No deployment
correlated to a SHA absent from the trusted repository.**

## II.2 Historical configuration (window)

- **Root Directory / build:** monorepo builds `@guardora/web` (`apps/web`); `vercel.json` lives in `apps/web/`.
  Framework Next.js; region `fra1`. (Live Root-Directory setting is a dashboard value not dumped here; the crons
  did register historically, consistent with `apps/web` root.)
- **Effective `vercel.json` @ end-of-window (`972a239`):** three crons only — `meta-dispatch`, `webhook-retry`,
  `maintenance`. **No download/file route; no family-notifications cron yet** (added post-window).
- **Middleware / redirects:** `next.config.mjs` canonical redirects → `https://tamanor.com` only; no external
  redirect. Security-header block already present in-window (see II.3).
- **Env-var change timestamps:** not retrievable read-only via CLI without dashboard audit access (evidence gap
  G-4); names unchanged in code across the window (analytics ids gate the third-party scripts).
- **Analytics integrations:** GTM/gtag added `07-15` (`b9978df`), Meta Pixel present, Turnstile CSP-allowlisted
  `07-20`. No other vendor at any point.

## II.3 Historical source reconstruction (Git — authoritative for served code)

Window commits: **`f5e4b05` (07-14 08:20) → `972a239` (07-20 22:33)**, boundary-confirmed (`1bcb080` last before,
`167d957` first after). Method: full-window **pickaxe** (`git log -S/-G`, 2026-07-13→07-21) + an **isolated
detached worktree at `972a239`** (end-of-window) inspected **without installing dependencies** (no untrusted
lifecycle scripts run), + cross-SHA `git grep`/`git show`.

- **Auto-download / SW / risky mechanism — did it EVER exist in the window?** Pickaxe count of commits that
  added/removed each pattern across 07-13→07-21: `serviceWorker 0`, `service-worker 0`, `navigator.serviceWorker
  0`, `workbox 0`, `next-pwa 0`, `createObjectURL 0`, `msSaveOrOpenBlob 0`, `.download = 0`,
  `setAttribute("download" 0`, `importScripts 0`, `eval( 0`, `meta http-equiv 0`, `http-equiv="refresh" 0`,
  `window.open( 0`, `location.(href|assign|replace)= 0`. **`Content-Disposition`: 1** — the auth-scoped CSV
  export (`Release B/B3`, landed `07-21`, just after the window). → **No auto-download mechanism existed in any
  deployed commit during the window.**
- **End-of-window snapshot (`972a239`):** download/auto-trigger source search **clean** (only a read-only
  `new URL(window.location.href)` in the analytics marker); **no service-worker/PWA files**; `public/` contained
  **only 13 `humans/*.png` portraits** (no HTML/binary/executable/archive — nothing auto-downloadable); the three
  external scripts were exactly **GTM + Meta Pixel + Turnstile**; security headers (CSP, `X-Content-Type-Options:
  nosniff`, HSTS, XFO) already present (4 directives); **no `attachment`/`Content-Disposition` in the header
  config**.
- **Early-window (`f5e4b05`, 07-14):** even fewer client scripts (analytics not added until 07-15). External
  hosts referenced across the window were only Google/Meta **OAuth/connector** endpoints (`accounts.google.com`,
  `oauth2.googleapis.com`, `graph.facebook.com`, …) + GTM + Meta Pixel + Turnstile + IndexNow (server-side SEO).
  **No unknown/rogue vendor, ad host, or CDN at any point.**
- **Typecheck/lint/build** were **not** run on historical trees: doing so requires installing period dependencies,
  which the protocol forbids ("do not run untrusted install scripts"). Static forensics used instead.

## II.4 Differences vs. the current deployment (`972a239` → `c7b4dfa`)

Diff over incident surfaces: `next.config.mjs` (+12: **adds Turnstile to CSP `script-src`/`frame-src`** — a
tighter allowlist, no download/`disposition`/`Service-Worker` change), `landing-v2.tsx` (large cosmetic refactor),
added `family-plans.ts`/`faqs.ts`, `vercel.json` (**+1 cron** = family-notifications), root `package.json`/
`pnpm-lock.yaml` dependency additions (later features), `apps/web/package.json` +2. **`analytics-provider` is
byte-identical.** **No service worker, download route, `Content-Disposition`/`attachment` header, meta-refresh, or
auto-trigger appeared or disappeared between the window and now.**

## II.5 Safe historical deployment probes (Section 5)

The **immutable window deployment URLs** (`https://tamanor-<id>-…vercel.app`) are behind **Vercel Deployment
Protection (SSO)** — every probe returns **`302 → vercel.com/sso-api`** with a `_vercel_sso_nonce` cookie. Their
historical served **body/headers cannot be retrieved anonymously** now, and I did **not** authenticate a bypass.
The public `tamanor.com`/`www.tamanor.com` alias (which served the public without SSO) has since moved to the
07-29 build, so the **historical public response is no longer directly observable** (evidence gap G-5). The served
*code* is nonetheless fully reconstructed from Git (II.3).

## II.6 Logs (Section 6)

`vercel logs <window-deployment>` → **"No logs found."** Runtime/access logs for 11-day-old deployments are
**expired/unavailable** (evidence gap G-6). Vercel build logs, Supabase auth/DB/storage logs, analytics
server-side logs, and WAF logs for the window were not retrievable. **Absence of logs is NOT evidence of safety.**

## II.7 Historical conclusions

- **Did a historical download mechanism exist?** **No — at the code level, for the entire window.** Every window
  commit is in the trusted repo and none contained a service worker, blob/`createObjectURL` download, `download`
  anchor/synthetic click, `meta refresh`, `importScripts`, `eval`, `window.open`, location-assignment, or an
  auto-`Content-Disposition`. `public/` held only images. This is a **code-level disproof**, not a runtime one —
  live responses and logs are expired/SSO-gated (G-5, G-6).
- **Did an external integration change?** Only **additively and legitimately**: GTM/gtag (07-15), Turnstile CSP
  entry (07-20). No unknown vendor appeared or disappeared. Whether the **GA/Google-Ads/Meta accounts** pushed a
  malicious remote tag *at runtime* during the window cannot be confirmed or denied from code + expired logs
  (open, low-likelihood — the loaders are gtag.js/fbevents under a no-`eval` CSP).
- **Rogue/unauthorized deployment?** None found: no deployment correlated to a non-repo SHA; all CLI deploys by
  the owner account; DNS/TLS chain clean (Part I §10). But note the deployments lack SHA attestation (G-1) and the
  first half of the window has no retained Vercel records (G-2).

## II.8 Revised ranked hypotheses

| # | Hypothesis | Revised likelihood | Change from Part I |
|---|---|---|---|
| H1 | **External to Tamanor** (extension/adware/PUP, or a non-`tamanor.com` link) | **Leading, strengthened** | Whole-window code is download-free; no served build could auto-download. |
| H2 | A specific historical URL/asset **mis-served `Content-Type`** and forced a download | Low, **unverifiable** | Immutable URLs SSO-gated, alias moved, logs expired (G-5/G-6). No code basis found. |
| H4 | Compromised **GA/Meta tag account** injecting a download at runtime | Low, open | Cannot be excluded via expired logs; loaders are measurement libs under restrictive CSP. |
| H3 | **Stale service worker** in the user's browser | **Very low, further weakened** | No SW ever existed in-window; none served; `/sw.js` 404. Only the user's browser can fully close it. |
| H5 | **Rogue/unauthorized deployment** | Very low | No non-repo SHA correlated; but G-1/G-2 limit certainty for the unretained sub-period. |

## II.9 Verdict (unchanged): UNRESOLVED

Historical reconstruction **disproves a Tamanor-code download mechanism for the entire incident window at the
code level**, and found **no rogue deployment, no unknown integration, and a clean DNS/TLS chain**. It does **not**
prove Tamanor was uninvolved at the runtime level, because: **(G-1)** deployments carry no SHA attestation;
**(G-2)** Vercel retains no deployment records for 07-14 → ~07-17 14:41; **(G-5)** immutable historical responses
are SSO-gated and the public alias has moved; **(G-6)** runtime logs are expired. Per protocol, the absence of
runtime evidence is not proof of safety. **The incident remains UNRESOLVED; the leading, strengthened explanation
is an origin external to Tamanor.** Closing it still requires the **downloaded artifact (SHA-256 + magic bytes)**
and, ideally, the **affected browser's** service-worker/extension state — no production log path remains for the
window.

### Appendix II — historical commands (all read-only)
`git log --since/--until`, `git log -S/-G` (pickaxe), `git worktree add --detach` (removed after; main untouched),
`git grep`/`git show`/`git cat-file -e`, `git diff --stat`; `vercel whoami/teams ls/projects ls/ls --prod --next
<ts>/inspect [--json]/logs` (all read-only); `curl -sSI` (HEAD) of immutable deployment URLs. No deploy, promote,
rollback, alias, env, secret, DB, or DNS operation was performed; no secret value was read or printed.

---

# Part III — CONFIRMED incident date reconstruction: 2026-07-18 (Europe/Bratislava, CEST)

**Confirmed incident:** date **2026-07-18**, URL **`https://www.tamanor.com/`** (308 → apex). Local day
**2026-07-18 00:00:00 → 23:59:59 CEST** = **2026-07-17 22:00:00 → 2026-07-18 21:59:59 UTC** (a buffer of a few
hours on each side was searched). This supersedes the Part II broad estimate. **Still read-only; main preserved at
`c7b4dfa`; no deploy/promote/rollback/alias/env/secret/DNS/DB change.**

## III.1 Deployments that served production on 2026-07-18 (alias source-of-truth timeline)

The production alias serves from the most-recent Ready production deployment; each deployment served
`[created, next-created)`. Deployments carry **no Git SHA** (CLI/prebuilt deploys) — but their `created` times
match `main` commit committer-times **to the second**, giving high-confidence SHA correlation. **~19 production
deployments served `tamanor.com`/`www.tamanor.com` during the 07-18 window** (yes — **multiple**). Condensed
timeline (deploy id · created UTC · served-interval CEST · correlated SHA · commit):

| Deployment id | Created (UTC) | Served (CEST) | Corr. SHA | Commit |
|---|---|---|---|---|
| `tamanor-hb0vjd6je` (twin `c14gs8hok`) | 07-17 21:36:40 | **00:00 → 07:32** | `76cc76c` | Meta per-account monitoring (V1.59 2B) |
| `tamanor-cu132cjd1` (twin `cel8sa5en`) | 07-18 05:32:42 | 07:32 → 09:08 | `b9a9909` | flat Meta multi-select UI (V1.59 2B) |
| `tamanor-icootppzb`/`1tltvh9xo` | 07-18 07:08–07:10 | 09:08 → 10:33 | `f49c50c`/`719b513` | loading skeletons; truthful sync status |
| `tamanor-86smursuv` | 07-18 08:33:55 | 10:33 → 11:35 | `1e3491c` | **light palette + unified header/footer (V1.61)** |
| `tamanor-kkwee3rb7` | 07-18 09:35:23 | 11:35 → 11:48 | `02dc887` | **humanise landing — blue logo, real portraits (V1.62/63)** |
| `tamanor-q7t4dr6nn` | 07-18 09:48:57 | 11:48 → 14:34 | `66d3310` | **favicon + PWA colours (V1.63)** |
| `tamanor-e0kto1rlv` | 07-18 12:34:34 | 14:34 → 17:37 | `5e0517a`/`73df869` | **cookie consent banner (V1.63)** |
| `tamanor-h2svkizwk`/`ioq3jln1y`/`ztvnlrzxt` | 07-18 15:37–16:47 | 17:37 → 19:50 | dashboard/billing commits | (V1.60 increments) |
| `tamanor-cwt47taj9` | 07-18 17:50:12 | 19:50 → 20:33 | `c55e0ed` | near-real-time Meta webhook (V1.63) |
| `tamanor-fx3rwzlgg` | 07-18 18:33:14 | 20:33 → 20:42 | `a9380a5` | guarded OpenAI risk provider |
| `tamanor-68sod4cbs`/`m1rzus378`/`3994hsjth` | 07-18 19:03–19:22 | 21:03 → 21:36 | `cd2e159` | sell-by-brand billing (V1.64) |
| `tamanor-4r2sgiqxp` | 07-18 19:36:10 | **21:36 → (into 07-19)** | `cd2e159`+ | last 07-18 build; served through end of day |

- **Deployment IDs / immutable URLs:** `https://tamanor-<id>-<owner-account>s-projects.vercel.app`.
- **Branch:** production (`main`); **creator:** owner account `<owner-account>`; **trigger:** CLI
  `vercel deploy --prod` (no Git-integration metadata). **Root Directory:** `apps/web`; **build:** Next.js,
  `pnpm --filter @guardora/db generate && next build`, region `fra1`.
- **Alias-assignment vs creation:** exact alias-assignment timestamps are not exposed by the CLI (gap G-3);
  intervals above are inferred from the ordered creation times (no manual rollback observed for 07-18; the
  overnight `hb0vjd6je` held the alias 07-17 23:36 → 07-18 07:32 with no intervening deploy).
- **Every correlated SHA is present in the trusted repo** (`git cat-file -e` confirmed for all 07-18 SHAs;
  single author, clean history). **No 07-18 deployment mapped to a SHA absent from GitHub.**

## III.2 Effective configuration during 07-18

`vercel.json` (@ `cd2e159`) = three crons only (`meta-dispatch`, `webhook-retry`, `maintenance`) — **no download
route, no family-notifications cron** (added later). Canonical redirects → `https://tamanor.com` only. Security
headers (CSP, `X-Content-Type-Options: nosniff`, HSTS, XFO) present all day. `manifest.ts` is a plain Next.js web
manifest — `start_url:"/"`, `display:"standalone"`, `background_color:#ffffff`, `theme_color:#2563eb`, **no
service worker, no `related_applications`/`prefer_related_applications` (no app-install prompt), no download**.

## III.3 Per-SHA source reconstruction (isolated worktree @ `cd2e159`, end-of-07-18; no deps installed)

- **Landing/root-layout:** the 07-18 changes were purely visual — palette/header (`1e3491c`), "humanise landing"
  portraits + copy (`02dc887`), favicon/PWA **colours** (`66d3310`), cookie banner (`5e0517a`). The
  **`66d3310` "PWA colours" commit changed only** `apple-icon.png`, `favicon.ico`, `icon.svg` (all images) and **4
  lines of `manifest.ts`** (theme/background hex). **Not a download vector.**
- **Auto-download / SW / blob / disposition search @ `cd2e159`:** **clean** (only a read-only
  `new URL(window.location.href)` in the analytics marker). **No service-worker/PWA files.**
- **`public/`:** only `humans/*.png` portraits — no HTML/binary/executable/archive.
- **Third-party scripts / GA / Meta:** exactly **GTM/gtag + Meta Pixel/fbevents + Turnstile** — env+consent
  gated, CSP-allowlisted. No other vendor.
- **User-agent-specific behaviour:** `userAgent` is used **only server-side** (session device labels, OS string
  for the security-settings page, an AI-crawler welcome list) — **no UA-conditioned content or download serving**.
- **File/storage/download routes:** **none existed on 07-18.** Every download-capable route (tenant CSV export,
  child-safety evidence download/export/ZIP) was added on **07-21** (Release B) — **after** the incident.
- **Dependencies / lockfile / lifecycle scripts:** no install lifecycle scripts; no non-registry deps (unchanged
  posture from Part I §16).
- **Generated production HTML / build output:** **not** reconstructed — building a historical tree requires
  installing period dependencies, which the protocol forbids ("do not run untrusted install scripts"). Static
  source is authoritative and clean.

## III.4 Security-relevant differences vs. current (`cd2e159` → `c7b4dfa`)

Only additive, later features: Turnstile CSP entry; the **post-07-18** download routes (CSV/evidence — all
`attachment`/`inline` + `nosniff`, auth-scoped, click-initiated); internal dashboard redirects; i18n strings.
**No** service worker, manifest download, meta-refresh, `window.open`, or **new external host** appeared. → No
security-relevant regression that could retro-explain a 07-18 auto-download.

## III.5 Live probes & logs for 07-18

- **Immutable 07-18 deployment URLs** (`hb0vjd6je`, `q7t4dr6nn`, `e0kto1rlv`, `68sod4cbs`, …): all return
  **`302 → vercel.com/sso-api`** (Vercel **Deployment Protection / SSO**). Historical served body/headers are
  **not anonymously retrievable**; no bypass was attempted (gap G-5). The public alias that served them has moved
  to the 07-29 build.
- **Logs:** `vercel logs` for 07-18 deployments → **"No logs found"** (expired). Supabase/analytics/GitHub/domain
  audit logs for 07-18 were not retrievable (gap G-6). **Missing logs are not evidence the incident did not
  occur.**

## III.6 Determinations (Section 11) & verdict

- **Which exact deployment served the page?** For a 07-18 visit the serving build was whichever of the ~19
  deployments held the alias at that minute (table III.1); e.g. a **morning** visit → `hb0vjd6je` (`76cc76c`); a
  **late-morning** visit around the landing refresh → `86smursuv`/`kkwee3rb7`/`q7t4dr6nn`
  (`1e3491c`/`02dc887`/`66d3310`); an **evening** visit → `cd2e159`. Exact-minute attribution needs the incident
  timestamp (still `unknown` within the day) — but **every candidate build is download-free**.
- **Did multiple deployments serve production that day?** **Yes — ~19**, a high-churn day of CLI production
  deploys, all correlated to trusted-repo 07-18 `main` commits.
- **Did any historical version contain a download mechanism?** **No** (code-level, all 07-18 builds): no SW,
  blob/`createObjectURL`, `download` anchor/synthetic click, meta-refresh, auto-`Content-Disposition`, manifest
  download, or UA-gated serving; and **no download route existed yet**.
- **Did an external script / env configuration change on 07-18?** The **cookie consent banner** (`5e0517a`) and
  **PWA theme colours** (`66d3310`) shipped that day; the **external script set was unchanged** (GTM/Meta/Turnstile)
  and **no new external host** was introduced. Whether the GA/Meta **accounts** pushed a malicious remote tag at
  runtime cannot be confirmed/denied from expired logs (open, low — loaders are gtag.js/fbevents under a
  no-`eval` CSP).
- **Is the external-origin hypothesis still justified?** **Yes — and further strengthened.** With every 07-18
  serving build proven download-free at the code level and no download route yet in existence, a Tamanor-origin
  auto-download on 07-18 has no code basis. The leading explanation remains an origin **external to Tamanor**
  (browser extension/adware/PUP, or a link the user attributed to the site).

**Verdict: UNRESOLVED (unchanged).** Historical evidence **disproves a Tamanor-code download mechanism for the
confirmed date 2026-07-18 at the code level**, with no rogue deployment and a clean config/DNS/TLS chain. It does
not achieve a runtime-level disproof because immutable 07-18 responses are SSO-gated and 07-18 runtime logs are
expired (gaps G-5/G-6), and deployments lack SHA attestation (G-1). Per protocol, absence of runtime evidence is
not proof of safety. **Closing the incident now requires the downloaded artifact (SHA-256 + magic bytes) and/or
the affected browser's service-worker/extension state** — no production-log path remains for 07-18.

### Appendix III — 07-18 commands (all read-only)
`vercel ls tamanor-web --prod --next <ms-cursor>` (paginated to the 07-18 window), `vercel inspect <url> --json`
(created times; `meta` empty → no SHA), `vercel logs` (expired), `git cat-file -e` / `git log`/`git show`/
`git diff` (SHA confirmation + surface audit), `git worktree add --detach cd2e159` (removed after; main
untouched), `curl -sSI` (HEAD) of immutable 07-18 URLs (all SSO-gated). No mutating operation; no secret read.
