import "server-only";
import { ActorKind } from "@guardora/core";
import { prisma } from "./db";
import type { AppSession } from "./auth";

/**
 * Append an audit entry. Audit logging is mandatory for every inbox and
 * brand-rule mutation — callers must invoke this within the same request.
 */
export async function writeAudit(opts: {
  session: AppSession;
  event: string;
  brandId?: string;
  targetType?: string;
  targetId?: string;
  actorKind?: ActorKind;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: opts.session.tenantId,
      brandId: opts.brandId ?? null,
      event: opts.event,
      actorKind: opts.actorKind ?? ActorKind.Human,
      actorUserId: opts.session.userId,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      metadata: (opts.metadata ?? undefined) as never,
    },
  });
}
