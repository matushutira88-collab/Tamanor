import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, rename, unlink, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * C7 — LOCAL-ONLY evidence blob storage. No cloud, no S3/Azure/GCS. Bytes live on
 * the local filesystem under an opaque, unguessable random key — NEVER the original
 * filename, NEVER a real path in the DB. Writes are atomic (temp file + rename) and
 * never overwrite. The storage key is validated on every read/delete to make path
 * traversal structurally impossible.
 *
 * Root: EVIDENCE_STORE_DIR, else ~/.tamanor/evidence-store (outside the repo, so
 * evidence bytes can never be committed). This module is server-only (@guardora/db).
 */

const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{48}$/; // <shard>/<48-hex>

function storeRoot(): string {
  return process.env.EVIDENCE_STORE_DIR || join(homedir(), ".tamanor", "evidence-store");
}

/** Resolve a validated key to an absolute path, asserting it stays inside the root. */
function pathForKey(storageKey: string): string {
  if (!KEY_RE.test(storageKey)) throw new EvidenceStorageError("invalid_key");
  const root = resolve(storeRoot());
  const full = resolve(join(root, storageKey));
  if (full !== root && !full.startsWith(root + sep)) throw new EvidenceStorageError("invalid_key"); // traversal guard
  return full;
}

export class EvidenceStorageError extends Error {
  readonly code: string;
  constructor(code: "invalid_key" | "write_failed" | "collision" | "read_failed") {
    super(`evidence storage: ${code}`);
    this.code = code;
    this.name = "EvidenceStorageError";
  }
}

export interface StoredBlob { storageKey: string; sizeBytes: number }

/**
 * Store bytes under a fresh random key. Atomic: write to a temp file (exclusive
 * create) then rename into place; asserts the target does not already exist (no
 * overwrite). Returns the opaque relative key + the exact byte length written.
 */
export async function putEvidenceObject(bytes: Uint8Array): Promise<StoredBlob> {
  const key = randomBytes(24).toString("hex"); // 48 hex chars, unguessable
  const shard = key.slice(0, 2);
  const storageKey = `${shard}/${key}`;
  const full = pathForKey(storageKey);
  const dir = join(resolve(storeRoot()), shard);
  const tmp = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // No overwrite: the final path must not exist (random key ⇒ this never trips,
    // but it is a hard guarantee, not an assumption).
    let exists = true;
    try { await access(full, FS.F_OK); } catch { exists = false; }
    if (exists) throw new EvidenceStorageError("collision");
    await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 }); // exclusive create
    await rename(tmp, full); // atomic finalize
    return { storageKey, sizeBytes: bytes.byteLength };
  } catch (e) {
    // Best-effort remove of a dangling temp; never mask the original error.
    try { await unlink(tmp); } catch { /* ignore */ }
    if (e instanceof EvidenceStorageError) throw e;
    throw new EvidenceStorageError("write_failed");
  }
}

/** Read stored bytes (read-back integrity verification ONLY — never a UI download).
 *  An invalid/traversal key returns null (never resolves outside the store). */
export async function readEvidenceObject(storageKey: string): Promise<Uint8Array | null> {
  try {
    const full = pathForKey(storageKey);
    return new Uint8Array(await readFile(full));
  } catch { return null; }
}

/** Delete one stored object (compensating cleanup). Idempotent; an invalid key is a no-op. */
export async function deleteEvidenceObject(storageKey: string): Promise<void> {
  try { await unlink(pathForKey(storageKey)); } catch { /* invalid key / already gone ⇒ fine */ }
}

/**
 * Best-effort compensating cleanup for a batch. Never throws; returns how many
 * deletions failed. A failure is logged SANITIZED (count only — no path/key).
 */
export async function safeDeleteEvidenceObjects(storageKeys: string[]): Promise<{ failed: number }> {
  let failed = 0;
  for (const k of storageKeys) {
    try { await deleteEvidenceObject(k); }
    catch { failed++; }
  }
  if (failed > 0) console.warn(`evidence-storage: compensating cleanup failed for ${failed} object(s)`);
  return { failed };
}
