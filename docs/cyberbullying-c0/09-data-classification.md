# 09 — Data Classification Policy

Five levels; every datum is classified; handling (default redaction, logging,
export, telemetry, retention) follows the level.

## Levels
| Level | Definition |
| --- | --- |
| **public** | Non-personal, safe to show anyone. |
| **internal** | Operational, tenant-internal, non-personal. |
| **confidential** | Tenant business/case data; role-restricted. |
| **sensitive** | Personal data / harmful-content metadata; scope + audit required. |
| **highly sensitive** | Minor data, sexual content, doxxed identifiers, threat specifics, biometric/health, identity of alleged actor. Strict gate + always audited. |

## Per-datum classification + handling
| Datum | Level | Default redaction | Logging | Export | Telemetry | Retention |
| --- | --- | --- | --- | --- | --- | --- |
| Detection summary (sanitized) | confidential | n/a (already sanitized) | ids/metadata only | with case only | aggregate/pseudonymized only | case retention |
| Full message text | highly sensitive | **redacted by default** | **never logged** | redacted profile + approval | **never** | evidence retention + legal hold |
| Screenshot / binary | highly sensitive | preview redacted | **never** (ref only) | approved export only | **never** | evidence retention + legal hold |
| Personal identifier (phone/email/address) | highly sensitive | **masked by default** | never | redacted unless legally required | never | minimal; legal-basis driven |
| Minor data | highly sensitive | strict | never | gated; guardian/legal | never | minimal; special rules (C14) |
| Sexual content | highly sensitive | hidden by default | never | strictly gated | never | minimal; legal handling |
| Doxxed address | highly sensitive | masked | never | gated | never | minimal |
| Threat details | highly sensitive | shown to authorized reviewer only | never verbatim | gated | never | evidence retention + hold |
| Reviewer note | confidential | role-restricted | metadata only | internal only | never | case retention |
| Audit metadata | internal/confidential | n/a | is the log | with audit scope | aggregate only | audit retention |
| Evidence hash | confidential | n/a | ok (hash is not content) | in integrity manifest | no | with evidence |
| Export package | highly sensitive | per export redaction profile | export event only | is the export | never | short-lived; expires |

## Handling rules (hard)
- **Default redaction:** all `sensitive`/`highly sensitive` content is redacted in
  the reviewer UI **by default**; unredaction requires `view_sensitive_evidence`
  **and** emits a `viewed_sensitive` custody event with a reason.
- **Log restriction:** raw sensitive content, identifiers, tokens, and full
  message/evidence text are **never** written to logs, audit metadata, error
  reports, or diagnostics — only ids, hashes, and classified metadata.
- **Export restriction:** only via `EvidenceExport` (approved, time-limited,
  redaction-profiled, audited). No ad-hoc export path.
- **Telemetry restriction:** ops/analytics telemetry carries **aggregate or
  pseudonymized** signals only — never identity or content.
- **Retention expectation:** sensitive/highly-sensitive data uses per-case /
  per-type retention + legal hold (not the plan-level `dataRetentionDays` alone);
  on expiry → verify legal hold → delete/anonymize → keep a minimal deletion
  receipt → audit.
