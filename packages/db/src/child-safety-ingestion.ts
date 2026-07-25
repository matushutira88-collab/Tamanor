/**
 * CS-C6 — persistent replay + idempotency protection for gateway signal ingestion. Backed by DB
 * uniqueness (not process memory), so it is correct across multiple server instances. Replay is bound
 * per (installation, nonce); idempotency per (installation, idempotencyKey) with a canonical
 * payload-hash conflict check. One installation's nonces never collide with another's. Stores NO raw
 * content — only opaque nonce/key/hash/ids. SYSTEM-scoped (systemDb / owner role).
 */
import { Prisma } from "@prisma/client";
import { systemDb } from "./index";

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export interface IngestionRecord {
  id: string;
  installationId: string;
  nonce: string;
  idempotencyKey: string | null;
  payloadHash: string;
  signalId: string | null;
  receiptId: string;
  outcome: string;
}
const INGESTION_SELECT = {
  id: true, installationId: true, nonce: true, idempotencyKey: true, payloadHash: true,
  signalId: true, receiptId: true, outcome: true,
} as const;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // replay/idempotency retention window

export type ReserveIngestionResult =
  | { kind: "reserved"; id: string; receiptId: string }
  | { kind: "duplicate"; record: IngestionRecord } // same idempotency key + same canonical payload
  | { kind: "conflict" } // same idempotency key + DIFFERENT canonical payload
  | { kind: "replay" }; // nonce already used for this installation

/**
 * Atomically reserve an ingestion slot BEFORE the SafetySignal is created — so a replayed nonce can
 * never produce a second signal. Persistent + multi-instance safe (DB unique indexes are the source
 * of truth; the pre-read is only a fast path).
 */
export async function reserveIngestion(input: {
  installationId: string;
  nonce: string;
  idempotencyKey?: string | null;
  payloadHash: string;
  receiptId: string;
  ttlMs?: number;
  now?: Date;
}): Promise<ReserveIngestionResult> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const idem = input.idempotencyKey ?? null;

  // Fast path: an already-seen idempotency key returns the original receipt (same payload) or conflicts.
  if (idem) {
    const existing = await systemDb.childSafetySignalIngestion.findFirst({
      where: { installationId: input.installationId, idempotencyKey: idem },
      select: INGESTION_SELECT,
    });
    if (existing) return existing.payloadHash === input.payloadHash ? { kind: "duplicate", record: existing } : { kind: "conflict" };
  }

  try {
    const row = await systemDb.childSafetySignalIngestion.create({
      data: {
        installationId: input.installationId, nonce: input.nonce, idempotencyKey: idem,
        payloadHash: input.payloadHash, receiptId: input.receiptId, outcome: "pending", expiresAt,
      },
      select: { id: true, receiptId: true },
    });
    return { kind: "reserved", id: row.id, receiptId: row.receiptId };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A concurrent request won a race. Re-classify: idempotency (same key) vs replay (same nonce).
    if (idem) {
      const dup = await systemDb.childSafetySignalIngestion.findFirst({
        where: { installationId: input.installationId, idempotencyKey: idem },
        select: INGESTION_SELECT,
      });
      if (dup) return dup.payloadHash === input.payloadHash ? { kind: "duplicate", record: dup } : { kind: "conflict" };
    }
    return { kind: "replay" };
  }
}

/** Finalize a reserved ingestion with the created signal id + orchestration outcome. */
export async function completeIngestion(id: string, data: { signalId: string | null; outcome: string }): Promise<void> {
  await systemDb.childSafetySignalIngestion.updateMany({ where: { id }, data: { signalId: data.signalId, outcome: data.outcome } });
}

/** Bounded retention purge of expired ingestion records (called by maintenance). Id-scoped deletes. */
export async function purgeExpiredIngestions(now: Date = new Date(), batchSize = 500): Promise<number> {
  const ids = await systemDb.childSafetySignalIngestion.findMany({ where: { expiresAt: { lt: now } }, select: { id: true }, take: Math.min(Math.max(batchSize, 1), 5000) });
  if (ids.length === 0) return 0;
  const del = await systemDb.childSafetySignalIngestion.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
  return del.count;
}
