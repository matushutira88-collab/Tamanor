/**
 * BUSINESS — CONNECTED PLATFORMS & CONTACTS FOUNDATION V1 — repository (tenant-scoped, RLS-enforced).
 *
 * Every function runs inside `withTenant(tenantId, ...)` so RLS scopes every query to the session tenant (no
 * manual tenantId filter needed, and cross-tenant reads/writes fail closed). No secrets are stored or returned.
 * Ingestion is idempotent (ON CONFLICT DO NOTHING via the `(tenantId, dedupeKey)` unique index) and always
 * appends a bounded ingestion-event row. Consent is persisted ONLY as supplied (never inferred).
 */
import { createHash } from "node:crypto";
import {
  BusinessProvider, BusinessContactStatus, BusinessContactSource, BusinessConnectionStatus,
  BusinessConnectionCapability, BusinessIngestionResult,
  canTransitionContactStatus, businessContactDedupeSeed,
  contactSearchPhoneDigits, validateContactNoteBody,
  CONTACT_STATUS_AUDIT_EVENT, CONTACT_ASSIGNMENT_AUDIT_EVENT, CONTACT_LIFECYCLE_AUDIT_EVENTS,
  CONTACT_EXPORT_MAX_ROWS, MAX_BULK_CONTACT_IDS,
  BusinessContactLifecycle, canTransitionContactLifecycle, contactReviewCutoff,
  CONTACT_REVIEW_DEFAULT_DAYS, DEFAULT_HIDDEN_LIFECYCLES,
  type ContactAnonymizationReason,
  type ContactAuditRecord, type ContactNoteRecord, type BulkContactOutcome, type ContactExportSource,
} from "@guardora/core";
import { ActorKind } from "@prisma/client";
import type { $Enums } from "@prisma/client";
import { withTenant } from "./repositories";

// ---- casts: core enum values are identical strings to the Prisma enums --------------------------------------
const asProvider = (p: BusinessProvider) => p as unknown as $Enums.BusinessProvider;
const asContactStatus = (s: BusinessContactStatus) => s as unknown as $Enums.BusinessContactStatus;
const asSource = (s: BusinessContactSource) => s as unknown as $Enums.BusinessContactSource;
const asConnStatus = (s: BusinessConnectionStatus) => s as unknown as $Enums.BusinessConnectionStatus;
const asCapabilities = (c: readonly BusinessConnectionCapability[]) => c as unknown as $Enums.BusinessConnectionCapability[];
const asResult = (r: BusinessIngestionResult) => r as unknown as $Enums.BusinessIngestionResult;

// ---- bounded string clamps (defence-in-depth against oversized input) ---------------------------------------
const clamp = (v: string | null | undefined, n: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, n);
};

// =============================== CONNECTIONS ==================================================================
export interface BusinessConnectionRow {
  id: string;
  provider: BusinessProvider;
  externalAccountId: string | null;
  displayName: string | null;
  status: BusinessConnectionStatus;
  capabilities: BusinessConnectionCapability[];
  lastVerifiedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastErrorCode: string | null;
}

/** All connection rows for the tenant (0..4). RLS-scoped. Never returns a token/secret (none are stored). */
export async function listBusinessConnections(tenantId: string): Promise<BusinessConnectionRow[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.businessPlatformConnection.findMany({ orderBy: { provider: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider as unknown as BusinessProvider,
      externalAccountId: r.externalAccountId,
      displayName: r.displayName,
      status: r.status as unknown as BusinessConnectionStatus,
      capabilities: r.capabilities as unknown as BusinessConnectionCapability[],
      lastVerifiedAt: r.lastVerifiedAt,
      lastSuccessfulSyncAt: r.lastSuccessfulSyncAt,
      lastErrorCode: r.lastErrorCode,
    }));
  });
}

export interface UpsertConnectionInput {
  provider: BusinessProvider;
  status: BusinessConnectionStatus;
  capabilities?: readonly BusinessConnectionCapability[];
  displayName?: string | null;
  externalAccountId?: string | null;
  lastErrorCode?: string | null;
}

/**
 * Create-or-update a tenant's connection row for a provider (unique on (tenantId, provider)). Used by the
 * platform manage actions. Stores ONLY safe status/capability/identity — never a token. Returns the row id.
 */
