/**
 * Cyberbullying Protection — C2 Evidence Foundation (domain).
 *
 * Enums, plain domain shapes, and repository/storage CONTRACTS (interfaces only).
 * No implementation here (no hashing/IO/DB — those are server-side, and the
 * SHA-256 hash impl lives in @guardora/db to keep node:crypto out of this pure
 * module and out of any client bundle).
 *
 * Foundation invariants (docs/cyberbullying-c0):
 * - Binary content NEVER lives in the DB — a `StorageObject` reference does.
 * - The original evidence is IMMUTABLE; only governance metadata (retention,
 *   legal hold, deletion, integrity/scan status) is mutable.
 * - Custody is an APPEND-ONLY ledger, separate from AuditLog.
 * - LOCAL storage only — no cloud provider.
 */

// --- Enums (mirror the DB string columns) ----------------------------------

export enum EvidenceType {
  Screenshot = "screenshot",
  MessageText = "message_text",
  File = "file",
  Link = "link",
  Other = "other",
}

export enum EvidenceSourceType {
  UserUpload = "user_upload",
  OwnedAccount = "owned_account",
  Api = "api",
  Other = "other",
}

export enum EvidenceCaptureMethod {
  UserUpload = "user_upload",
  Manual = "manual",
  Api = "api",
}

/** Integrity of the stored bytes vs. the recorded hash. Never recalculated silently. */
export enum EvidenceIntegrityStatus {
  Unverified = "unverified",
  Verified = "verified",
  Failed = "failed",
}

/** Antivirus scan state. C2 prepares the boundary only — no engine. */
export enum EvidenceScanStatus {
  PendingScan = "pending_scan",
  Clean = "clean",
  Infected = "infected",
  ScanFailed = "scan_failed",
}

export enum EvidenceContextRelation {
  Before = "before",
  Primary = "primary",
  After = "after",
}

/** Append-only custody ledger event types. No `exported` yet (C2 excludes export). */
export enum EvidenceCustodyEventType {
  Captured = "captured",
  Uploaded = "uploaded",
  Verified = "verified",
  ViewedSensitive = "viewed_sensitive",
  Redacted = "redacted",
  Deleted = "deleted",
  RetentionExtended = "retention_extended",
  LegalHoldEnabled = "legal_hold_enabled",
  LegalHoldRemoved = "legal_hold_removed",
}

/** Only SHA-256 is supported. */
export enum HashAlgorithm {
  Sha256 = "sha256",
}

// --- Domain shapes (plain; NOT Prisma) -------------------------------------

/** Local-only storage object reference. The bytes live at `storageKey` on local
 *  storage — NEVER in the DB, NEVER in a cloud provider. */
export interface StorageObject {
  id: string;
  tenantId: string;
  /** Opaque local storage key (not a real-world path/PII). */
  storageKey: string;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: Date;
}

/** Immutable evidence record + mutable governance metadata. */
export interface IncidentEvidence {
  id: string;
  tenantId: string;
  /** Nullable for now (evidence may be captured before a case is opened). */
  incidentId: string | null;
  protectedSubjectId: string | null;
  evidenceType: EvidenceType;
  sourceType: EvidenceSourceType;
  captureMethod: EvidenceCaptureMethod;
  createdAt: Date;
  capturedAt: Date;
  submittedByUserId: string | null;
  storageObjectId: string;
  mimeType: string | null;
  sizeBytes: number;
  contentHash: string;
  hashAlgorithm: HashAlgorithm;
  // --- mutable governance metadata ---
  integrityStatus: EvidenceIntegrityStatus;
  scanStatus: EvidenceScanStatus;
  retentionUntil: Date | null;
  legalHold: boolean;
  deletedAt: Date | null;
}

export interface EvidenceContextItem {
  id: string;
  tenantId: string;
  evidenceId: string;
  relation: EvidenceContextRelation;
  sequencePosition: number;
  createdAt: Date;
}

export interface EvidenceCustodyEvent {
  id: string;
  tenantId: string;
  evidenceId: string;
  eventType: EvidenceCustodyEventType;
  actorUserId: string | null;
  actorRole: string | null;
  reason: string | null;
  previousHash: string | null;
  resultingHash: string | null;
  createdAt: Date;
}

// --- Server CONTRACTS (interfaces only — NO implementation) -----------------

/** Local-only blob storage. NO S3/Azure/GCS. Implementation is deferred. */
export interface EvidenceStorage {
  put(input: { bytes: Uint8Array; mimeType?: string | null }): Promise<StorageObject>;
  get(storageObjectId: string): Promise<Uint8Array | null>;
  delete(storageObjectId: string): Promise<void>;
}

/** Deterministic hashing contract (SHA-256). Concrete impl lives in @guardora/db. */
export interface EvidenceHasher {
  hash(data: Uint8Array | string): { hash: string; algorithm: HashAlgorithm };
}

/** Verifies stored bytes against the recorded hash. Never mutates silently. */
export interface EvidenceIntegrityVerifier {
  verify(evidenceId: string): Promise<EvidenceIntegrityStatus>;
}

/** Retention + legal-hold governance. No deletion worker in C2. */
export interface EvidenceRetentionService {
  setLegalHold(evidenceId: string, enabled: boolean, reason?: string): Promise<void>;
  extendRetention(evidenceId: string, retentionUntil: Date, reason?: string): Promise<void>;
  markDeleted(evidenceId: string, reason?: string): Promise<void>;
}

/** Tenant-scoped evidence persistence. Original immutable; governance mutable. */
export interface EvidenceRepository {
  create(input: Omit<IncidentEvidence, "id" | "tenantId" | "createdAt" | "integrityStatus" | "scanStatus" | "legalHold" | "deletedAt">): Promise<IncidentEvidence>;
  getById(id: string): Promise<IncidentEvidence | null>;
  listForIncident(incidentId: string): Promise<IncidentEvidence[]>;
  updateGovernance(id: string, patch: Partial<Pick<IncidentEvidence, "integrityStatus" | "scanStatus" | "retentionUntil" | "legalHold" | "deletedAt">>): Promise<IncidentEvidence>;
}

/** Append-only custody ledger. No update/delete — only append + read. */
export interface EvidenceCustodyRepository {
  append(event: Omit<EvidenceCustodyEvent, "id" | "tenantId" | "createdAt">): Promise<EvidenceCustodyEvent>;
  list(evidenceId: string): Promise<EvidenceCustodyEvent[]>;
}
