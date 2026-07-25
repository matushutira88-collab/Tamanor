# Child Safety Evidence Management V1

A canonical, immutable **evidence subsystem** for child-safety incidents, built on top of the canonical
`ChildSafetyIncident` domain (CS-C15C) and the Reviewer Workspace / Console. It is deliberately **separate**
from the cyberbullying evidence model (bound to the cyberbullying `Incident` — a CS-C0 boundary) but
**reuses the existing domain-agnostic secure storage + sha256 integrity primitives**.

> No raw child message content is ever stored. Files live in secure storage under an opaque key (never
> exposed); URLs/labels are bounded; `bodyText` (manual/system evidence) is reviewer/system-authored
> internal text, never a message transcript.

## 1. Evidence domain

Two APPEND-ONLY **SYSTEM** tables (owner-role `systemDb`; all privileges `REVOKE`d from `tamanor_app`),
composite `(id, tenantId)` FKs so cross-tenant linking is impossible at the DB level:

| Table | Purpose |
|---|---|
| `child_safety_evidence` | one immutable evidence record per chain position on an incident |
| `child_safety_evidence_custody_events` | append-only forensic chain of custody |

Each evidence item has: immutable **id**, **incidentId**, **tenantId**, **type** (`uploaded_file`,
`screenshot`, `external_url`, `manual`, `system`), **source** (`reviewer_upload`, `system`, `external`),
immutable **contentHash** (sha256 of bytes / url / text) + `hashAlgorithm`, **uploadedAt**/`capturedAt`,
**uploader** (opaque; null for system), **integrityStatus** (`unverified`/`verified`/`failed`), and a
1-based **chainPosition** (unique per incident — deterministic, gap-free ordering). Exactly one of
`{storageKey, externalUrl, bodyText}` is populated per type. There is **no update and no delete** path.

## 2. Chain of custody

Every evidence operation appends an immutable custody event (`created`, `verified`, `reviewed`,
`referenced`, `exported`, `sealed`) with a timestamp, actor (+ role), and reason. Mapping:

| Operation | Custody event |
|---|---|
| upload / create | `created` |
| preview | `reviewed` |
| download | `referenced` |
| verify integrity | `verified` |
| export package | `exported` (per item) |
| seal | `sealed` |

The custody log is append-only (no update/delete path) and content-free.

## 3. File storage

Integrates with the existing secure evidence storage (`putEvidenceObject` / `readEvidenceObject`) — files
are written atomically under an unguessable opaque key. **The storage key/path is never returned** to any
client (list/detail/manifest exclude it). Supported: preview (inline, previewable MIME only), download
(authorized + audited, safe filename), metadata, and a sha256 integrity hash that is verified by re-reading
storage.

## 4. Reviewer UI

The incident detail page gains an **Evidence tab** (`EvidencePanel`). A reviewer can **upload** (file /
screenshot / external URL / manual text), **view/filter/search** (client-side over the loaded chain by
type / source / label / id), **preview** and **download** (authorized API routes), **verify integrity**,
**seal**, and expand the **chain of custody** per item. There is **no edit and no delete** affordance.
Upload / verify / seal are rendered only for a manager (`canManageChildSafetyEvidence`).

## 5. Export

`exportChildSafetyEvidencePackage` produces a **deterministic ZIP** (`buildEvidencePackage` is a pure
function; the ZIP writer uses the STORE method with fixed DOS timestamps, and JSON is emitted with stable
key order — so the same DB state yields byte-identical bytes). Contents:

```
metadata.json      — incident summary + evidence count + hash algorithm
manifest.json      — every item (chainPosition, id, type, source, hash, integrity, sealed, file path…)
hashes.txt         — "<sha256>  <file|url|id>" per item
custody-log.json   — the full chain of custody per item
files/…            — the selected files (uploaded_file/screenshot bytes; manual/system as .txt)
```

Export appends an `exported` custody event to each included item + an export audit. Storage keys are never
included.

## 6. Security

- **Owner / Administrator / Safety Reviewer only.** Reads (list / detail / preview / download / custody)
  require `child_safety:review_view`; writes (upload / verify / seal / export) require
  `child_safety:evidence_manage`. Analyst / Viewer are excluded from both. There is no public / guardian /
  SDK / gateway path.
- **Tenant isolated** — every query is explicitly `tenantId`-scoped; cross-tenant access returns 404;
  composite `(id, tenantId)` FKs enforce it at the DB level.
- **Every download is audited** (`child_safety.evidence.downloaded`) and appends a `referenced` custody
  event. All evidence audit is content-free.
- Mutations go through server actions (same-origin / CSRF + manage permission re-checked) that return safe
  error codes; binary reads go through Node.js API routes that gate on `resolveEvidenceActor`.

## Files

- Core: `child-safety-evidence.ts` (enums, permission, helpers), `permissions.ts` (+`evidence_manage`).
- DB: `child-safety-evidence.ts` (service + pure package builder), `deterministic-zip.ts`,
  `schema.prisma` (2 models), migration `20260817090000_cs_evidence_management`.
- Web: `server/child-safety/evidence.ts`, `[incidentId]/evidence-actions.ts`, `[incidentId]/evidence-panel.tsx`,
  API routes (`…/evidence/[id]`, `…/preview`, `…/download`, `…/incidents/[id]/evidence/export`),
  detail-page wiring, evidence i18n + view helpers.

## Known limitations

- **Export custody is not idempotent across retries.** Each `export` appends one `exported` custody
  event per included item; a client that re-triggers an export (or a retried request) records another
  `exported` event. This never affects the deterministic ZIP bytes and never duplicates evidence — it only
  appends extra (truthful) custody entries. A dedupe key per export would remove the duplication, but that
  is deliberately out of scope for V1.
- No antivirus scan gate on child-safety evidence yet (the storage/AV boundary exists in the shared
  primitives; wiring it in is a future enhancement).
- No retention / legal-hold lifecycle for child-safety evidence in V1 (immutable + sealable only).
- Preview inlines a fixed safe MIME allow-list (images / pdf / text); everything else is download-only.
- Upload takes a reviewer user id as the actor from the session; a member picker for assignment is future.
- **Tamanor reduces risk and speeds intervention but cannot guarantee 100% protection.**
