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
} from "@guardora/core";
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
}

export interface BusinessContactFilters {
  status?: BusinessContactStatus;
  sourcePlatform?: BusinessContactSource;
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
  consentValue: boolean | null; createdAt: Date;
}): BusinessContactRow => ({
  id: r.id,
  provider: r.provider as BusinessProvider,
  sourcePlatform: r.sourcePlatform as BusinessContactSource,
  fullName: r.fullName, email: r.email, phone: r.phone, company: r.company,
  messageSummary: r.messageSummary, campaignName: r.campaignName, formName: r.formName,
  receivedAt: r.receivedAt, status: r.status as BusinessContactStatus, assignedUserId: r.assignedUserId,
  consentValue: r.consentValue, createdAt: r.createdAt,
});

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
    const where = {
      ...(filters.status ? { status: asContactStatus(filters.status) } : {}),
      ...(filters.sourcePlatform ? { sourcePlatform: asSource(filters.sourcePlatform) } : {}),
      ...(key ? { OR: [{ receivedAt: { lt: key.receivedAt } }, { receivedAt: key.receivedAt, id: { lt: key.id } }] } : {}),
    };
    const rows = await db.businessContact.findMany({
      where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = hasMore ? page[page.length - 1] : null;
    return { items: page.map(mapContact), nextCursor: last ? encodeCursor(last.receivedAt, last.id) : null };
  });
}

/** Total + per-status counts for the tenant (respecting the sourcePlatform filter, ignoring the status filter). */
export async function businessContactCounts(tenantId: string, filters: BusinessContactFilters): Promise<{ total: number; byStatus: Record<BusinessContactStatus, number> }> {
  return withTenant(tenantId, async (db) => {
    const base = filters.sourcePlatform ? { sourcePlatform: asSource(filters.sourcePlatform) } : {};
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
