/**
 * C2 — Evidence Foundation domain: enums + audit vocabulary. Pure, no DB.
 * Run: pnpm cyberbullying-evidence:test
 */
import {
  EvidenceType, EvidenceSourceType, EvidenceCaptureMethod, EvidenceIntegrityStatus,
  EvidenceScanStatus, EvidenceContextRelation, EvidenceCustodyEventType, HashAlgorithm,
} from "../src/cyberbullying-evidence";
import { CYBERBULLYING_AUDIT_EVENTS } from "../src/cyberbullying";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

check("HashAlgorithm is SHA-256 only", Object.values(HashAlgorithm).length === 1 && HashAlgorithm.Sha256 === "sha256");
check("EvidenceScanStatus has the 4 AV-boundary states", ["pending_scan", "clean", "infected", "scan_failed"].every((v) => Object.values(EvidenceScanStatus).includes(v as EvidenceScanStatus)));
check("EvidenceIntegrityStatus values", EvidenceIntegrityStatus.Unverified === "unverified" && EvidenceIntegrityStatus.Verified === "verified" && EvidenceIntegrityStatus.Failed === "failed");
check("EvidenceContextRelation = before/primary/after", ["before", "primary", "after"].every((v) => Object.values(EvidenceContextRelation).includes(v as EvidenceContextRelation)) && Object.values(EvidenceContextRelation).length === 3);
check("EvidenceType values present", EvidenceType.Screenshot === "screenshot" && EvidenceType.MessageText === "message_text" && EvidenceType.File === "file");
check("EvidenceSourceType values present", EvidenceSourceType.UserUpload === "user_upload" && EvidenceSourceType.OwnedAccount === "owned_account");
check("EvidenceCaptureMethod values present", EvidenceCaptureMethod.UserUpload === "user_upload" && EvidenceCaptureMethod.Manual === "manual" && EvidenceCaptureMethod.Api === "api");

const custody = Object.values(EvidenceCustodyEventType);
check("custody has the 9 required event types", ["captured", "uploaded", "verified", "viewed_sensitive", "redacted", "deleted", "retention_extended", "legal_hold_enabled", "legal_hold_removed"].every((v) => custody.includes(v as EvidenceCustodyEventType)) && custody.length === 9);
check("custody has NO 'exported' type (C2 excludes export)", !custody.includes("exported" as EvidenceCustodyEventType));

check("audit vocab: evidence captured/uploaded/verified/redacted/deleted/retention_extended present", [
  CYBERBULLYING_AUDIT_EVENTS.evidenceCaptured, CYBERBULLYING_AUDIT_EVENTS.evidenceUploaded, CYBERBULLYING_AUDIT_EVENTS.evidenceVerified,
  CYBERBULLYING_AUDIT_EVENTS.evidenceRedacted, CYBERBULLYING_AUDIT_EVENTS.evidenceDeleted, CYBERBULLYING_AUDIT_EVENTS.evidenceRetentionExtended,
].every((e) => typeof e === "string" && e.startsWith("cyberbullying.evidence.")));
check("audit vocab: viewed_sensitive present", CYBERBULLYING_AUDIT_EVENTS.evidenceViewedSensitive === "cyberbullying.evidence.viewed_sensitive");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — cyberbullying C2 evidence domain: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
