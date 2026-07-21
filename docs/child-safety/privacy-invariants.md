# Tamanor Child Safety — Privacy Invariants

> **Status: Accepted (CS-C0).** These are hard, non-negotiable invariants. Any change
> requires a formal ADR + legal review. Several are already enforced in code
> (`child-safety-signal.ts`, `workspace.ts`); the rest bind CS-C1+.

| # | Invariant | Enforced by (CS-C0) / owner |
|---|-----------|------------------------------|
| 1 | Raw message content never enters the Tamanor Child Safety Cloud. | `SAFETY_SIGNAL_FORBIDDEN_FIELDS` + validator; Privacy Gateway (CS-C6) |
| 2 | Full conversation history is never persisted. | Contract (no content fields); CS-C1/CS-C6 |
| 3 | Media content is never accepted by the signal endpoint. | `image/video/audio/attachment` forbidden; CS-C6 |
| 4 | Open platform account IDs are forbidden. | `platformUserId/username/displayName` forbidden |
| 5 | Guardian access never grants mailbox access. | Charter + role model; CS-C7/CS-C8 |
| 6 | Business workspace members never gain Family access implicitly. | `WorkspaceKind` + capability registry + guards (CS-C0) |
| 7 | Family administrators never gain Business access implicitly. | Same as #6 (CS-C0) |
| 8 | Safety signal payload is a strict allowlist. | `validateSafetySignalEnvelope` (CS-C0) |
| 9 | Unknown payload fields are rejected, not silently stored. | `unknown_field` rejection (CS-C0) |
| 10 | Safety events are append-only. | CS-C1 schema (append-only pattern, as in C11/C12) |
| 11 | Every signal carries taxonomy + contract version. | `taxonomyVersion` + `contractVersion` required (CS-C0) |
| 12 | Replay events are detected. | `nonce` required; Privacy Gateway anti-replay (CS-C6) |
| 13 | Guardian notification is not automatic for every incident. | Safe-recipient evaluation (CS-C8) |
| 14 | Recipient safety must be evaluated. | `SafetyRecipientEligibility`; CS-C8 |
| 15 | No person is labelled a criminal or predator by the system. | Language policy (Charter) |
| 16 | Evidence mode is separate from normal detection mode. | ADR-CS-0009; CS-C9 |
| 17 | Evidence content requires an explicit future consent workflow. | `EvidenceSharing` consent; CS-C9 |
| 18 | Data is never used for advertising. | Charter; no ad identity accepted |
| 19 | Data is never sold or used for behavioural marketing. | Charter |
| 20 | Child Safety and Business billing/audit/export scopes stay separate. | Workspace separation + audit namespaces (CS-C0) |

## Audit namespaces (locked)

Child-safety audit events live under dedicated namespaces, never mixed with the
Business audit stream: `child_safety.*`, `family_workspace.*`,
`guardian_relationship.*`, `safety_signal.*`, `safety_incident.*`,
`guardian_alert.*`, `consent.*`. Raw content is forbidden even in audit;
pseudonymized references must never be auto-rendered in the UI.
