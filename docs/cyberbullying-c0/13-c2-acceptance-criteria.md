# 13 — C2 Acceptance Criteria — Evidence Foundation (local-only)

**Sprint C2 goal:** the isolated, immutable, tenant-scoped evidence layer with
integrity + chain-of-custody — **local storage only, no cloud, no deploy.**

## In scope (C2)
- `IncidentEvidence` record + `EvidenceContextItem` + `EvidenceCustodyEvent`
  (append-only) + a **local** `StorageObject` boundary (references, not binaries in
  the DB).
- Content hashing + integrity algorithm; immutable original; derived redacted
  version linked to the parent.
- Antivirus scan **boundary** (interface/contract; a local stub is acceptable in
  R&D — no external service).
- Sensitive-access audit (`view_sensitive_evidence` → custody event).
- Retention metadata + legal hold on evidence (structure; enforcement wired).

## Explicitly OUT (C2)
- **Cloud storage** of any kind.
- **Production deploy.**
- Notifications / escalation delivery / export packaging (later sprints; export is
  C11).
- Any minor-evidence flow unless C14 approved.

## Acceptance criteria
1. **Local-only storage:** binaries stored via a local StorageObject boundary
   (e.g., local disk within the R&D env); DB stores only references + metadata.
   **No external/cloud storage call exists.**
2. **Immutable origin:** the original evidence record + stored object cannot be
   mutated after capture; redaction/translation create **derived** records linked
   to the parent, each with its own hash.
3. **Hash + integrity:** every evidence object has a content hash + named
   algorithm + captured timestamp + storage reference; upload integrity verified.
4. **Antivirus boundary:** an AV scan step gates storage (stub allowed in R&D);
   an unscanned/failed object is quarantined, never served inline.
5. **Chain of custody:** an append-only `EvidenceCustodyEvent` records captured/
   uploaded/verified/viewed_sensitive/redacted/exported/… with actor, role,
   reason, previous+resulting integrity hash; the chain is immutable.
6. **Access audit:** viewing sensitive (unredacted) evidence requires
   `view_sensitive_evidence` and always writes a `viewed_sensitive` custody event.
7. **Retention metadata:** each evidence carries a retention deadline + legal-hold
   flag; expiry logic verifies legal hold before delete/anonymize (+ receipt).
8. **RLS + subject scope:** evidence tables tenant-scoped, RLS ENABLE+FORCE, plus
   subject/case-scope + sensitive gate; cross-tenant blocked; no-context ⇒ 0 rows.
9. **No cloud / no deploy:** verified — no remote storage, no push, no deploy;
   migrations applied local-only (DB safety guard blocks remote).
10. **Regression-free:** typecheck/lint/i18n/build pass; existing modules
    unaffected; one auditable commit.

## Definition of done
Immutable, hashed, custody-tracked, tenant+subject-scoped evidence works locally
with an AV boundary and retention metadata; all tests pass; no cloud, no deploy.
