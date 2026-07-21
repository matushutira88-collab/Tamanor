import "server-only";
import { withTenant } from "@guardora/db";
import { Permission, Role, can, IncidentCategory, IncidentLifecycleStatus } from "@guardora/core";

/**
 * C4 — server-side READ MODEL for the Cyberbullying dashboard + incident inbox.
 * Every query is tenant-scoped (withTenant/RLS), permission-checked, and
 * SUBJECT-SCOPE aware (a filter ABOVE tenant RLS), returns bounded/paginated
 * sanitized VIEW-MODELS (never raw Prisma rows, never sensitive evidence content),
 * and uses Promise.all for independent reads. No business logic lives in the UI.
 */

const DOMAIN = IncidentCategory.Cyberbullying; // "cyberbullying"
const ACTIVE_OPEN = [IncidentLifecycleStatus.Open, IncidentLifecycleStatus.UnderReview, IncidentLifecycleStatus.Acknowledged, IncidentLifecycleStatus.Confirmed, IncidentLifecycleStatus.ActionRequired] as string[];

export type Actor = { tenantId: string; userId: string; role: string };

export class CyberbullyingAccessDenied extends Error {
  constructor() { super("cyberbullying: access denied"); this.name = "CyberbullyingAccessDenied"; }
}

/** Any read permission grants VIEW access; scope is decided separately. */
export function canViewCyberbullying(role: string): boolean {
  const r = role as Role;
  return can(r, Permission.CyberbullyingViewOwn) || can(r, Permission.CyberbullyingReview) || can(r, Permission.CyberbullyingManage) || can(r, Permission.CyberbullyingAudit);
}

type Scope = "tenant_wide" | "participant" | "deny";
/**
 * Subject scope (ABOVE tenant RLS). Admin/Owner + auditor read tenant-wide
 * metadata; a plain reviewer/protected-subject only sees incidents they
 * participate in (userId match). Fail-closed → deny.
 */
export function resolveInboxScope(actor: Actor): Scope {
  const r = actor.role as Role;
  if (r === Role.Owner || r === Role.Admin) return "tenant_wide";
  if (can(r, Permission.CyberbullyingAudit)) return "tenant_wide"; // metadata read (no sensitive-evidence access)
  if (can(r, Permission.CyberbullyingReview) || can(r, Permission.CyberbullyingViewOwn)) return "participant";
  return "deny";
}

function scopeWhere(actor: Actor) {
  const scope = resolveInboxScope(actor);
  if (scope === "deny") throw new CyberbullyingAccessDenied();
  const base = { tenantId: actor.tenantId, domain: DOMAIN } as Record<string, unknown>;
  if (scope === "participant") base.participants = { some: { userId: actor.userId } };
  return base;
}

// --- KPIs ------------------------------------------------------------------

export interface CyberbullyingKpis {
  open: number;
  underReview: number;
  actionRequired: number;
  resolved: number;
  withoutEvidence: number;
  createdInWindow: number;
  linkedDetections: number;
  avgOpenAgeHours: number | null;
}

export async function getCyberbullyingDashboardKpis(actor: Actor, tfDays: number): Promise<CyberbullyingKpis> {
  const where = scopeWhere(actor);
  const since = new Date(Date.now() - tfDays * 86_400_000);
  return withTenant(actor.tenantId, async (db) => {
    const [open, underReview, actionRequired, resolved, withoutEvidence, createdInWindow, linkedDetections, openRows] = await Promise.all([
      db.incident.count({ where: { ...where, status: IncidentLifecycleStatus.Open } }),
      db.incident.count({ where: { ...where, status: IncidentLifecycleStatus.UnderReview } }),
      db.incident.count({ where: { ...where, status: IncidentLifecycleStatus.ActionRequired } }),
      db.incident.count({ where: { ...where, status: IncidentLifecycleStatus.Resolved } }),
      db.incident.count({ where: { ...where, status: { in: ACTIVE_OPEN }, evidence: { none: {} } } }),
      db.incident.count({ where: { ...where, createdAt: { gte: since } } }),
      db.incidentDetectionLink.count({ where: { tenantId: actor.tenantId, incident: { is: where } } }),
      db.incident.findMany({ where: { ...where, status: { in: ACTIVE_OPEN } }, select: { createdAt: true } }),
    ]);
    const now = Date.now();
    const avgOpenAgeHours = openRows.length === 0 ? null : Math.round(openRows.reduce((s, r) => s + (now - r.createdAt.getTime()), 0) / openRows.length / 3_600_000);
    return { open, underReview, actionRequired, resolved, withoutEvidence, createdInWindow, linkedDetections, avgOpenAgeHours };
  });
}

