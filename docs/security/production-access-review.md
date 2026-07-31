# Production Access Review — Operator Runbook

**Status: PREPARED, NOT ACTIVATED. No account/integration is mutated by the repository.** This is a read-only
review checklist for an authorized operator. **Never record secret values here** — names, roles, owners, and
dates only. Run **quarterly** and after any incident or membership change.

## Principles (apply to every provider)

- **Least privilege** — each member/token/integration has the minimum role needed.
- **MFA** enforced on every human account.
- **Remove stale** accounts/tokens/keys promptly; expire long-lived tokens.
- **Emergency revocation** path documented and tested.
- **Evidence capture** — record what was reviewed, by whom, and when (no secret values).

## GitHub

- Members & roles; outside collaborators; **deploy keys**; **PATs / fine-grained tokens**; **GitHub Apps** &
  their permissions; **webhooks**; **Actions secrets** (names only) and **Environments** (`Production` reviewers);
  branch-protection bypass list. Confirm SHA-pinned actions (see `workflow-safety:test`) and CODEOWNERS coverage.

## Vercel

- Team members & roles; **integrations**; **deploy hooks** (names/targets); **domains & aliases** (only the
  intended project holds `tamanor.com`); **environment variables** (names only) and who can read/change them;
  deployment-protection (SSO) settings.

## Supabase

- Project members & roles; **service-role key** custody (server-only, never client/bundle); RLS enforcement;
  Storage bucket policies (no unintended public buckets); log-drain access.

## Google / Meta / Turnstile

- OAuth app owners + scopes; **GA/GTM container** editors (a tag-container editor can inject scripts — tightly
  restrict); **Meta Pixel/App** admins + `META_APP_SECRET` custody; Turnstile site/secret key custody.

## Email / Stripe / Storage

- Email provider (Resend/Google) senders + API-key custody; **Stripe** roles + webhook-secret custody +
  restricted API keys; object-storage access + bucket policy.

## Review record (fill each quarter — names/dates only, no secrets)

| Provider | Reviewed by | Date | Stale removed | Over-privileged fixed | Notes |
|---|---|---|---|---|---|
| GitHub |  |  |  |  |  |
| Vercel |  |  |  |  |  |
| Supabase |  |  |  |  |  |
| Google/Meta/Turnstile |  |  |  |  |  |
| Email/Stripe/Storage |  |  |  |  |  |

## Compromise response

If a member/token/key is compromised: revoke it first, then rotate dependent secrets **in dependency order**
(auth/session → DB/app-role → provider/API → deploy hooks), verify DB/storage integrity, and deploy a focused,
tested fix through the sanctioned `production-deploy` workflow. Preserve evidence; never delete audit/incident
data.
