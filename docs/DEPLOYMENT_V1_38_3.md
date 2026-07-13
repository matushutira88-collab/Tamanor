# Tamanor V1.38.3 — Deployment & Search-Engine Submission Manifest

Internal deployment runbook. **Not a public route** (lives in `docs/`, never served/indexed).
Do not paste secret values here — record only present/missing + masked fingerprints.

## Canonical facts (source of truth in code)

| Item | Value |
|---|---|
| Canonical host | `https://tamanor.com` (`apps/web/src/lib/site.ts` `SITE_URL`, root `metadataBase`) |
| Sitemap | `https://tamanor.com/sitemap.xml` |
| Robots | `https://tamanor.com/robots.txt` |
| llms.txt | `https://tamanor.com/llms.txt` |
| AI index | `https://tamanor.com/ai-index.json` |
| IndexNow key file | `https://tamanor.com/indexnow-key.txt` (serves `INDEXNOW_KEY`; 404 until set) |
| Content revision (`lastUpdated`) | `2026-07-13` (`CONTENT_REVISION`) |

## Deployment status (as of this phase)

**BLOCKED for automated deploy from this workspace** — honest state:
- Git repo on `main`, clean tree, **no git remote configured**.
- **No hosting config** in repo (no `vercel.json` / `.vercel` / `netlify.toml` / `.github`).
- **No deploy credentials** available to the agent.
- Therefore no production deployment, DNS, TLS or live-domain verification could be performed by the agent.

Everything below is **prepared and code-verified**; the owner must execute the deploy + submissions.

## Deployment record (fill on real deploy)

| Field | Value |
|---|---|
| Commit SHA | _pending_ |
| Deployment ID | _pending_ |
| Production URL | _pending_ |
| Timestamp | _pending_ |
| Build status | _pending_ |
| Migration status | _pending_ (additive only; `prisma migrate deploy`) |
| Domain/alias | _pending_ |

## Search-engine submission inventory

| Engine | Property verified | Sitemap submitted | IndexNow | Status |
|---|---|---|---|---|
| Google Search Console | ☐ pending (no access) | ☐ pending | n/a | pending |
| Bing Webmaster Tools | ☐ pending (no access) | ☐ pending | ☐ pending | pending |
| IndexNow | — | — | ☐ ready (needs `INDEXNOW_KEY` + deploy) | ready, submission pending |

## Owner manual checklist

### 1. Hosting + domain
- [ ] Connect the repo to a host (e.g. Vercel/your platform) or add a git remote + CI.
- [ ] Add `tamanor.com` (apex) as the production domain; set DNS A/ALIAS per host.
- [ ] Redirect `www.tamanor.com` → `tamanor.com` (also configured in `next.config.mjs` if traffic reaches the app).
- [ ] If `guardora.ai` still resolves, point it at the app (path-preserving 308 is pre-configured) OR set the 308 at the DNS/host edge.
- [ ] Confirm HTTPS/TLS valid; HSTS is already sent (`max-age=63072000; includeSubDomains; preload`).

### 2. Production env (never commit values)
- [ ] `NODE_ENV=production` (build already pins it).
- [ ] `DATABASE_URL` (owner role) + `APP_DATABASE_URL` (non-superuser `tamanor_app`, MUST differ) — RLS fail-closed.
- [ ] `AUTH_SECRET`, `TOKEN_ENCRYPTION_MODE=aes-gcm` + `TOKEN_ENCRYPTION_KEY` (base64-32B).
- [ ] `GUARDORA_DATA_MODE=real` (NOT demo).
- [ ] Connector flags OFF unless truly live: `META_LIVE_SYNC`, `META_WEBHOOK_SYNC`, `META_CONNECTOR_HEALTH`, `GOOGLE_BUSINESS_API_ENABLED`.
- [ ] `INDEXNOW_KEY` (32+ hex chars) — enables `/indexnow-key.txt` + submission.

### 3. Google Search Console
- [ ] Add **Domain property** `tamanor.com`; verify via DNS TXT (record name/value from GSC — do not store the token here).
- [ ] Submit `https://tamanor.com/sitemap.xml`.
- [ ] URL-inspect: `/`, `/compare`, `/security`, `/integrations/instagram`, `/platform/what-is-tamanor`.
- [ ] Track states separately: verified → sitemap submitted → fetched → discovered → crawled → **indexed**. Do not report "submitted" as "indexed".

### 4. Bing Webmaster Tools
- [ ] Add/import `tamanor.com`; verify.
- [ ] Submit sitemap; enable IndexNow.

### 5. IndexNow (after deploy + key set)
- [ ] Confirm `https://tamanor.com/indexnow-key.txt` returns the key (200).
- [ ] `INDEXNOW_KEY=... pnpm indexnow:submit --submit` (dry-run without `--submit`).

### 6. Monitoring + follow-up windows
- [ ] Uptime/status checks: `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/ai-index.json`, TLS expiry, 5xx rate.
- [ ] Re-check indexing at **24h / 72h / 7d / 30d**. Indexing timing is **not guaranteed** by any submission.

## Truthful caveats
- `robots.txt` is a crawl directive — it does **not** guarantee indexing.
- Allowing AI crawlers does **not** guarantee any AI system ingests or cites the content.
- "Sitemap submitted" ≠ "indexed". Track the states above independently.
