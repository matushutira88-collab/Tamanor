import type {
  BrandId,
  TenantId,
  UserId,
  IsoTimestamp,
} from "./ids";
import type { ActorKind } from "./moderation";

/**
 * Every meaningful action in Guardora — especially automated moderation —
 * emits an AuditLog entry. The audit trail is append-only and immutable.
 */
export interface AuditLog {
  id: string;
  tenantId: TenantId;
  brandId?: BrandId;
  /** Dot-namespaced event, e.g. "moderation.hide.executed". */
  event: string;
  actorKind: ActorKind;
  actorUserId?: UserId;
  /** Type of the entity affected, e.g. "reputation_item". */
  targetType?: string;
  targetId?: string;
  /** Arbitrary structured context (before/after, model version, etc.). */
  metadata?: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

/** A point-in-time reputation report for a brand. */
export interface ReportSnapshot {
  id: string;
  tenantId: TenantId;
  brandId: BrandId;
  /** Reporting window. */
  periodStart: IsoTimestamp;
  periodEnd: IsoTimestamp;
  /** Aggregated metrics (counts by platform, risk level, action, etc.). */
  metrics: Record<string, number>;
  createdAt: IsoTimestamp;
}
