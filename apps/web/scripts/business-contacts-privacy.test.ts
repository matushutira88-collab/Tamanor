/**
 * BUSINESS-CRM-V2 (Phase C) — targeted tests for the contact privacy lifecycle, anonymization, note redaction
 * and retention review.
 *
 * Pure unit tests over the exported domain helpers, plus source/schema/migration invariants over the repository,
 * server actions, export route and UI. NO database and NO network: the Postgres-backed suites need the
 * repository's isolated local test database, which is unavailable here and is reported as not run rather than
 * repointed. The database safety guard is not weakened anywhere.
 */
import { readFileSync } from "node:fs";
import {
  BusinessContactLifecycle, ALL_BUSINESS_CONTACT_LIFECYCLES, isValidContactLifecycle,
  canTransitionContactLifecycle, contactActionAvailability, DEFAULT_HIDDEN_LIFECYCLES,
  ContactAnonymizationReason, ALL_ANONYMIZATION_REASONS, isValidAnonymizationReason,
  CONTACT_ANONYMIZATION_CONFIRMATION, isAnonymizationConfirmed,
  CONTACT_REVIEW_MIN_DAYS, CONTACT_REVIEW_MAX_DAYS, CONTACT_REVIEW_DEFAULT_DAYS,
  normalizeReviewThresholdDays, contactNeedsPrivacyReview, contactReviewCutoff,
  CONTACT_ANONYMIZED_FIELDS, contactTombstoneExportRow, CONTACT_EXPORT_COLUMNS,
  buildContactTimeline, CONTACT_LIFECYCLE_AUDIT_EVENTS, CONTACT_STATUS_AUDIT_EVENT,
  BusinessContactStatus, Permission, Role, can, toCsv, csvEscapeField,
} from "@guardora/core";
import { businessDict } from "../src/app/dashboard/business-i18n";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
/** Source with comments removed — assertions about CODE must not match explanatory prose. */
const readCode = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** SQL with `--` comments removed, for the same reason. */
const readSql = (rel: string) => read(rel).replace(/^\s*--.*$/gm, "");
const PII = "Jane Doe jane@lead.test +421900111222 Acme";

console.log("\n1) lifecycle model — separate from sales status, anonymized is terminal");
{
  check("1a) exactly four lifecycle states", ALL_BUSINESS_CONTACT_LIFECYCLES.join(",") === "active,spam,archived,anonymized");
  check("1b) lifecycle values never collide with sales statuses",
    !ALL_BUSINESS_CONTACT_LIFECYCLES.includes("rejected" as BusinessContactLifecycle)
    && !Object.values(BusinessContactStatus).includes("anonymized" as BusinessContactStatus));
  check("1c) validator rejects junk", isValidContactLifecycle("active") && !isValidContactLifecycle("rejected") && !isValidContactLifecycle("<script>"));
  check("1d) archive and spam are reversible",
    canTransitionContactLifecycle(BusinessContactLifecycle.Active, BusinessContactLifecycle.Archived)
    && canTransitionContactLifecycle(BusinessContactLifecycle.Archived, BusinessContactLifecycle.Active)
    && canTransitionContactLifecycle(BusinessContactLifecycle.Active, BusinessContactLifecycle.Spam)
    && canTransitionContactLifecycle(BusinessContactLifecycle.Spam, BusinessContactLifecycle.Active));
  check("1e) ANONYMIZED IS TERMINAL — no outgoing transition at all",
    ALL_BUSINESS_CONTACT_LIFECYCLES.filter((l) => l !== BusinessContactLifecycle.Anonymized)
      .every((to) => !canTransitionContactLifecycle(BusinessContactLifecycle.Anonymized, to)));
  check("1f) same-state is an idempotent no-op",
    canTransitionContactLifecycle(BusinessContactLifecycle.Anonymized, BusinessContactLifecycle.Anonymized));
  check("1g) spam, archived and anonymized are hidden from the default view",
    [...DEFAULT_HIDDEN_LIFECYCLES].sort().join(",") === "anonymized,archived,spam");
  check("1h) active is NOT hidden", !DEFAULT_HIDDEN_LIFECYCLES.includes(BusinessContactLifecycle.Active));
}

