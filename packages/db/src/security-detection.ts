import { ActorKind, Prisma } from "@prisma/client";
import { withTenant } from "./repositories";
import {
  ATO_DETECTION_KINDS,
  SecurityDetectionStatus,
  applyTransition,
  detectionTransitionAuditEvent,
  sanitizeDetectionEvidence,
  isAtoDetectionKind,
  type DetectionCandidate,
  type DetectionDeduplicationResult,
} from "@guardora/core";

/**
 * S2 — tenant-scoped repository for Account-Takeover detections, over the S0 `security_detections` ledger.
 * Every call runs inside `withTenant` (RLS: no tenant context ⇒ no rows; tenant A never sees tenant B), and
 * every mutation writes an append-only audit row. FOUNDATION: no detector generates rows automatically yet —
 * `ingestDetectionCandidate` is the dedup-aware persistence seam detectors/tests use; the UI only ever reads,
 * and a human reviewer transitions status. Evidence is sanitized (core) before it ever hits the DB.
 */

/** ATO kind string values for a Prisma `in` filter (the ledger is shared with brand-abuse kinds). */
const ATO_KINDS: string[] = [...ATO_DETECTION_KINDS];
/** Statuses the partial-unique dedupe guard treats as "active" (one per (tenantId, dedupeKey)). */
const ACTIVE_STATUSES: string[] = [
  SecurityDetectionStatus.Open,
  SecurityDetectionStatus.Acknowledged,
  SecurityDetectionStatus.Confirmed,
];

const DETECTION_SELECT = {
  id: true, subjectType: true, subjectId: true, brandId: true, kind: true, severity: true,
  status: true, confidence: true, source: true, evidence: true, reasonCode: true,
  occurrenceCount: true, lastObservedAt: true, detectedByEngine: true,
  detectedAt: true, reviewedByUserId: true, reviewedAt: true, resolvedAt: true,
} satisfies Prisma.SecurityDetectionSelect;

export type AtoDetectionRow = Prisma.SecurityDetectionGetPayload<{ select: typeof DETECTION_SELECT }>;

/** List a tenant's ATO detections (RLS-scoped), most-recent first. Read-only. */
export async function listAtoDetections(
  tenantId: string,
  opts: { statuses?: SecurityDetectionStatus[]; limit?: number } = {},
): Promise<AtoDetectionRow[]> {
  return withTenant(tenantId, (db) =>
    db.securityDetection.findMany({
      where: {
        tenantId,
        kind: { in: ATO_KINDS },
        ...(opts.statuses ? { status: { in: opts.statuses } } : {}),
      },
      orderBy: [{ detectedAt: "desc" }],
      take: opts.limit ?? 200,
      select: DETECTION_SELECT,
    }),
  );
}

/** Count OPEN ATO detections for a tenant (drives the section stat). */
export async function countOpenAtoDetections(tenantId: string): Promise<number> {
  return withTenant(tenantId, (db) =>
    db.securityDetection.count({ where: { tenantId, kind: { in: ATO_KINDS }, status: SecurityDetectionStatus.Open } }),
  );
}

/**
 * DEDUP-AWARE ingest of a detection candidate. If an ACTIVE (open/acknowledged/confirmed) detection already
 * exists for (tenantId, dedupeKey), the recurrence bumps occurrenceCount + lastObservedAt (`merged`);
 * otherwise a new OPEN detection is created (`created`). The partial-unique index makes the create
 * race-safe (a concurrent insert hits P2002 → we merge). Evidence is SANITIZED before persistence — never a
 * token/secret/PII key. Writes the `security.detection.opened` audit on create. Tenant-scoped + RLS.
 */