export async function upsertBusinessConnection(tenantId: string, input: UpsertConnectionInput): Promise<string> {
  return withTenant(tenantId, async (db) => {
    const existing = await db.businessPlatformConnection.findFirst({ where: { provider: asProvider(input.provider) } });
    const data = {
      status: asConnStatus(input.status),
      ...(input.capabilities ? { capabilities: asCapabilities(input.capabilities) } : {}),
      displayName: clamp(input.displayName, 200),
      externalAccountId: clamp(input.externalAccountId, 200),
      lastErrorCode: clamp(input.lastErrorCode, 80),
    };
    if (existing) {
      await db.businessPlatformConnection.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    const created = await db.businessPlatformConnection.create({
      data: { tenantId, provider: asProvider(input.provider), capabilities: asCapabilities(input.capabilities ?? []), ...data },
    });
    return created.id;
  });
}

/** Set a connection to disconnected (soft; never a hard delete). Returns true if a row was updated. */
export async function disconnectBusinessConnection(tenantId: string, provider: BusinessProvider): Promise<boolean> {
  return withTenant(tenantId, async (db) => {
    const r = await db.businessPlatformConnection.updateMany({
      where: { provider: asProvider(provider) },
      data: { status: asConnStatus(BusinessConnectionStatus.Disconnected) },
    });
    return r.count > 0;
  });
}

/** Tenant members that a contact can be assigned to (userId + email for the picker). RLS-scoped. */
export interface AssignableMember { userId: string; email: string }
export async function listAssignableMembers(tenantId: string): Promise<AssignableMember[]> {
  return withTenant(tenantId, async (db) => {
    const ms = await db.membership.findMany({ include: { user: { select: { email: true } } } });
    return ms.map((m) => ({ userId: m.userId, email: m.user?.email ?? m.userId }));
  });
}

// =============================== CONTACTS =====================================================================
export interface BusinessContactRow {
  id: string;
  provider: BusinessProvider;
  sourcePlatform: BusinessContactSource;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  messageSummary: string | null;
  campaignName: string | null;
  formName: string | null;
  receivedAt: Date;
  status: BusinessContactStatus;
  assignedUserId: string | null;
  consentValue: boolean | null;
  createdAt: Date;
  /** BUSINESS-CRM-V2 (Phase C) — privacy lifecycle, orthogonal to `status`. */
  lifecycleState: BusinessContactLifecycle;
  anonymizedAt: Date | null;
  anonymizationReason: string | null;
  /**
   * BUSINESS-CRM-V2 — the most recent change we can attribute cheaply: the contact's own `updatedAt` (status /
   * assignment changes touch it) or its newest note, whichever is later. Never null — it falls back to
   * `updatedAt`, so the column always renders.
   */
  latestActivityAt: Date;
}

export interface BusinessContactFilters {
  status?: BusinessContactStatus;
  sourcePlatform?: BusinessContactSource;
  /**
   * BUSINESS-CRM-V2 — an ALREADY-NORMALIZED search term (see `normalizeContactSearch`). Matched
   * case-insensitively against full name / email / company, plus a digits-only phone probe when the term is
   * phone-shaped. Passed to Prisma as a BOUND PARAMETER — never string-interpolated into SQL — and always
   * combined with the tenant RLS scope and the other filters.
   */
  search?: string;
  /**
   * BUSINESS-CRM-V2 (Phase C) — explicit lifecycle view. When omitted the list shows ACTIVE only: spam,
   * archived and anonymized are opt-in, so a default view never silently mixes junk or tombstones into a
   * working queue, and never silently exports them either.
   */
  lifecycle?: BusinessContactLifecycle;
  /**
   * "Review recommended" — the contact's most recent signal is older than the operator's review threshold.
   * An operational reminder ONLY: nothing is ever anonymized or deleted because of it.
   */
  needsReview?: boolean;
  /** Threshold in days for `needsReview`. Normalized by the caller; defaults to the safe default. */
  reviewThresholdDays?: number;
}
export interface BusinessContactPage {
  items: BusinessContactRow[];
  nextCursor: string | null;
}

const PAGE_SIZE = 20;
const mapContact = (r: {
  id: string; provider: string; sourcePlatform: string; fullName: string | null; email: string | null;
  phone: string | null; company: string | null; messageSummary: string | null; campaignName: string | null;
  formName: string | null; receivedAt: Date; status: string; assignedUserId: string | null;
  consentValue: boolean | null; createdAt: Date; updatedAt?: Date;
  lifecycleState?: string; anonymizedAt?: Date | null; anonymizationReason?: string | null;
}, latestNoteAt?: Date | null): BusinessContactRow => ({
  id: r.id,
  provider: r.provider as BusinessProvider,
  sourcePlatform: r.sourcePlatform as BusinessContactSource,
  fullName: r.fullName, email: r.email, phone: r.phone, company: r.company,
  messageSummary: r.messageSummary, campaignName: r.campaignName, formName: r.formName,
  receivedAt: r.receivedAt, status: r.status as BusinessContactStatus, assignedUserId: r.assignedUserId,
  consentValue: r.consentValue, createdAt: r.createdAt,
  lifecycleState: (r.lifecycleState as BusinessContactLifecycle) ?? BusinessContactLifecycle.Active,
  anonymizedAt: r.anonymizedAt ?? null,
  anonymizationReason: r.anonymizationReason ?? null,
  latestActivityAt: latestNoteAt && latestNoteAt > (r.updatedAt ?? r.receivedAt)
    ? latestNoteAt
    : (r.updatedAt ?? r.receivedAt),
});

/**
 * The search WHERE fragment for an already-normalized term. Case-insensitive `contains` across the columns a
 * user would actually search, plus a digits-only phone probe ONLY when the term is phone-shaped — so a name
 * never becomes a phone query. Every value is a bound parameter.
 *
 * Phone matching is best-effort by design: it matches a digit fragment against the stored value, which finds
 * fragments of a contiguously-stored number (the form Meta supplies). A number stored with separators may not
 * match a fragment spanning one; that is documented rather than papered over with a fragile transform.
 */
/**
 * The lifecycle clause. An explicit lifecycle selects exactly that state; otherwise the default view shows only
 * ACTIVE contacts (spam / archived / anonymized are hidden until asked for).
 */
function lifecycleWhere(filters: BusinessContactFilters) {
  if (filters.lifecycle) return { lifecycleState: filters.lifecycle as never };
  return { lifecycleState: { notIn: [...DEFAULT_HIDDEN_LIFECYCLES] as never } };
}

/**
 * "Review recommended": the latest signal is older than the cutoff. Uses `receivedAt` and `updatedAt` (which
 * status, assignment and lifecycle changes all touch) so the newest of the two is what ages. Anonymized rows
 * are excluded — there is nothing left to review.
 */
function reviewWhere(filters: BusinessContactFilters) {
  if (!filters.needsReview) return {};
  const cutoff = contactReviewCutoff(filters.reviewThresholdDays ?? CONTACT_REVIEW_DEFAULT_DAYS);
  return {
    lifecycleState: { not: BusinessContactLifecycle.Anonymized as never },
    receivedAt: { lt: cutoff },
    updatedAt: { lt: cutoff },
  };
}

function searchWhere(term: string) {
  const digits = contactSearchPhoneDigits(term);
  const mode = "insensitive" as const;
  return {
    OR: [
      { fullName: { contains: term, mode } },
      { email: { contains: term, mode } },
      { company: { contains: term, mode } },
      { phone: { contains: term, mode } },
      ...(digits ? [{ phone: { contains: digits, mode } }] : []),
    ],
  };
}

/** Opaque keyset cursor `(receivedAtMs, id)` — base64url, strict decode (any malformation → first page). */
function encodeCursor(receivedAt: Date, id: string): string {
  return Buffer.from(`${receivedAt.getTime()}:${id}`).toString("base64url");
}
function decodeCursor(raw: string | null | undefined): { receivedAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [ms, id] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    const n = Number(ms);
    if (!Number.isFinite(n) || !id || !/^[a-z0-9]+$/i.test(id)) return null;
    return { receivedAt: new Date(n), id };
  } catch { return null; }
}

