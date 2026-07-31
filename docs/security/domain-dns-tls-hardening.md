# Domain, DNS & TLS Hardening — Operator Runbook

**Status: PREPARED, NOT ACTIVATED. No DNS/registrar/TLS change is made by the repository.** Every step is
performed by an authorized operator, and each proposed record is applied ONLY after the pre-change verification
passes. Do not hard-code a single CA from one observed certificate — verify Vercel's currently-supported issuers
first.

## 1. Current structure (observed, read-only)

- Apex `tamanor.com` → Vercel (anycast IP); `www.tamanor.com` → Vercel DNS CNAME; NS at a third-party EU
  registrar. `guardora.ai` / `www.guardora.ai` configured to redirect to the apex.
- TLS: a valid Let's Encrypt certificate for `CN=tamanor.com` (auto-provisioned by Vercel).
- **Gap:** no **CAA** record; DNSSEC / registrar-lock / CT-monitoring not confirmed.

## 2. Pre-change verification (do FIRST, every time)

```bash
dig +short A tamanor.com; dig +short CNAME www.tamanor.com; dig +short NS tamanor.com; dig +short CAA tamanor.com
echo | openssl s_client -connect tamanor.com:443 -servername tamanor.com 2>/dev/null | openssl x509 -noout -issuer -dates
```
- Confirm the apex/www targets are the intended Vercel project.
- **Before adding CAA:** confirm the exact CA(s) Vercel currently uses for this project (Let's Encrypt today,
  but Vercel may rotate issuers). A CAA that omits a CA Vercel needs will BREAK certificate renewal. Pin the CA
  set Vercel documents/uses at change time — not just the one cert observed.

## 3. Proposed records (apply only after §2 confirms)

- **CAA** (once the supported issuer set is confirmed), e.g. `0 issue "letsencrypt.org"` plus any other Vercel
  issuer, and `0 iodef "mailto:<security-contact>"`. Verify renewal succeeds after adding.
- **DNSSEC** at the registrar (if supported) — enable and verify the chain (`dig +dnssec`).
- **HSTS** is already sent in production (`max-age=63072000; includeSubDomains; preload`); submit to the preload
  list only after confirming every subdomain is HTTPS-ready.

## 4. Registrar & account hardening

- Registrar **lock** (transfer lock) ON; **MFA** on the registrar + DNS accounts; verified **recovery** contacts;
  quarterly **access review** of who can edit DNS.

## 5. Takeover & CT monitoring

- Scan for **dangling/wildcard** records and unclaimed subdomains that point at deprovisioned services
  (subdomain-takeover risk). Remove or reclaim.
- Enable **Certificate Transparency monitoring** (e.g. crt.sh / a CT-monitor) with an alert on any unexpected
  certificate issued for `tamanor.com` or a subdomain.
- **Expiration alerts** for the domain registration and any manually-managed certs.

## 6. Rollback & post-change checks

- Keep the prior record values; a CAA/DNSSEC change that breaks renewal is reverted immediately.
- After any change: re-run §2, confirm the site serves 200 `text/html` with the security headers, confirm a cert
  renewal succeeds, and confirm no `Content-Disposition: attachment` regression on public paths.