export async function ingestDetectionCandidate(
  tenantId: string,
  candidate: DetectionCandidate,
  engineVersion?: string,
  now: Date = new Date(),
): Promise<DetectionDeduplicationResult> {
  if (!isAtoDetectionKind(candidate.kind)) {
    throw new Error(`ingestDetectionCandidate: "${candidate.kind}" is not an ATO detection kind`);
  }
  const evidence = sanitizeDetectionEvidence(candidate.evidence);

  return withTenant(tenantId, async (db) => {
    const tryMerge = async (): Promise<DetectionDeduplicationResult | null> => {
      const existing = await db.securityDetection.findFirst({
        where: { tenantId, dedupeKey: candidate.dedupeKey, status: { in: ACTIVE_STATUSES } },
        select: { id: true, occurrenceCount: true },
      });
      if (!existing) return null;
      await db.securityDetection.updateMany({
        where: { id: existing.id, tenantId },
        data: { occurrenceCount: { increment: 1 }, lastObservedAt: now },
      });
      return { outcome: "merged", id: existing.id, occurrenceCount: existing.occurrenceCount + 1 };
    };

    const merged = await tryMerge();
    if (merged) return merged;

    try {
      const row = await db.securityDetection.create({
        data: {
          tenantId,
          subjectType: candidate.subjectType,
          subjectId: candidate.subjectId,
          brandId: candidate.brandId ?? null,
          kind: candidate.kind,
          severity: candidate.severity as never,
          status: SecurityDetectionStatus.Open,
          confidence: candidate.confidence,
          source: candidate.source,
          dedupeKey: candidate.dedupeKey,
          reasonCode: candidate.kind,
          occurrenceCount: 1,
          lastObservedAt: now,
          detectedAt: now,
          evidence: evidence as unknown as Prisma.InputJsonValue,
          detectedByEngine: engineVersion ?? null,
        },
        select: { id: true },
      });
      await db.auditLog.create({
        data: { tenantId, event: "security.detection.opened", actorKind: ActorKind.system, targetType: "security_detection", targetId: row.id },
      });
      return { outcome: "created", id: row.id, occurrenceCount: 1 };
    } catch (e) {
      // A concurrent create hit the partial-unique guard → resolve to a merge.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const raced = await tryMerge();
        if (raced) return raced;
      }
      throw e;
    }
  });
}

export type AtoTransitionOutcome =
  | { ok: true; from: SecurityDetectionStatus; to: SecurityDetectionStatus }
  | { ok: false; reason: "not_found" | "illegal_transition" | "terminal" | "no_change" };

/**
 * Human-review status transition. Validated by the deterministic core state machine (`applyTransition`) —
 * an illegal / terminal / no-op move is REJECTED, never silently applied — then stamps reviewer + timestamps
 * (+ a bounded resolution note, + resolvedAt on Resolved) and writes the matching audit event. Tenant-scoped
 * + RLS; the `updateMany` re-checks the current status so a concurrent transition can never double-apply.
 */
export async function transitionAtoDetection(
  tenantId: string,
  id: string,
  to: SecurityDetectionStatus,
  reviewerUserId: string,
  note?: string,
  now: Date = new Date(),
): Promise<AtoTransitionOutcome> {
  return withTenant(tenantId, async (db) => {
    const cur = await db.securityDetection.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!cur) return { ok: false, reason: "not_found" };
    const from = cur.status as SecurityDetectionStatus;
    const res = applyTransition(from, to);
    if (!res.ok) return { ok: false, reason: res.error ?? "illegal_transition" };
    await db.securityDetection.updateMany({
      where: { id, tenantId, status: from },
      data: {
        status: to,
        reviewedByUserId: reviewerUserId,
        reviewedAt: now,
        ...(note ? { resolutionNote: note.slice(0, 500) } : {}),
        ...(to === SecurityDetectionStatus.Resolved ? { resolvedAt: now } : {}),
      },
    });
    await db.auditLog.create({
      data: { tenantId, event: detectionTransitionAuditEvent(to), actorKind: ActorKind.human, actorUserId: reviewerUserId, targetType: "security_detection", targetId: id },
    });
    return { ok: true, from, to };
  });
}
