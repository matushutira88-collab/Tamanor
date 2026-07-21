import "server-only";
import { withTenant } from "@guardora/db";
import {
  can, Role, Permission,
  CyberbullyingDetectionStatus, availableDetectionActions, type AvailableDetectionActions,
} from "@guardora/core";

/**
 * C8 — server-side READ MODEL for the cyberbullying Detection Queue + detail. Reads
 * the EXISTING SecurityDetection ledger with the cyberbullying triage overlay
 * (default status `new` when no triage row). Tenant-scoped (RLS), permission-checked
 * (`cyberbullying:review`), returns bounded/paginated sanitized VIEW-MODELS — never
 * raw Prisma rows and never the raw signal `evidence` JSON. No business logic in UI.
 */

export type DetectionActor = { tenantId: string; userId: string; role: string };
const DS = CyberbullyingDetectionStatus;

export class DetectionAccessDenied extends Error { constructor() { super("cyberbullying detections: access denied"); this.name = "DetectionAccessDenied"; } }

/** The triage queue is a reviewer surface — requires `cyberbullying:review`. */
export function canTriageDetections(role: string): boolean {
  return can(role as Role, Permission.CyberbullyingReview);
}
function assertAccess(actor: DetectionActor): void { if (!canTriageDetections(actor.role)) throw new DetectionAccessDenied(); }

export type DetectionSort = "newest" | "oldest" | "severity" | "status";
export interface DetectionFilters { status?: string; severity?: string; kind?: string; subjectType?: string; search?: string }
export interface DetectionQueueItem {
  id: string; detectedAt: string; source: string | null; kind: string;
  severity: string; subjectType: string; subjectId: string;
  status: string; incidentId: string | null; linked: boolean; occurrenceCount: number;
}
export interface DetectionQueuePage { items: DetectionQueueItem[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Triage-status filter clause. `new` = no triage row OR an explicit `new` row. */
function statusClause(status: string): Record<string, unknown> {
  if (status === DS.New) return { OR: [{ cyberbullyingTriage: { is: null } }, { cyberbullyingTriage: { is: { status: DS.New } } }] };
  return { cyberbullyingTriage: { is: { status } } };
}

function orderBy(sort: DetectionSort) {
  switch (sort) {
    case "oldest": return [{ detectedAt: "asc" as const }];
    case "severity": return [{ severity: "desc" as const }, { detectedAt: "desc" as const }];
    case "status": return [{ status: "asc" as const }, { detectedAt: "desc" as const }];
    default: return [{ detectedAt: "desc" as const }];
  }
}

export async function getCyberbullyingDetectionQueue(actor: DetectionActor, opts: { filters?: DetectionFilters; sort?: DetectionSort; page?: number; pageSize?: number } = {}): Promise<DetectionQueuePage> {
  assertAccess(actor);
  const f = opts.filters ?? {};
  const and: Record<string, unknown>[] = [];
  if (f.status) and.push(statusClause(f.status));
  if (f.severity) and.push({ severity: f.severity });
  if (f.kind) and.push({ kind: f.kind });
  if (f.subjectType) and.push({ subjectType: f.subjectType });
  if (f.search && f.search.trim()) {
    const q = f.search.trim();
    and.push({ OR: [{ id: { contains: q } }, { subjectId: { contains: q, mode: "insensitive" } }] });
  }
  const where: Record<string, unknown> = { tenantId: actor.tenantId, ...(and.length ? { AND: and } : {}) };
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? PAGE_SIZE));

  return withTenant(actor.tenantId, async (db) => {
    const [rows, total] = await Promise.all([
      db.securityDetection.findMany({
        where, orderBy: orderBy(opts.sort ?? "newest"), skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, detectedAt: true, source: true, kind: true, severity: true, subjectType: true, subjectId: true, occurrenceCount: true,
          cyberbullyingTriage: { select: { status: true, incidentId: true } },
          _count: { select: { incidentLinks: true } },
        },
      }),
      db.securityDetection.count({ where }),
    ]);
    const items: DetectionQueueItem[] = rows.map((r) => {
      const status = r.cyberbullyingTriage?.status ?? DS.New;
      return {
        id: r.id, detectedAt: r.detectedAt.toISOString(), source: r.source, kind: r.kind,
        severity: String(r.severity), subjectType: r.subjectType, subjectId: r.subjectId, occurrenceCount: r.occurrenceCount,
        status, incidentId: r.cyberbullyingTriage?.incidentId ?? null,
        linked: r._count.incidentLinks > 0 || status === DS.LinkedToIncident,
      };
    });
    return { items, total, page, pageSize };
  });
}

export interface DetectionDetailVM {
  id: string; detectedAt: string; source: string | null; kind: string; severity: string;
  subjectType: string; subjectId: string; occurrenceCount: number; reasonCode: string | null; confidence: number | null;
  status: string; incidentId: string | null; linked: boolean;
  timeline: { id: string; eventType: string; hasActor: boolean; reason: string | null; createdAt: string }[];
  actions: AvailableDetectionActions;
}

export async function getCyberbullyingDetectionDetail(actor: DetectionActor, detectionId: string): Promise<DetectionDetailVM | null> {
  assertAccess(actor);
  return withTenant(actor.tenantId, async (db) => {
    const d = await db.securityDetection.findFirst({
      where: { id: detectionId, tenantId: actor.tenantId },
      select: {
        id: true, detectedAt: true, source: true, kind: true, severity: true, subjectType: true, subjectId: true, occurrenceCount: true, reasonCode: true, confidence: true,
        cyberbullyingTriage: { select: { status: true, incidentId: true } },
        cyberbullyingTriageEvents: { orderBy: { createdAt: "asc" }, select: { id: true, eventType: true, actorUserId: true, reason: true, createdAt: true } },
        incidentLinks: { select: { incidentId: true }, take: 1 },
      },
    });
    if (!d) return null;
    const status = d.cyberbullyingTriage?.status ?? DS.New;
    const linked = d.incidentLinks.length > 0 || status === DS.LinkedToIncident;
    // Sanitized VM — NO raw signal `evidence` JSON, no tokens/PII.
    return {
      id: d.id, detectedAt: d.detectedAt.toISOString(), source: d.source, kind: d.kind, severity: String(d.severity),
      subjectType: d.subjectType, subjectId: d.subjectId, occurrenceCount: d.occurrenceCount, reasonCode: d.reasonCode, confidence: d.confidence,
      status, incidentId: d.cyberbullyingTriage?.incidentId ?? d.incidentLinks[0]?.incidentId ?? null, linked,
      timeline: d.cyberbullyingTriageEvents.map((e) => ({ id: e.id, eventType: e.eventType, hasActor: !!e.actorUserId, reason: e.reason, createdAt: e.createdAt.toISOString() })),
      actions: availableDetectionActions(actor.role, status as CyberbullyingDetectionStatus, linked),
    };
  });
}

/** Count of NEW (untriaged) detections — for the overview entry. */
export async function countNewCyberbullyingDetections(actor: DetectionActor): Promise<number> {
  if (!canTriageDetections(actor.role)) return 0;
  return withTenant(actor.tenantId, (db) => db.securityDetection.count({ where: { tenantId: actor.tenantId, ...statusClause(DS.New) } }));
}