// --- Inbox -----------------------------------------------------------------

export type InboxSort = "newest" | "oldest" | "recently_updated" | "status_priority";
export interface InboxFilters {
  status?: string;
  reportSource?: string;
  protectedSubjectId?: string;
  evidence?: "has" | "none";
  detections?: "has" | "manual_only";
  tfDays?: number;
  search?: string;
}
export interface InboxItem {
  id: string;
  subjectLabel: string | null;
  status: string;
  category: string;
  reportSource: string | null;
  allegedActorLabel: string | null;
  detectionCount: number;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string | null;
}
export interface InboxPage {
  items: InboxItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function orderByFor(sort: InboxSort) {
  switch (sort) {
    case "oldest": return [{ createdAt: "asc" as const }];
    case "recently_updated": return [{ cyberbullyingDetail: { updatedAt: "desc" as const } }];
    case "status_priority": return [{ status: "asc" as const }, { createdAt: "desc" as const }]; // grouped by status
    default: return [{ createdAt: "desc" as const }];
  }
}

export async function listCyberbullyingIncidentInbox(actor: Actor, opts: { filters?: InboxFilters; sort?: InboxSort; page?: number; pageSize?: number } = {}): Promise<InboxPage> {
  const base = scopeWhere(actor);
  const f = opts.filters ?? {};
  const where: Record<string, unknown> = { ...base };
  if (f.status) where.status = f.status;
  if (f.reportSource) where.cyberbullyingDetail = { is: { reportSource: f.reportSource } };
  if (f.protectedSubjectId) where.cyberbullyingDetail = { is: { ...(where.cyberbullyingDetail as { is?: object } | undefined)?.is, protectedSubjectId: f.protectedSubjectId } };
  if (f.evidence === "has") where.evidence = { some: {} };
  if (f.evidence === "none") where.evidence = { none: {} };
  if (f.detections === "has") where.detectionLinks = { some: {} };
  if (f.detections === "manual_only") where.detectionLinks = { none: {} };
  if (f.tfDays) where.createdAt = { gte: new Date(Date.now() - f.tfDays * 86_400_000) };
  if (f.search && f.search.trim()) {
    const q = f.search.trim();
    where.OR = [{ id: { contains: q } }, { cyberbullyingDetail: { is: { subject: { is: { displayLabel: { contains: q, mode: "insensitive" } } } } } }];
  }
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? PAGE_SIZE));

  return withTenant(actor.tenantId, async (db) => {
    const [rows, total] = await Promise.all([
      db.incident.findMany({
        where,
        orderBy: orderByFor(opts.sort ?? "newest"),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, status: true, category: true, createdAt: true,
          cyberbullyingDetail: { select: { reportSource: true, allegedActorLabel: true, updatedAt: true, subject: { select: { displayLabel: true } } } },
          _count: { select: { detectionLinks: true, evidence: true } },
        },
      }),
      db.incident.count({ where }),
    ]);
    const items: InboxItem[] = rows.map((r) => ({
      id: r.id,
      subjectLabel: r.cyberbullyingDetail?.subject?.displayLabel ?? null,
      status: r.status,
      category: r.category,
      reportSource: r.cyberbullyingDetail?.reportSource ?? null,
      allegedActorLabel: r.cyberbullyingDetail?.allegedActorLabel ?? null,
      detectionCount: r._count.detectionLinks,
      evidenceCount: r._count.evidence,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.cyberbullyingDetail?.updatedAt?.toISOString() ?? null,
    }));
    return { items, total, page, pageSize };
  });
}

// --- Detail ----------------------------------------------------------------

export interface DetailEvidenceMeta {
  id: string;
  evidenceType: string;
  sourceType: string;
  captureMethod: string;
  capturedAt: string;
  mimeType: string | null;
  sizeBytes: number;
  integrityStatus: string;
  scanStatus: string;
  legalHold: boolean;
  retentionUntil: string | null;
}
export interface IncidentDetailVM {
  id: string;
  status: string;
  category: string;
  createdAt: string;
  updatedAt: string | null;
  subjectLabel: string | null;
  reportSource: string | null;
  summary: string | null;
  allegedActorLabel: string | null;
  participants: { id: string; role: string; subjectLabel: string | null; hasExternalRef: boolean }[];
  detections: { id: string; kind: string; severity: string; status: string; detectionStatus: string; linkedAt: string }[];
  evidence: DetailEvidenceMeta[];
  timeline: { id: string; eventType: string; hasActor: boolean; reason: string | null; createdAt: string }[];
}

