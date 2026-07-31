# Commit Signing & Release Integrity — Plan

**Status: PREPARED, NOT ACTIVATED. No repository setting is changed and no automation is locked out.** Order
matters: do NOT require signed commits until every legitimate author AND every bot/CI identity can sign, or
automation (Dependabot, release bots, the deploy workflow) will be unable to commit/merge.

## Sequencing (do in order)

1. **Human signed commits** — each maintainer configures a GPG/SSH/`gitsign` signing key and enables
   `commit.gpgsign true`. Verify commits show **Verified** on GitHub. (Today all history is `git fsck`-clean but
   unsigned — provenance rests on single-author history + the deploy workflow.)
2. **CI/bot identity** — establish a verified signing identity for automated commits (Dependabot uses GitHub's
   verified signature; a release bot uses its own key/`gitsign`). Confirm bot commits verify.
3. **Only then require signing** — enable branch protection "Require signed commits" on `main`. Doing this before
   steps 1–2 would block legitimate automation.

## Release attestation

- The `production-deploy` workflow writes a **non-secret release-attestation JSON** (repository, commit SHA, ref,
  run id/attempt, actor, deployment host, result) to the step summary + an artifact (90-day retention).
- This is a run-scoped record, **not** a cryptographic attestation yet. **Follow-up:** enable
  `actions/attest-build-provenance` (Sigstore) to produce a verifiable, signed build-provenance attestation —
  only claim "attested" once it is configured **and tested**.

## Runtime SHA verification (activation-time control)

- The fail-closed provenance gate (`assert-production-release-provenance.ts`) requires a valid full 40-char SHA
  from a trusted source before a production/preview build proceeds.
- The authenticated `/api/platform/release` endpoint returns the **running** commit SHA.
- **Activation check:** after a deploy, compare the running SHA (`/api/platform/release`) with the SHA in the
  approved workflow's release attestation. They MUST match; a mismatch means the running build is not the
  approved one — stop and investigate before marking the release activated.

## Do NOT

- Do not enable "require signed commits" before bot/CI identities can sign.
- Do not claim native/cryptographic attestation until `attest-build-provenance` is configured and verified.