console.log("\n2) action availability for a tombstone");
{
  const anon = contactActionAvailability(BusinessContactLifecycle.Anonymized);
  check("2a) notes blocked", anon.canAddNote === false);
  check("2b) assignment blocked", anon.canAssign === false);
  check("2c) sales status changes blocked", anon.canChangeStatus === false);
  check("2d) identifying export blocked", anon.canExportIdentifying === false);
  check("2e) no restoration path offered",
    anon.canUnarchive === false && anon.canRestoreSpam === false && anon.canArchive === false && anon.canMarkSpam === false);
  check("2f) re-anonymizing is harmless (idempotent at the repository)", anon.canAnonymize === false);
  const active = contactActionAvailability(BusinessContactLifecycle.Active);
  check("2g) an active contact keeps every ordinary action",
    active.canAddNote && active.canAssign && active.canChangeStatus && active.canArchive && active.canMarkSpam && active.canExportIdentifying);
  const archived = contactActionAvailability(BusinessContactLifecycle.Archived);
  check("2h) archived stays workable — hiding is organisational, not a privacy act",
    archived.canAddNote && archived.canAssign && archived.canChangeStatus && archived.canUnarchive && !archived.canArchive);
  const spam = contactActionAvailability(BusinessContactLifecycle.Spam);
  check("2i) spam is restorable and not auto-anonymized", spam.canRestoreSpam && !spam.canMarkSpam);
}

console.log("\n3) anonymization confirmation + bounded reasons");
{
  check("3a) the confirmation constant is non-localized", CONTACT_ANONYMIZATION_CONFIRMATION === "ANONYMIZE");
  check("3b) exact value confirms (case/whitespace tolerant)",
    isAnonymizationConfirmed("ANONYMIZE") && isAnonymizationConfirmed(" anonymize ") );
  check("3c) anything else does not confirm",
    !isAnonymizationConfirmed("") && !isAnonymizationConfirmed("yes") && !isAnonymizationConfirmed("ANONYMIZ") && !isAnonymizationConfirmed(null));
  check("3d) exactly five bounded reason categories",
    ALL_ANONYMIZATION_REASONS.join(",") === "user_request,retention_policy,test_data,duplicate_record,other_internal");
  check("3e) free text is never a valid reason",
    !isValidAnonymizationReason("because the customer emailed us") && !isValidAnonymizationReason("") && isValidAnonymizationReason(ContactAnonymizationReason.TestData));
}