/** Bounded keyset page of the tenant's contacts (newest first), filtered. RLS-scoped. */
export async function listBusinessContacts(tenantId: string, filters: BusinessContactFilters, cursor?: string | null): Promise<BusinessContactPage> {
  const key = decodeCursor(cursor);
  return withTenant(tenantId, async (db) => {
    // AND-combined so search narrows the filters rather than widening them: the search OR-group and the
    // keyset OR-group are separate clauses and can never leak rows past either.
    const and: Record<string, unknown>[] = [];
    if (filters.search) and.push(searchWhere(filters.search));
    if (key) and.push({ OR: [{ receivedAt: { lt: key.receivedAt } }, { receivedAt: key.receivedAt, id: { lt: key.id } }] });
    const where = {
      ...(filters.status ? { status: asContactStatus(filters.status) } : {}),
      ...(filters.sourcePlatform ? { sourcePlatform: asSource(filters.sourcePlatform) } : {}),
      ...lifecycleWhere(filters),
      ...reviewWhere(filters),
      ...(and.length ? { AND: and } : {}),
    };
    const rows = await db.businessContact.findMany({
      where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = hasMore ? page[page.length - 1] : null;
    // One bounded aggregate for the page's ids (<= PAGE_SIZE) — never an N+1 per row.
    const noteMax = page.length
      ? await db.businessContactNote.groupBy({
          by: ["contactId"], where: { contactId: { in: page.map((r) => r.id) } }, _max: { createdAt: true },
        })
      : [];
    const latestNote = new Map(noteMax.map((g) => [g.contactId, g._max.createdAt ?? null]));
    return {
      items: page.map((r) => mapContact(r, latestNote.get(r.id) ?? null)),
      nextCursor: last ? encodeCursor(last.receivedAt, last.id) : null,
    };
  });
}

/** Total + per-status counts for the tenant (respecting the sourcePlatform filter, ignoring the status filter). */
export async function businessContactCounts(tenantId: string, filters: BusinessContactFilters): Promise<{ total: number; byStatus: Record<BusinessContactStatus, number> }> {
  return withTenant(tenantId, async (db) => {
    const base = {
      ...(filters.sourcePlatform ? { sourcePlatform: asSource(filters.sourcePlatform) } : {}),
      ...lifecycleWhere(filters),
      ...reviewWhere(filters),
      ...(filters.search ? searchWhere(filters.search) : {}),
    };
    const grouped = await db.businessContact.groupBy({ by: ["status"], where: base, _count: { _all: true } });
    const byStatus: Record<BusinessContactStatus, number> = {
      [BusinessContactStatus.New]: 0, [BusinessContactStatus.Contacted]: 0, [BusinessContactStatus.Handled]: 0,
      [BusinessContactStatus.Customer]: 0, [BusinessContactStatus.Rejected]: 0,
    };
    let total = 0;
    for (const g of grouped) { const n = g._count._all; byStatus[g.status as BusinessContactStatus] = n; total += n; }
    return { total, byStatus };
  });
}

/** One own-tenant contact (full detail). Returns null if not found (cross-tenant fails closed via RLS). */
export async function getBusinessContact(tenantId: string, id: string): Promise<(BusinessContactRow & { externalLeadId: string | null; adName: string | null; campaignId: string | null; consentReference: string | null; consentVersion: string | null }) | null> {
  return withTenant(tenantId, async (db) => {
    const r = await db.businessContact.findFirst({ where: { id } });
    if (!r) return null;
    return {
      ...mapContact(r),
      externalLeadId: r.externalLeadId, adName: r.adName, campaignId: r.campaignId,
      consentReference: r.consentReference, consentVersion: r.consentVersion,
    };
  });
}

export type ContactMutationResult = { ok: true } | { ok: false; reason: "not_found" | "invalid_transition" | "invalid_input" };

/** Change a contact's status, validating the transition. Idempotent (same status → ok). RLS-scoped. */
export async function setBusinessContactStatus(tenantId: string, id: string, to: BusinessContactStatus): Promise<ContactMutationResult> {
  return withTenant(tenantId, async (db) => {
    const c = await db.businessContact.findFirst({ where: { id }, select: { status: true } });
    if (!c) return { ok: false, reason: "not_found" };
    const from = c.status as unknown as BusinessContactStatus;
    if (from === to) return { ok: true };
    if (!canTransitionContactStatus(from, to)) return { ok: false, reason: "invalid_transition" };
    await db.businessContact.update({ where: { id }, data: { status: asContactStatus(to) } });
    return { ok: true };
  });
}

/** Assign (or unassign, assigneeUserId=null) a contact to a tenant member. RLS-scoped. */
export async function assignBusinessContact(tenantId: string, id: string, assigneeUserId: string | null): Promise<ContactMutationResult> {
  return withTenant(tenantId, async (db) => {
    // If assigning, the assignee must be a member of THIS tenant (fail closed on cross-tenant/unknown user).
    if (assigneeUserId) {
      const member = await db.membership.findFirst({ where: { userId: assigneeUserId, tenantId }, select: { userId: true } });
      if (!member) return { ok: false, reason: "invalid_input" };
    }
    const r = await db.businessContact.updateMany({ where: { id }, data: { assignedUserId: assigneeUserId } });
    return r.count > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  });
}

// =============================== INGESTION ====================================================================
export interface BusinessContactInput {
  provider: BusinessProvider;
  sourcePlatform: BusinessContactSource;
  connectionId?: string | null;
  externalLeadId?: string | null;
  /** Optional caller fingerprint of the content, used only when there is no stable external id. */
  contentFingerprint?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  messageSummary?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  formId?: string | null;
  formName?: string | null;
  receivedAt: Date;
  consentValue?: boolean | null;
  consentReference?: string | null;
  consentVersion?: string | null;
}

export interface IngestionMeta {
  providerEventId?: string | null;
  payloadHash: string;
  signatureVerified: boolean;
}
export interface BusinessIngestOutcome { result: BusinessIngestionResult; contactId: string | null; duplicate: boolean }

/** Append one bounded ingestion-event row (SELECT/INSERT-only table). Never stores a raw payload or PII. */
export async function recordBusinessIngestionEvent(tenantId: string, ev: {
  provider: BusinessProvider; providerEventId?: string | null; payloadHash: string; signatureVerified: boolean;
  result: BusinessIngestionResult; errorCode?: string | null; receivedAt: Date; processedAt?: Date | null; contactId?: string | null;
}): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.businessContactIngestionEvent.create({
      data: {
        tenantId, provider: asProvider(ev.provider), providerEventId: clamp(ev.providerEventId, 200),
        payloadHash: ev.payloadHash.slice(0, 128), signatureVerified: ev.signatureVerified, result: asResult(ev.result),
        errorCode: clamp(ev.errorCode, 80), receivedAt: ev.receivedAt, processedAt: ev.processedAt ?? null,
        contactId: ev.contactId ?? null,
      },
    });
  });
}

