import { EvidenceScanStatus, detectDangerousSignature } from "@guardora/core";

/**
 * C7 — LOCAL antivirus boundary (C2 contract). No external provider (no cloud AV).
 * A minimal, deterministic local signature engine: it detects the canonical EICAR
 * test signature and known-dangerous magic bytes → `infected`; otherwise the scan
 * ran and found nothing → `clean`. It NEVER reports `clean` without actually
 * inspecting the bytes. When no engine is available the status stays `pending_scan`;
 * an errored/unavailable engine yields `scan_failed`. The upload flow BLOCKS
 * `infected` and `scan_failed` (never usable evidence) and lets `pending`/`clean`
 * attach — `pending` is surfaced honestly in the UI as "security scan pending".
 */

// The standard EICAR anti-malware test string (safe, industry-standard trigger).
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export type AvMode = "local_signature" | "pending" | "unavailable";
export interface EvidenceScanResult { status: EvidenceScanStatus; engine: string }

function avMode(): AvMode {
  const m = process.env.EVIDENCE_AV_MODE;
  return m === "pending" || m === "unavailable" ? m : "local_signature";
}

/** Local signature scan. Real result: infected on a known signature, else clean. */
function localSignatureScan(bytes: Uint8Array): EvidenceScanResult {
  try {
    if (detectDangerousSignature(bytes)) return { status: EvidenceScanStatus.Infected, engine: "local-signature-v1" };
    // EICAR lives in the first bytes of the test file; scan a bounded leading window.
    const window = bytes.subarray(0, Math.min(bytes.length, 4096));
    let head = "";
    for (let i = 0; i < window.length; i++) head += String.fromCharCode(window[i]!);
    if (head.includes(EICAR)) return { status: EvidenceScanStatus.Infected, engine: "local-signature-v1" };
    return { status: EvidenceScanStatus.Clean, engine: "local-signature-v1" };
  } catch {
    return { status: EvidenceScanStatus.ScanFailed, engine: "local-signature-v1" };
  }
}

/**
 * Run the evidence scan. Honest statuses only — never a false `clean`. `mode`
 * overrides the env (tests). `unavailable` ⇒ scan_failed; `pending` ⇒ pending_scan
 * (no engine ran).
 */
export function runEvidenceScan(bytes: Uint8Array, mode: AvMode = avMode()): EvidenceScanResult {
  switch (mode) {
    case "pending": return { status: EvidenceScanStatus.PendingScan, engine: "none" };
    case "unavailable": return { status: EvidenceScanStatus.ScanFailed, engine: "unavailable" };
    default: return localSignatureScan(bytes);
  }
}

/** A scan result is a hard block (never usable evidence). */
export function isBlockingScanStatus(status: EvidenceScanStatus): boolean {
  return status === EvidenceScanStatus.Infected || status === EvidenceScanStatus.ScanFailed;
}