console.log("\n4) retention review — a recommendation, never a decision");
{
  check("4a) threshold bounds are 30..3650 days", CONTACT_REVIEW_MIN_DAYS === 30 && CONTACT_REVIEW_MAX_DAYS === 3650);
  check("4b) a safe default exists", CONTACT_REVIEW_DEFAULT_DAYS >= CONTACT_REVIEW_MIN_DAYS && CONTACT_REVIEW_DEFAULT_DAYS <= CONTACT_REVIEW_MAX_DAYS);
  check("4c) out-of-range values clamp",
    normalizeReviewThresholdDays(1) === 30 && normalizeReviewThresholdDays(99999) === 3650 && normalizeReviewThresholdDays(365) === 365);
  check("4d) junk falls back to the default",
    normalizeReviewThresholdDays("abc") === CONTACT_REVIEW_DEFAULT_DAYS && normalizeReviewThresholdDays(null) === CONTACT_REVIEW_DEFAULT_DAYS
    && normalizeReviewThresholdDays(NaN) === CONTACT_REVIEW_DEFAULT_DAYS);
  const now = new Date("2026-08-03T00:00:00Z");
  const old = new Date("2024-01-01T00:00:00Z");
  const recent = new Date("2026-08-01T00:00:00Z");
  check("4e) an old contact is review-recommended",
    contactNeedsPrivacyReview({ receivedAt: old, lifecycle: BusinessContactLifecycle.Active, thresholdDays: 365, now }));
  check("4f) a recent contact is not", !contactNeedsPrivacyReview({ receivedAt: recent, lifecycle: BusinessContactLifecycle.Active, thresholdDays: 365, now }));
  check("4g) LATER activity resets the clock",
    !contactNeedsPrivacyReview({ receivedAt: old, latestActivityAt: recent, lifecycle: BusinessContactLifecycle.Active, thresholdDays: 365, now }));
  check("4h) an anonymized contact is NEVER review-recommended — nothing left to review",
    !contactNeedsPrivacyReview({ receivedAt: old, lifecycle: BusinessContactLifecycle.Anonymized, thresholdDays: 365, now }));
  check("4i) archived and spam still qualify",
    contactNeedsPrivacyReview({ receivedAt: old, lifecycle: BusinessContactLifecycle.Archived, thresholdDays: 365, now })
    && contactNeedsPrivacyReview({ receivedAt: old, lifecycle: BusinessContactLifecycle.Spam, thresholdDays: 365, now }));
  check("4j) the cutoff is deterministic", contactReviewCutoff(365, now).toISOString() === "2025-08-03T00:00:00.000Z");
  check("4k) NOTHING in the domain layer anonymizes or deletes automatically", (() => {
    const core = read("packages/core/src/business-contacts.ts");
    return !/setInterval|setTimeout|autoAnonymize|scheduleAnonymization|cron/i.test(core);
  })());
}

console.log("\n5) anonymization field policy + tombstone");
{
  const cleared = [...CONTACT_ANONYMIZED_FIELDS];
  for (const f of ["fullName", "email", "phone", "company", "messageSummary", "consentReference", "consentVersion", "assignedUserId", "externalLeadId"]) {
    check(`5a) ${f} is cleared by anonymization`, cleared.includes(f as never));
  }
  check("5b) dedupeKey is NOT cleared — it is what stops a replay re-creating the contact",
    !cleared.includes("dedupeKey" as never));
  check("5c) the tombstone export row carries no personal or provider value", (() => {
    const row = contactTombstoneExportRow(new Date("2026-06-01T10:00:00Z"), new Date("2026-06-02T10:00:00Z"));
    const joined = row.join("|");
    return row.length === CONTACT_EXPORT_COLUMNS.length
      && !/jane|acme|\+421|facebook|camp|form/i.test(joined)
      && row[0] === "" && row[1] === "" && row[2] === "" && row[3] === "" && row[4] === "" && row[9] === "";
  })());
  check("5d) the tombstone still carries non-identifying dates for audit/retention arithmetic", (() => {
    const row = contactTombstoneExportRow(new Date("2026-06-01T10:00:00Z"), new Date("2026-06-02T10:00:00Z"));
    return row[7] === "2026-06-01T10:00:00.000Z" && row[10] === "2026-06-02T10:00:00.000Z" && row[8] === "anonymized";
  })());
  check("5e) the tombstone row survives CSV serialization with no injection regression", (() => {
    const doc = toCsv(CONTACT_EXPORT_COLUMNS, [contactTombstoneExportRow(new Date(0), new Date(0))]);
    return doc.split("\r\n")[1]?.split(",").length === CONTACT_EXPORT_COLUMNS.length && csvEscapeField("=1+1").startsWith("'=");
  })());
}