/**
 * Idempotently ingest one normalized contact and append the ingestion event. Uses `createMany({skipDuplicates})`
 * (ON CONFLICT DO NOTHING on the (tenantId, dedupeKey) unique index) so a replayed provider event never creates
 * a second contact. Returns accepted (new) or duplicate. Consent is stored ONLY as supplied.
 */
export async function ingestBusinessContact(tenantId: string, input: BusinessContactInput, meta: IngestionMeta): Promise<BusinessIngestOutcome> {
  const dedupeKey = createHash("sha256").update(businessContactDedupeSeed({
    provider: input.provider, source: input.sourcePlatform, externalLeadId: input.externalLeadId,
    formId: input.formId, contentFingerprint: input.contentFingerprint,
  })).digest("hex");

  const outcome = await withTenant(tenantId, async (db) => {
    const created = await db.businessContact.createMany({
      data: [{
        tenantId, connectionId: input.connectionId ?? null, provider: asProvider(input.provider),
        sourcePlatform: asSource(input.sourcePlatform), externalLeadId: clamp(input.externalLeadId, 200), dedupeKey,
        fullName: clamp(input.fullName, 200), email: clamp(input.email, 320), phone: clamp(input.phone, 60),
        company: clamp(input.company, 200), messageSummary: clamp(input.messageSummary, 1000),
        campaignId: clamp(input.campaignId, 200), campaignName: clamp(input.campaignName, 200),
        adId: clamp(input.adId, 200), adName: clamp(input.adName, 200),
        formId: clamp(input.formId, 200), formName: clamp(input.formName, 200),
        receivedAt: input.receivedAt, status: asContactStatus(BusinessContactStatus.New),
        // Consent ONLY as supplied — a missing value stays null (never inferred/defaulted to granted).
        consentValue: typeof input.consentValue === "boolean" ? input.consentValue : null,
        consentReference: clamp(input.consentReference, 200), consentVersion: clamp(input.consentVersion, 60),
      }],
      skipDuplicates: true,
    });
    const row = await db.businessContact.findFirst({ where: { dedupeKey }, select: { id: true } });
    return { created: created.count === 1, contactId: row?.id ?? null };
  });

  const result = outcome.created ? BusinessIngestionResult.Accepted : BusinessIngestionResult.Duplicate;
  await recordBusinessIngestionEvent(tenantId, {
    provider: input.provider, providerEventId: meta.providerEventId, payloadHash: meta.payloadHash,
    signatureVerified: meta.signatureVerified, result, receivedAt: input.receivedAt, processedAt: new Date(),
    contactId: outcome.contactId,
  });
  return { result, contactId: outcome.contactId, duplicate: !outcome.created };
}