export async function getCyberbullyingIncidentDetail(actor: Actor, incidentId: string): Promise<IncidentDetailVM | null> {
  const base = scopeWhere(actor);
  return withTenant(actor.tenantId, async (db) => {
    const inc = await db.incident.findFirst({
      where: { ...base, id: incidentId },
      select: {
        id: true, status: true, category: true, createdAt: true,
        cyberbullyingDetail: { select: { reportSource: true, summary: true, allegedActorLabel: true, updatedAt: true, subject: { select: { displayLabel: true } } } },
        participants: { select: { id: true, role: true, externalReference: true, subject: { select: { displayLabel: true } } } },
        detectionLinks: { select: { id: true, createdAt: true, detection: { select: { kind: true, severity: true, status: true } } } },
        evidence: { select: { id: true, evidenceType: true, sourceType: true, captureMethod: true, capturedAt: true, mimeType: true, sizeBytes: true, integrityStatus: true, scanStatus: true, legalHold: true, retentionUntil: true } },
        timelineEvents: { orderBy: { createdAt: "asc" }, select: { id: true, eventType: true, actorUserId: true, reason: true, createdAt: true } },
      },
    });
    if (!inc) return null;
    // Sanitized view-model — NO storageKey / contentHash / hash / binary / raw payload.
    return {
      id: inc.id,
      status: inc.status,
      category: inc.category,
      createdAt: inc.createdAt.toISOString(),
      updatedAt: inc.cyberbullyingDetail?.updatedAt?.toISOString() ?? null,
      subjectLabel: inc.cyberbullyingDetail?.subject?.displayLabel ?? null,
      reportSource: inc.cyberbullyingDetail?.reportSource ?? null,
      summary: inc.cyberbullyingDetail?.summary ?? null,
      allegedActorLabel: inc.cyberbullyingDetail?.allegedActorLabel ?? null,
      participants: inc.participants.map((p) => ({ id: p.id, role: p.role, subjectLabel: p.subject?.displayLabel ?? null, hasExternalRef: !!p.externalReference })),
      detections: inc.detectionLinks.map((l) => ({ id: l.id, kind: l.detection.kind, severity: String(l.detection.severity), status: l.detection.status, detectionStatus: l.detection.status, linkedAt: l.createdAt.toISOString() })),
      evidence: inc.evidence.map((e) => ({ id: e.id, evidenceType: e.evidenceType, sourceType: e.sourceType, captureMethod: e.captureMethod, capturedAt: e.capturedAt.toISOString(), mimeType: e.mimeType, sizeBytes: e.sizeBytes, integrityStatus: e.integrityStatus, scanStatus: e.scanStatus, legalHold: e.legalHold, retentionUntil: e.retentionUntil?.toISOString() ?? null })),
      timeline: inc.timelineEvents.map((t) => ({ id: t.id, eventType: t.eventType, hasActor: !!t.actorUserId, reason: t.reason, createdAt: t.createdAt.toISOString() })),
    };
  });
}

// --- Filter options --------------------------------------------------------

export async function getCyberbullyingFilterOptions(actor: Actor): Promise<{ subjects: { id: string; label: string }[] }> {
  const base = scopeWhere(actor);
  return withTenant(actor.tenantId, async (db) => {
    const details = await db.cyberbullyingIncidentDetail.findMany({
      where: { tenantId: actor.tenantId, incident: { is: base } },
      select: { protectedSubjectId: true, subject: { select: { displayLabel: true } } },
      distinct: ["protectedSubjectId"],
      take: 200,
    });
    return { subjects: details.map((d) => ({ id: d.protectedSubjectId, label: d.subject?.displayLabel ?? d.protectedSubjectId })) };
  });
}

/** Count of open cyberbullying incidents for the Security Center entry (scoped). */
export async function countOpenCyberbullyingIncidents(actor: Actor): Promise<number> {
  if (!canViewCyberbullying(actor.role)) return 0;
  const where = scopeWhere(actor);
  return withTenant(actor.tenantId, (db) => db.incident.count({ where: { ...where, status: { in: ACTIVE_OPEN } } }));
}
