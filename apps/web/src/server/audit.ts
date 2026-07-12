import "server-only";
import { ActorKind } from "@guardora/core";
import { withTenantDb, type TenantTx } from "@guardora/db";
import type { AppSession } from "./auth";

/**
 * Append an audit entry. Audit logging is mandatory for every inbox and
 * brand-rule mutation — callers must invoke this within the same request.
 *
 * V1.37.3C — runs on the RLS runtime under the session's tenant context. Pass an
 * existing tenant tx (`db`) to append inside a caller's transaction; otherwise a
 * short tenant transaction is opened.
 */
export async function writeAudit(opts: {
  session: AppSession;
  event: string;
  brandId?: string;
  targetType?: string;
  targetId?: string;
  actorKind?: ActorKind;
  metadata?: Record<string, unknown>;
  db?: TenantTx;
}): Promise<void> {
  const data = {
    tenantId: opts.session.tenantId,
    brandId: opts.brandId ?? null,
    event: opts.event,
    actorKind: opts.actorKind ?? ActorKind.Human,
    actorUserId: opts.session.userId,
    targetType: opts.targetType ?? null,
    targetId: opts.targetId ?? null,
    metadata: (opts.metadata ?? undefined) as never,
  };
  if (opts.db) {
    await opts.db.auditLog.create({ data });
    return;
  }
  await withTenantDb(opts.session.tenantId, (db) => db.auditLog.create({ data }));
}