// =============================== CRM V2: NOTES + TIMELINE =====================================================
/** Strict upper bound on notes/audit rows read for one contact timeline. */
export const CONTACT_TIMELINE_MAX_EVENTS = 50;

export type ContactNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; reason: "not_found" | "invalid_input" | "too_long" };

/**
 * Append one internal note to a contact. APPEND-ONLY: there is no update or delete path, and the app role
 * holds no UPDATE/DELETE grant on the table.
 *
 * Tenant comes from the caller's authenticated session (never the client) and RLS scopes every statement, so a
 * contact id belonging to another tenant simply does not resolve and returns `not_found` before any write. The
 * author is likewise server-supplied. The body is validated + normalized to bounded PLAIN TEXT.
 */
export async function addBusinessContactNote(
  tenantId: string,
  contactId: string,
  authorUserId: string,
  rawBody: string,
): Promise<ContactNoteResult> {
  const id = typeof contactId === "string" ? contactId.trim() : "";
  if (!id) return { ok: false, reason: "invalid_input" };
  const validated = validateContactNoteBody(rawBody);
  if (!validated.ok) return { ok: false, reason: validated.reason === "too_long" ? "too_long" : "invalid_input" };

  return withTenant(tenantId, async (db) => {
    // Cross-tenant fails closed here: RLS makes a foreign contact invisible, so this is `not_found`.
    const contact = await db.businessContact.findFirst({ where: { id }, select: { id: true } });
    if (!contact) return { ok: false, reason: "not_found" as const };
    const note = await db.businessContactNote.create({
      data: { tenantId, contactId: id, authorUserId, body: validated.body },
      select: { id: true },
    });
    return { ok: true as const, noteId: note.id };
  });
}

