/**
 * CS-C6 — SDK installation credentials. A limited-scope credential that authenticates a platform/SDK
 * installation at the Privacy Gateway. It holds NO database or admin access — only an explicit scope
 * (minimum `child-safety:signal:submit`), an optional tenant + protected-profile binding, and an
 * expiry/revocation lifecycle. The secret token is stored HASHED ONLY (sha256) — never plaintext.
 *
 * The token doubles as the bearer credential AND the HMAC signing key: the gateway receives the raw
 * token in the request, hashes it to find the installation, and verifies the envelope signature with
 * that same raw token — so nothing reversible is ever stored. SYSTEM-scoped (systemDb / owner role).
 */
import { randomBytes, createHash } from "node:crypto";
import { systemDb } from "./index";

/** The minimum scope required to submit a safety signal. */
export const CHILD_SAFETY_SIGNAL_SUBMIT_SCOPE = "child-safety:signal:submit";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export interface ChildSafetyInstallationRecord {
  id: string;
  applicationId: string;
  tenantId: string | null;
  subjectRef: string | null;
  scopes: string[];
  status: string;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

const INSTALLATION_SELECT = {
  id: true, applicationId: true, tenantId: true, subjectRef: true, scopes: true, status: true,
  issuedAt: true, expiresAt: true, revokedAt: true,
} as const;

function toRecord(row: { scopes: string } & Omit<ChildSafetyInstallationRecord, "scopes">): ChildSafetyInstallationRecord {
  return { ...row, scopes: row.scopes.split(" ").filter(Boolean) };
}

/**
 * Register a new installation. Returns the plaintext token ONCE (never stored, never recoverable) — the
 * caller (registration flow) hands it to the SDK. Only the sha256 hash + metadata are persisted.
 */
export async function createChildSafetyInstallation(input: {
  applicationId: string;
  tenantId?: string | null;
  subjectRef?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
}): Promise<{ installationId: string; token: string; record: ChildSafetyInstallationRecord }> {
  const scopes = input.scopes && input.scopes.length ? input.scopes : [CHILD_SAFETY_SIGNAL_SUBMIT_SCOPE];
  // High-entropy, prefixed, URL-safe. The plaintext is returned once and never persisted.
  const token = `csi_${randomBytes(32).toString("base64url")}`;
  const row = await systemDb.childSafetyInstallation.create({
    data: {
      applicationId: input.applicationId,
      tenantId: input.tenantId ?? null,
      subjectRef: input.subjectRef ?? null,
      scopes: scopes.join(" "),
      tokenHash: sha256(token),
      expiresAt: input.expiresAt ?? null,
    },
    select: INSTALLATION_SELECT,
  });
  return { installationId: row.id, token, record: toRecord(row) };
}

export type InstallationAuthReason = "missing_token" | "not_found" | "revoked" | "expired";
export type InstallationAuthResult =
  | { ok: true; installation: ChildSafetyInstallationRecord }
  | { ok: false; reason: InstallationAuthReason };

/**
 * Authenticate a raw token: hash-lookup, then validate status/expiry/revocation. Fail-closed and
 * generic — never distinguishes "unknown token" from a hash miss in a way that leaks existence beyond
 * the coarse reason. Touches `lastUsedAt` best-effort. Never logs the token.
 */
export async function authenticateChildSafetyInstallation(
  token: string,
  now: Date = new Date(),
): Promise<InstallationAuthResult> {
  if (typeof token !== "string" || token.length < 8) return { ok: false, reason: "missing_token" };
  const row = await systemDb.childSafetyInstallation.findUnique({
    where: { tokenHash: sha256(token) },
    select: INSTALLATION_SELECT,
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "revoked" || row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  await systemDb.childSafetyInstallation.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
  return { ok: true, installation: toRecord(row) };
}

/** Revoke an installation (rotation-ready: issue a new one, revoke the old). Idempotent. */
export async function revokeChildSafetyInstallation(id: string, now: Date = new Date()): Promise<void> {
  await systemDb.childSafetyInstallation.updateMany({ where: { id }, data: { status: "revoked", revokedAt: now } });
}

/** Whether an installation carries the given scope. */
export function installationHasScope(installation: ChildSafetyInstallationRecord, scope: string): boolean {
  return installation.scopes.includes(scope);
}
