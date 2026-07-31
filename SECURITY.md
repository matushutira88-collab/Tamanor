# Security Policy

Tamanor is an EU child-safety and reputation-protection platform operated by Infotech Solutions, s. r. o.
We take security and the protection of minors extremely seriously.

## Reporting a vulnerability

**Please report privately — never in a public issue, pull request, or discussion.**

- Preferred: open a **private security advisory** via GitHub → the repository's **Security → Report a
  vulnerability** (GitHub Private Vulnerability Reporting). *(An operator must enable this in repo settings; see
  the hardening runbook.)*
- Alternative: email the security contact configured for the project. *(The operator must configure and monitor
  a dedicated security mailbox before advertising it here; do not assume an address is monitored until it is.)*

Please include: a description, affected URL/component, reproduction steps, and impact. Do **not** include
personal data of third parties, and do **not** include any child data or evidence.

## Do not disclose child data

If a report involves a minor, protected profile, or safety evidence: **do not attach, quote, screenshot, or
transmit that content.** Describe the class of data and the access path only. We will coordinate a safe channel
if specific evidence is required. Mishandled child data is itself an incident.

## Evidence preservation (for reporters and operators)

- Do not open, rename, delete, or upload a suspicious downloaded artifact before hashing it (`shasum -a 256`).
- Preserve logs, timestamps, and the exact URL; capture the browser-reported source of any download.
- Do not run untrusted code outside an isolated, disposable environment.

## Coordinated handling

- We acknowledge reports and trace correlation privately, then assess severity, contain, fix, and verify.
- We ask reporters for a reasonable disclosure window while a fix is prepared and deployed.
- We do not pursue good-faith researchers who follow this policy, avoid privacy violations, and do not degrade
  service.

## Supported versions

Only the **currently deployed production release** (the `main` branch head that is live) receives security
fixes. There are no maintained older release branches; fixes ship forward on `main` and are deployed through the
sanctioned, approval-gated production deploy workflow. Release provenance (the exact deployed commit SHA) is
verifiable via the fail-closed provenance gate and the authenticated internal release endpoint.

## What we promise

- Timely, private handling and honest status.
- No takedown, rollback, or mass secret rotation is performed reflexively — actions are evidence-driven.
- We only promise what we can honor; provider-side commitments (log retention, monitoring) are documented as
  runbooks and marked activated only once evidenced.