/** One contact's notes, oldest first, bounded. Tenant-scoped (RLS) — a foreign contact id yields []. */
export async function listBusinessContactNotes(
  tenantId: string,
  contactId: string,
  limit: number = CONTACT_TIMELINE_MAX_EVENTS,
): Promise<ContactNoteRecord[]> {
  const take = Math.max(1, Math.min(limit, CONTACT_TIMELINE_MAX_EVENTS));
  return withTenant(tenantId, async (db) => {
    const rows = await db.businessContactNote.findMany({
      where: { contactId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
      select: { createdAt: true, authorUserId: true, body: true, redactedAt: true },
    });
    // Read newest-first (so the bound keeps the most recent), render oldest-first.
    return rows.reverse();
  });
}

/**
 * The contact's status + assignment history from the EXISTING tenant-scoped audit ledger. No dedicated
 * activity model exists or is needed: `writeAudit` already records these with
 * `targetType="business_contact"`, `targetId=<contactId>`, and `audit_logs` is RLS-scoped and indexed on
 * `(tenantId, targetType, targetId)`.
 *
 * Only the two bounded event names are read, and only PII-free columns are selected — metadata is
 * `{ to }` / `{ assigned }` by construction.
 */
export async function listBusinessContactAuditTrail(
  tenantId: string,
  contactId: string,
  limit: number = CONTACT_TIMELINE_MAX_EVENTS,
): Promise<ContactAuditRecord[]> {
  const take = Math.max(1, Math.min(limit, CONTACT_TIMELINE_MAX_EVENTS));
  return withTenant(tenantId, async (db) => {
    const rows = await db.auditLog.findMany({
      where: {
        tenantId, targetType: "business_contact", targetId: contactId,
        event: { in: [CONTACT_STATUS_AUDIT_EVENT, CONTACT_ASSIGNMENT_AUDIT_EVENT, ...Object.keys(CONTACT_LIFECYCLE_AUDIT_EVENTS)] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
      select: { event: true, createdAt: true, actorUserId: true, metadata: true },
    });
    return rows.reverse().map((r) => ({
      event: r.event,
      createdAt: r.createdAt,
      actorUserId: r.actorUserId,
      metadata: (r.metadata ?? null) as ContactAuditRecord["metadata"],
    }));
  });
}


// =============================== CRM V2 PHASE B: BULK + EXPORT ================================================
/**
 * Per-contact audit rows for a bulk change, written INSIDE the same tenant transaction as the mutation so an
 * individual contact's timeline can never disagree with what actually changed. These carry the contact id as
 * `targetId` — exactly like the existing single-contact actions — and PII-free metadata. The separate BULK
 * audit event (written by the caller) carries counts only and no ids.
 */
async function writeContactAudits(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  actorUserId: string,
  ids: readonly string[],
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (ids.length === 0) return;
  await db.auditLog.createMany({
    data: ids.map((id) => ({
      tenantId, event, actorKind: ActorKind.human, actorUserId,
      targetType: "business_contact", targetId: id, metadata: metadata as never,
    })),
  });
}

/**
 * Bulk status change over an explicitly selected, bounded set of contacts.
 *
 * Tenant-scoped throughout (RLS): only ids visible to THIS tenant are loaded, so a foreign id is
 * indistinguishable from a deleted one — both report `not_found`, which is what prevents the operation from
 * leaking whether another tenant's contact exists.
 *
 * The existing domain rule (`canTransitionContactStatus`) is applied per contact — it is NOT bypassed — so the
 * operation cannot be a single blanket UPDATE. It is still ATOMIC for the valid set: the load, the partition
 * and one `updateMany` for the contacts that may legally transition all run in ONE tenant transaction, together
 * with their per-contact audit rows. Contacts that cannot transition are reported deterministically rather than
 * silently skipped.
 */
export async function bulkSetBusinessContactStatus(
  tenantId: string,
  ids: readonly string[],
  to: BusinessContactStatus,
  actorUserId: string,
): Promise<BulkContactOutcome> {
  const bounded = ids.slice(0, MAX_BULK_CONTACT_IDS);
  if (bounded.length === 0) return { changed: [], failed: [] };
  return withTenant(tenantId, async (db) => {
    const rows = await db.businessContact.findMany({
      where: { id: { in: [...bounded] } }, select: { id: true, status: true },
    });
    const found = new Map(rows.map((r) => [r.id, r.status as unknown as BusinessContactStatus]));
    const changed: string[] = [];
    const failed: BulkContactOutcome["failed"] = [];
    for (const id of bounded) {
      const from = found.get(id);
      // A foreign / unknown id is invisible under RLS — identical outcome, so existence never leaks.
      if (from === undefined) { failed.push({ id, reason: "not_found" }); continue; }
      if (from === to) { changed.push(id); continue; } // idempotent, same as the single-contact action
      if (!canTransitionContactStatus(from, to)) { failed.push({ id, reason: "invalid_transition" }); continue; }
      changed.push(id);
    }
    const toWrite = changed.filter((id) => found.get(id) !== to);
    if (toWrite.length > 0) {
      await db.businessContact.updateMany({ where: { id: { in: toWrite } }, data: { status: asContactStatus(to) } });
      // Individual timeline accuracy — one row per contact that actually changed.
      await writeContactAudits(db, tenantId, actorUserId, toWrite, CONTACT_STATUS_AUDIT_EVENT, { to });
    }
    return { changed, failed };
  });
}

/**
 * Bulk assign / unassign over an explicitly selected, bounded set of contacts.
 *
 * The assignee is validated ONCE against this tenant's memberships before any mutation, so a foreign, unknown
 * or non-member user id can never be written. `null` unassigns. Fully atomic: one `updateMany` plus the
 * per-contact audit rows in one tenant transaction.
 */
export async function bulkAssignBusinessContacts(
  tenantId: string,
  ids: readonly string[],
  assigneeUserId: string | null,
  actorUserId: string,
): Promise<BulkContactOutcome | { invalidAssignee: true }> {
  const bounded = ids.slice(0, MAX_BULK_CONTACT_IDS);
  if (bounded.length === 0) return { changed: [], failed: [] };
  return withTenant(tenantId, async (db) => {
    if (assigneeUserId) {
      const member = await db.membership.findFirst({ where: { userId: assigneeUserId, tenantId }, select: { userId: true } });
      if (!member) return { invalidAssignee: true as const };
    }
    const rows = await db.businessContact.findMany({ where: { id: { in: [...bounded] } }, select: { id: true } });
    const found = new Set(rows.map((r) => r.id));
    const changed = bounded.filter((id) => found.has(id));
    const failed = bounded.filter((id) => !found.has(id)).map((id) => ({ id, reason: "not_found" as const }));
    if (changed.length > 0) {
      await db.businessContact.updateMany({ where: { id: { in: changed } }, data: { assignedUserId: assigneeUserId } });
      await writeContactAudits(db, tenantId, actorUserId, changed, CONTACT_ASSIGNMENT_AUDIT_EVENT, { assigned: assigneeUserId !== null });
    }
    return { changed, failed };
  });
}

export interface ContactExportResult {
  rows: ContactExportSource[];
  /** True when more contacts matched than the bound allowed — the UI must say so, never imply completeness. */
  limited: boolean;
}

/**
 * Bounded, filtered, tenant-scoped export read.
 *
 * Honours exactly the same server-side filters as the list (search + status + source) so what a user exports is
 * what they were looking at. Ordering is the same deterministic `receivedAt desc, id desc`. Reads at most
 * {@link CONTACT_EXPORT_MAX_ROWS} + 1 rows — the extra row is how `limited` is detected without a second
 * COUNT over the whole table.
 *
 * No N+1: tenant members are fetched once and the newest note per contact comes from a single `groupBy`.
 * Notes themselves are never loaded, and no activity/audit rows are read at all.
 */
export async function exportBusinessContacts(
  tenantId: string,
  filters: BusinessContactFilters,
  limit: number = CONTACT_EXPORT_MAX_ROWS,
): Promise<ContactExportResult> {
  const take = Math.max(1, Math.min(limit, CONTACT_EXPORT_MAX_ROWS));
  return withTenant(tenantId, async (db) => {
    const where = {
      ...(filters.status ? { status: asContactStatus(filters.status) } : {}),
      ...(filters.sourcePlatform ? { sourcePlatform: asSource(filters.sourcePlatform) } : {}),
      // Lifecycle is honoured here exactly as in the list: anonymized, spam and archived contacts are NEVER in
      // a default export — they only appear when that lifecycle was explicitly selected.
      ...lifecycleWhere(filters),
      ...reviewWhere(filters),
      ...(filters.search ? { AND: [searchWhere(filters.search)] } : {}),
    };
    const rows = await db.businessContact.findMany({
      where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: take + 1,
      select: {
        id: true, fullName: true, email: true, phone: true, company: true, sourcePlatform: true,
        campaignName: true, formName: true, receivedAt: true, status: true, assignedUserId: true, updatedAt: true,
        lifecycleState: true,
      },
    });
    const limited = rows.length > take;
    const page = limited ? rows.slice(0, take) : rows;

    // ONE membership read for the whole export (no per-row lookup).
    const members = await db.membership.findMany({ include: { user: { select: { email: true } } } });
    const memberEmail = new Map(members.map((m) => [m.userId, m.user?.email ?? null]));
    // ONE aggregate for the newest note per contact — note bodies are never read.
    const noteMax = page.length
      ? await db.businessContactNote.groupBy({
          by: ["contactId"], where: { contactId: { in: page.map((r) => r.id) } }, _max: { createdAt: true },
        })
      : [];
    const latestNote = new Map(noteMax.map((g) => [g.contactId, g._max.createdAt ?? null]));

    return {
      limited,
      rows: page.map((r) => {
        const noteAt = latestNote.get(r.id) ?? null;
        const base = r.updatedAt ?? r.receivedAt;
        return {
          lifecycleState: r.lifecycleState as BusinessContactLifecycle,
          fullName: r.fullName, email: r.email, phone: r.phone, company: r.company,
          sourcePlatform: r.sourcePlatform as BusinessContactSource,
          campaignName: r.campaignName, formName: r.formName,
          receivedAt: r.receivedAt, status: r.status as BusinessContactStatus,
          // A safe tenant-member display value, never a raw user id.
          assignedTo: r.assignedUserId ? memberEmail.get(r.assignedUserId) ?? null : null,
          latestActivityAt: noteAt && noteAt > base ? noteAt : base,
        };
      }),
    };
  });
}


// =============================== CRM V2 PHASE C: PRIVACY LIFECYCLE ===========================================
export type LifecycleMutationResult =
  | { ok: true; from: BusinessContactLifecycle }
  | { ok: false; reason: "not_found" | "invalid_transition" };

/**
 * Move ONE tenant-scoped contact to a new privacy lifecycle state (archive / unarchive / spam / restore).
 *
 * Tenant-scoped throughout (RLS): a foreign contact id is invisible and returns `not_found`, identical to a
 * deleted one, so the action never confirms another tenant's contact exists. The transition rule is the shared
 * domain function — `anonymized` has no outgoing edge, so this can never un-anonymize anything, and this
 * function is deliberately NOT the anonymization path (that is `anonymizeBusinessContact`).
 */
export async function setBusinessContactLifecycle(
  tenantId: string,
  id: string,
  to: BusinessContactLifecycle,
): Promise<LifecycleMutationResult> {
  if (to === BusinessContactLifecycle.Anonymized) return { ok: false, reason: "invalid_transition" };
  return withTenant(tenantId, async (db) => {
    const row = await db.businessContact.findFirst({ where: { id }, select: { lifecycleState: true } });
    if (!row) return { ok: false, reason: "not_found" as const };
    const from = row.lifecycleState as BusinessContactLifecycle;
    if (from === to) return { ok: true as const, from };
    if (!canTransitionContactLifecycle(from, to)) return { ok: false, reason: "invalid_transition" as const };
    await db.businessContact.update({ where: { id }, data: { lifecycleState: to as never } });
    return { ok: true as const, from };
  });
}

export type AnonymizationResult =
  | { ok: true; previousLifecycle: BusinessContactLifecycle; notesRedacted: number; source: BusinessContactSource; alreadyAnonymized: boolean }
  | { ok: false; reason: "not_found" };

/**
 * IRREVERSIBLY anonymize one contact and redact every one of its note bodies — in ONE transaction.
 *
 * CONCURRENCY. The row is locked with `SELECT … FOR UPDATE` before anything is read or written, so two
 * simultaneous requests serialize: the first performs the transition, the second observes `anonymized` and
 * returns idempotently. There is no lost update and no interleaving that could leave contact fields cleared
 * while note bodies remain readable — both happen inside the same transaction or neither does.
 *
 * INGESTION RACE. Ingestion inserts with `createMany(skipDuplicates)` keyed on `(tenantId, dedupeKey)` and
 * NEVER updates an existing row, so a provider replay arriving during or after this transaction cannot write
 * personal fields back. `dedupeKey` is deliberately retained for exactly that reason.
 *
 * WHAT IS CLEARED: the direct personal fields, plus `externalLeadId` — a pseudonymous provider identifier that
 * would otherwise let anyone holding the lead id re-link the tombstone to the person. Assignment is cleared.
 * The previous values are written nowhere: no archive table, no audit metadata, no event, no log.
 *
 * WHAT IS KEPT: the row itself as a non-identifying tombstone (so audit references, operational counts and
 * replay protection stay valid), `dedupeKey`, the operational provider/campaign/form metadata, `receivedAt`,
 * and the two new non-identifying facts — `anonymizedAt` and a bounded reason category.
 *
 * NOTE REDACTION uses the column-scoped UPDATE grant added by the Phase C migration: the app role may write
 * only `body` and `redactedAt`, and still cannot delete a note or rewrite its author or timestamps, so the
 * append-only guarantee survives for every ordinary path.
 */
export async function anonymizeBusinessContact(
  tenantId: string,
  id: string,
  reason: ContactAnonymizationReason | null,
  now: Date = new Date(),
): Promise<AnonymizationResult> {
  return withTenant(tenantId, async (db) => {
    // Row lock FIRST — everything below observes a serialized view of this contact. RLS still applies, so a
    // foreign id locks nothing and yields an empty result.
    const locked = await db.$queryRaw<Array<{ id: string; lifecycleState: string; sourcePlatform: string }>>`
      SELECT "id", "lifecycleState"::text AS "lifecycleState", "sourcePlatform"::text AS "sourcePlatform"
      FROM "business_contacts" WHERE "id" = ${id} FOR UPDATE
    `;
    const row = locked[0];
    if (!row) return { ok: false, reason: "not_found" as const };

    const previousLifecycle = row.lifecycleState as BusinessContactLifecycle;
    const source = row.sourcePlatform as BusinessContactSource;
    if (previousLifecycle === BusinessContactLifecycle.Anonymized) {
      // Idempotent: a repeat (or the loser of a concurrent race) changes nothing further.
      return { ok: true as const, previousLifecycle, notesRedacted: 0, source, alreadyAnonymized: true };
    }

    // Redact note bodies FIRST, so a failure anywhere aborts the whole transaction rather than leaving contact
    // fields cleared while note text is still readable.
    const redacted = await db.businessContactNote.updateMany({
      where: { contactId: id, body: { not: null } },
      data: { body: null, redactedAt: now },
    });

    await db.businessContact.update({
      where: { id },
      data: {
        // Direct personal data — cleared, never copied anywhere.
        fullName: null, email: null, phone: null, company: null, messageSummary: null,
        consentReference: null, consentVersion: null,
        // Assignment no longer means anything for a tombstone.
        assignedUserId: null,
        // Pseudonymous provider identifier that would re-link the tombstone to the person. `dedupeKey` is
        // KEPT — it is what stops a provider replay re-creating this contact.
        externalLeadId: null,
        lifecycleState: BusinessContactLifecycle.Anonymized as never,
        anonymizedAt: now,
        anonymizationReason: reason ?? null,
      },
    });
    return { ok: true as const, previousLifecycle, notesRedacted: redacted.count, source, alreadyAnonymized: false };
  });
}