console.log("\n6) repository: atomic transaction, locking, PII removal");
{
  const repo = read("packages/db/src/business-contacts-repo.ts");
  const fn = repo.slice(repo.indexOf("export async function anonymizeBusinessContact"));
  check("6a) runs inside ONE tenant transaction", /anonymizeBusinessContact[\s\S]{0,400}withTenant\(tenantId/.test(repo));
  check("6b) the row is LOCKED before anything is read or written", /FOR UPDATE/.test(fn) && fn.indexOf("FOR UPDATE") < fn.indexOf("businessContactNote.updateMany"));
  check("6c) a repeat is idempotent — already-anonymized returns without further change",
    /previousLifecycle === BusinessContactLifecycle\.Anonymized/.test(fn) && /alreadyAnonymized: true/.test(fn));
  check("6d) notes are redacted BEFORE the contact update, so a failure aborts the whole thing",
    fn.indexOf("businessContactNote.updateMany") < fn.indexOf("businessContact.update"));
  check("6e) every direct personal field is nulled",
    /fullName: null, email: null, phone: null, company: null, messageSummary: null/.test(fn)
    && /consentReference: null, consentVersion: null/.test(fn));
  check("6f) assignment is cleared", /assignedUserId: null/.test(fn));
  check("6g) externalLeadId is cleared", /externalLeadId: null/.test(fn));
  const fnCode = readCode("packages/db/src/business-contacts-repo.ts");
  const anonCode = fnCode.slice(fnCode.indexOf("export async function anonymizeBusinessContact"));
  check("6h) dedupeKey is never touched by the anonymization CODE", !/dedupeKey/.test(anonCode));
  check("6i) note bodies are nulled, not moved — no archive table anywhere",
    /body: null, redactedAt: now/.test(fn) && !/insert[\s\S]{0,80}(archive|backup|previous)/i.test(repo));
  check("6j) the previous values are never returned to the caller",
    !/previousEmail|previousName|previousPhone|oldValues/.test(repo));
  check("6k) the result carries counts and bounded enums only",
    /previousLifecycle, notesRedacted: redacted\.count, source, alreadyAnonymized: false/.test(fn));
  check("6l) lifecycle mutation cannot anonymize or un-anonymize",
    /if \(to === BusinessContactLifecycle\.Anonymized\) return \{ ok: false, reason: "invalid_transition" \}/.test(repo));
  check("6m) a foreign contact id is uniformly not_found (existence never leaks)",
    /if \(!row\) return \{ ok: false, reason: "not_found" as const \}/.test(fn));
  check("6n) there is still NO general note update or delete path",
    !/businessContactNote\.delete/.test(repo)
    && (repo.match(/businessContactNote\.updateMany/g) ?? []).length === 1);
  check("6o) the default list and export hide spam/archived/anonymized unless asked",
    /notIn: \[\.\.\.DEFAULT_HIDDEN_LIFECYCLES\]/.test(repo));
  check("6p) review filter excludes anonymized and is tenant-scoped via withTenant",
    /lifecycleState: \{ not: BusinessContactLifecycle\.Anonymized as never \}/.test(repo));
}

console.log("\n7) ingestion after anonymization — no rehydration");
{
  const repo = read("packages/db/src/business-contacts-repo.ts");
  const ingest = repo.slice(repo.indexOf("export async function ingestBusinessContact"), repo.indexOf("// =============================== CRM V2 PHASE B"));
  check("7a) ingestion INSERTS only — it never updates an existing contact",
    /createMany\(/.test(ingest) && /skipDuplicates: true/.test(ingest)
    && !/businessContact\.update/.test(ingest));
  check("7b) the dedupe identity is unchanged (still (tenantId, dedupeKey))", (() => {
    const schema = read("packages/db/prisma/schema.prisma");
    return /@@unique\(\[tenantId, dedupeKey\]\)/.test(schema);
  })());
  const anonOnly = readCode("packages/db/src/business-contacts-repo.ts");
  check("7c) the tombstone retains dedupeKey, so a replay collides and is a Duplicate",
    !/dedupeKey/.test(anonOnly.slice(anonOnly.indexOf("export async function anonymizeBusinessContact"))));
  check("7d) a replay therefore cannot write personal fields back (insert-only + unique collision)",
    /skipDuplicates: true/.test(ingest));
  check("7e) the ingestion-event ledger is untouched by anonymization", (() => {
    const anon = repo.slice(repo.indexOf("export async function anonymizeBusinessContact"));
    return !/businessContactIngestionEvent/.test(anon);
  })());
  check("7f) normal new-contact ingestion is unchanged (no lifecycle written at insert)",
    !/lifecycleState/.test(ingest));
}

console.log("\n8) server actions: gates, confirmation, PII-free audit");
{
  const a = read("apps/web/src/app/dashboard/contacts/actions.ts");
  const anon = a.slice(a.indexOf("export async function anonymizeContactAction"));
  const life = a.slice(a.indexOf("export async function changeContactLifecycleAction"), a.indexOf("export async function anonymizeContactAction"));
  check("8a) both new actions go through the manage gate",
    /changeContactLifecycleAction[\s\S]{0,200}await manageGate\(\)/.test(a) && /anonymizeContactAction[\s\S]{0,200}await manageGate\(\)/.test(a));
  check("8b) both enforce same-origin", /isSameOrigin\(\)/.test(life) && /isSameOrigin\(\)/.test(anon));
  check("8c) the bounded confirmation is required before any mutation",
    anon.indexOf("isAnonymizationConfirmed") < anon.indexOf("anonymizeBusinessContact"));
  check("8d) only a bounded reason enum is accepted — free text is dropped",
    /isValidAnonymizationReason\(rawReason\) \? rawReason : null/.test(anon));
  check("8e) tenant and actor come only from the session",
    /anonymizeBusinessContact\(session\.tenantId, contactId, reason\)/.test(anon)
    && /setBusinessContactLifecycle\(session\.tenantId, contactId/.test(life));
  check("8f) the lifecycle action can never anonymize", /to === BusinessContactLifecycle\.Anonymized/.test(life) && /e=input/.test(life));
  check("8g) the anonymization audit metadata is exactly the allowed set", (() => {
    const meta = anon.slice(anon.indexOf("metadata: {"));
    const block = meta.slice(0, meta.indexOf("},") + 2).replace(/\s+/g, " ");
    return block.includes("previousLifecycle: r.previousLifecycle")
      && block.includes("notesRedacted: r.notesRedacted")
      && block.includes("source: r.source")
      && !/fullName|email|phone|company|body|externalLeadId|dedupeKey|contactId:/.test(block);
  })());
  check("8h) the lifecycle audit carries bounded enums only",
    /metadata: \{ from: r\.from, to \}/.test(life));
  check("8i) no note body, name or contact field reaches a redirect",
    !/body/.test(anon.split("redirect(").slice(1).join("")) && /saved=anonymized/.test(anon));
  check("8j) no ops event carries anything from the contact", !/emitOpsEvent/.test(anon));
}

console.log("\n9) permissions — read may view, manage may mutate, export stays separate");
{
  check("9a) Analyst may READ contacts", can(Role.Analyst, Permission.BusinessContactsRead));
  check("9b) Analyst may NOT mutate lifecycle (no manage)", !can(Role.Analyst, Permission.BusinessContactsManage));
  check("9c) Analyst may NOT export", !can(Role.Analyst, Permission.BusinessContactsExport));
  check("9d) Admin and Owner may manage", can(Role.Admin, Permission.BusinessContactsManage) && can(Role.Owner, Permission.BusinessContactsManage));
  check("9e) export remains an independent permission",
    can(Role.Admin, Permission.BusinessContactsExport) && !can(Role.Analyst, Permission.BusinessContactsExport));
  check("9f) NO new permission was introduced — manage was sufficient", (() => {
    const perms = read("packages/core/src/permissions.ts");
    return !/BusinessContactsAnonymize|BusinessContactsPrivacy|BusinessContactsLifecycle/.test(perms);
  })());
  check("9g) anonymization is never reachable by read or export permission alone", (() => {
    const a = read("apps/web/src/app/dashboard/contacts/actions.ts");
    return /Permission\.BusinessContactsManage/.test(a) && !/anonymizeContactAction[\s\S]{0,400}BusinessContactsRead/.test(a);
  })());
}

console.log("\n10) Meta callback boundary is unchanged");
{
  for (const f of ["apps/web/src/app/api/meta/data-deletion/route.ts", "apps/web/src/app/api/meta/deauthorize/route.ts"]) {
    const src = read(f);
    const name = f.includes("deauthorize") ? "deauthorize" : "data-deletion";
    check(`10a) ${name}: does NOT touch business contacts`,
      !/businessContact|anonymizeBusinessContact|BusinessContactLifecycle/.test(src));
    check(`10b) ${name}: still performs credential invalidation only`, /revokeMetaAuthorization\(verified\.userId\)/.test(src));
  }
  const revoke = read("packages/db/src/meta-identity-deletion.ts");
  check("10c) the revocation helper never anonymizes or touches contacts",
    !/businessContact/i.test(revoke) && !/anonymiz/i.test(revoke));
  check("10d) the distinction is documented in the helper",
    /business contacts|contacts \/ leads|business records/i.test(revoke));
}

console.log("\n11) timeline + UI");
{
  const t0 = new Date("2026-08-01T10:00:00Z");
  const tl = buildContactTimeline({
    receivedAt: t0,
    audit: [
      { event: "business_contact.archived", createdAt: new Date("2026-08-01T11:00:00Z"), actorUserId: "u1", metadata: null },
      { event: "business_contact.anonymized", createdAt: new Date("2026-08-01T12:00:00Z"), actorUserId: "u1", metadata: null },
    ],
    notes: [{ createdAt: new Date("2026-08-01T10:30:00Z"), authorUserId: "u1", body: null, redactedAt: new Date() }],
    actorDisplay: { u1: "member@tenant.test" },
  });
  check("11a) privacy events appear in the timeline",
    tl.map((e) => e.kind).join(",") === "received,note,archived,anonymized", tl.map((e) => e.kind).join(","));
  check("11b) a redacted note keeps its place but carries no text",
    tl[1]!.kind === "note" && tl[1]!.body === undefined && tl[1]!.redacted === true);
  check("11c) every lifecycle audit event maps to a bounded kind",
    Object.keys(CONTACT_LIFECYCLE_AUDIT_EVENTS).length === 5);
  check("11d) unrelated audit rows are still ignored", (() => {
    const only = buildContactTimeline({ receivedAt: t0, audit: [{ event: "something.else", createdAt: t0, actorUserId: null, metadata: null }], notes: [] });
    return only.length === 1;
  })());

  const detail = read("apps/web/src/app/dashboard/contacts/[id]/page.tsx");
  check("11e) the anonymized detail page shows a generic title", /anonymized \? t\.contacts\.anonymizedContact/.test(detail));
  check("11f) identifying rows are replaced wholesale when anonymized", /anonymized \? \[\s*\{ label: t\.contacts\.received/.test(detail));
  check("11g) note form, status and assignment forms are lifecycle-gated",
    /canManage && allow\.canAddNote/.test(detail) && /canManage && allow\.canChangeStatus && allow\.canAssign/.test(detail));
  check("11h) the irreversible warning and typed confirmation are present",
    /t\.contacts\.irreversible/.test(detail) && /name="confirm"/.test(detail));
  check("11i) no dangerouslySetInnerHTML anywhere in the contact UI",
    !/dangerouslySetInnerHTML/.test(detail) && !/dangerouslySetInnerHTML/.test(read("apps/web/src/app/dashboard/contacts/page.tsx")));

  const list = read("apps/web/src/app/dashboard/contacts/page.tsx");
  check("11j) the list offers a lifecycle filter and a review filter",
    /t\.contacts\.filterLifecycle/.test(list) && /t\.contacts\.reviewRecommended/.test(list));
  check("11k) anonymized rows render generically with no contact method or provider linkability",
    /t\.contacts\.anonymizedContact/.test(list) && /BusinessContactLifecycle\.Anonymized \? "—" : \(c\.email/.test(list));
  check("11l) selection clears when the lifecycle/review view changes",
    /sp\.life \?\? ""\}\|\$\{sp\.review \?\? ""\}/.test(list));
  check("11m) cursor pagination is unchanged", /cursor=\$\{encodeURIComponent\(page\.nextCursor\)\}/.test(list));

  const exportRoute = read("apps/web/src/app/api/dashboard/contacts/export/route.ts");
  check("11n) the export emits a tombstone row for anonymized contacts",
    /contactTombstoneExportRow\(r\.receivedAt, r\.latestActivityAt\)/.test(exportRoute));
  check("11o) the export honours the lifecycle filter", /lifecycle: isValidContactLifecycle\(rawLifecycle\)/.test(exportRoute));
}

console.log("\n12) schema + migration");
{
  const schema = read("packages/db/prisma/schema.prisma");
  check("12a) the lifecycle enum exists with four values",
    /enum BusinessContactLifecycle \{\s*active\s*spam\s*archived\s*anonymized\s*\}/.test(schema.replace(/\/\/[^\n]*\n/g, "")));
  check("12b) contacts default to active", /lifecycleState\s+BusinessContactLifecycle @default\(active\)/.test(schema));
  check("12c) anonymization facts are non-identifying", /anonymizedAt\s+DateTime\?/.test(schema) && /anonymizationReason String\?/.test(schema));
  check("12d) note body is nullable with a redaction timestamp", /body\s+String\?/.test(schema) && /redactedAt\s+DateTime\?/.test(schema));
  check("12e) contact identity and dedupe are untouched",
    /@@unique\(\[tenantId, dedupeKey\]\)/.test(schema) && /externalLeadId\s+String\?/.test(schema));
  check("12f) no second copy of personal data was introduced",
    !/model BusinessContactArchive|model BusinessContactPrevious|model AnonymizationBackup/.test(schema));

  const mig = read("packages/db/prisma/migrations/20260831090000_business_contact_privacy_lifecycle/migration.sql");
  check("12g) the migration is additive and non-destructive",
    /ADD COLUMN IF NOT EXISTS/.test(mig) && !/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i.test(mig));
  check("12h) existing rows default safely to active", /DEFAULT 'active'/.test(mig));
  check("12i) the privilege change is COLUMN-SCOPED, not table-wide UPDATE",
    /GRANT UPDATE \("body", "redactedAt"\) ON "business_contact_notes"/.test(mig)
    && !/GRANT UPDATE ON "business_contact_notes"/.test(mig));
  const migSql = readSql("packages/db/prisma/migrations/20260831090000_business_contact_privacy_lifecycle/migration.sql");
  check("12j) no DELETE is granted on notes in any actual statement", !/GRANT[^;]*DELETE/i.test(migSql));
  check("12k) no hard-deletion path is introduced", !/DELETE FROM "business_contacts"/i.test(mig));
  check("12l) the enum creation is guarded (idempotent)", /IF NOT EXISTS \(SELECT 1 FROM pg_type WHERE typname = 'BusinessContactLifecycle'\)/.test(mig));
}

console.log("\n13) SK/EN/DE parity");
{
  const dicts = { en: businessDict("en"), sk: businessDict("sk"), de: businessDict("de") };
  const keys = [
    "lifecycle", "filterLifecycle", "archive", "unarchive", "markSpam", "restoreSpam",
    "anonymize", "anonymizeTitle", "irreversible", "confirmLabel", "confirmHint",
    "anonymizeReason", "anonymizeReasonNone", "anonymized", "anonymizedOn", "anonymizedContact",
    "notesRemoved", "noteRedacted", "reviewRecommended", "retentionReview", "retentionNote",
    "actionUnavailable", "lifecycleFailed", "confirmFailed",
    "life_active", "life_spam", "life_archived", "life_anonymized",
    "reason_user_request", "reason_retention_policy", "reason_test_data", "reason_duplicate_record", "reason_other_internal",
  ] as const;
  for (const loc of ["en", "sk", "de"] as const) {
    const c = dicts[loc].contacts as unknown as Record<string, unknown>;
    check(`13a) ${loc}: every new key is a non-empty string`,
      keys.every((k) => typeof c[k] === "string" && (c[k] as string).trim().length > 0),
      keys.filter((k) => !c[k]).join(","));
  }
  check("13b) the three locales are genuinely distinct",
    dicts.en.contacts.anonymize !== dicts.sk.contacts.anonymize && dicts.en.contacts.anonymize !== dicts.de.contacts.anonymize
    && dicts.sk.contacts.anonymize !== dicts.de.contacts.anonymize);
  check("13c) every lifecycle and reason enum has a label in all three locales",
    ALL_BUSINESS_CONTACT_LIFECYCLES.every((l) => (["en", "sk", "de"] as const).every((loc) => Boolean((dicts[loc].contacts as unknown as Record<string, string>)[`life_${l}`])))
    && ALL_ANONYMIZATION_REASONS.every((r) => (["en", "sk", "de"] as const).every((loc) => Boolean((dicts[loc].contacts as unknown as Record<string, string>)[`reason_${r}`]))));
  check("13d) the copy recommends review and never ASSERTS a deletion obligation", (() => {
    // "must be deleted" is allowed only inside the negation "Tamanor does not decide whether data must be
    // deleted" — an unqualified obligation claim is what must be absent.
    return (["en", "sk", "de"] as const).every((loc) => {
      const c = dicts[loc].contacts as unknown as Record<string, string>;
      const label = c.reviewRecommended ?? "";
      const note = c.retentionNote ?? "";
      const labelSafe = !/must|musí|musia|müssen|delete|vymaz|lösch/i.test(label);
      const noteNegated = /does not decide|nerozhoduje|entscheidet nicht/i.test(note);
      const noLegalClaim = !/legally required|required by law|právne vyžadované|gesetzlich vorgeschrieben/i.test(`${label} ${note}`);
      return labelSafe && noteNegated && noLegalClaim;
    });
  })());
  check("13e) the retention copy states Tamanor does not decide", (() => {
    const c = dicts.en.contacts as unknown as Record<string, string>;
    return /does not decide/i.test(c.retentionNote ?? "");
  })());
  check("13f) no user-facing English is hard-coded in the contact pages", (() => {
    const detail = read("apps/web/src/app/dashboard/contacts/[id]/page.tsx");
    return !/>Anonymize contact</.test(detail) && !/>Archive</.test(detail) && !/>Mark as spam</.test(detail);
  })());
}

console.log("\n14) no PII, note text or provider identifier leakage");
{
  const surfaces = [
    "apps/web/src/app/dashboard/contacts/actions.ts",
    "apps/web/src/app/dashboard/contacts/page.tsx",
    "apps/web/src/app/dashboard/contacts/[id]/page.tsx",
    "apps/web/src/app/api/dashboard/contacts/export/route.ts",
  ];
  for (const f of surfaces) {
    const src = read(f);
    check(`14a) ${f.split("/").pop()}: no token or provider secret is read`,
      !/\baccessToken\b|\blongLivedToken\b|appsecret|\bdedupeKey\b/.test(src));
  }
  const anonRow = contactTombstoneExportRow(new Date(0), new Date(0));
  check("14b) a tombstone row cannot carry PII even if the source had it", !anonRow.join("|").includes(PII));
  check("14c) the anonymization result type exposes no previous value", (() => {
    const code = readCode("packages/db/src/business-contacts-repo.ts");
    const t = code.slice(code.indexOf("export type AnonymizationResult"), code.indexOf("export async function anonymizeBusinessContact"));
    return !/fullName|email|phone|company|body/.test(t);
  })());
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts privacy lifecycle (Phase C): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
