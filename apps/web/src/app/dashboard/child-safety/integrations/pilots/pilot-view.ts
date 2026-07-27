/**
 * Child Safety Partner Pilot V1 — PURE view-model (no React/I/O). Deterministic presentation helpers:
 * status/readiness/severity/check tones. Content-free.
 */
export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export function pilotStatusTone(status: string): Tone {
  switch (status) {
    case "PILOT_ACTIVE": return "ok";
    case "READY_FOR_PILOT": case "SANDBOX_ACTIVE": case "APPROVED_FOR_SANDBOX": return "brand";
    case "PILOT_PAUSED": case "CHANGES_REQUIRED": case "READINESS_REVIEW": case "SUBMITTED": case "UNDER_REVIEW": return "warn";
    case "SUSPENDED": case "TERMINATED": case "REJECTED": return "danger";
    default: return "neutral"; // DRAFT
  }
}
export function readinessTone(state: string): Tone {
  return state === "READY" ? "ok" : state === "BLOCKED" ? "danger" : "neutral";
}
export function severityTone(severity: string | null): Tone {
  return severity === "CRITICAL" ? "danger" : severity === "WARNING" ? "warn" : severity === "INFO" ? "brand" : "neutral";
}
export function checkStatusTone(status: string): Tone {
  switch (status) { case "PASSED": return "ok"; case "WAIVED": return "brand"; case "FAILED": return "danger"; case "IN_REVIEW": return "warn"; default: return "neutral"; }
}
export function testResultTone(result: string): Tone {
  return result === "PASSED" ? "ok" : result === "FAILED" ? "danger" : "neutral";
}
export function assessmentTone(status: string): Tone {
  return status === "APPROVED" ? "ok" : status === "REJECTED" ? "danger" : status === "IN_REVIEW" ? "warn" : "neutral";
}
/** Icon-independent status glyph (a11y: status is never conveyed by color alone). */
export function statusGlyph(tone: Tone): string {
  switch (tone) { case "ok": return "●"; case "warn": return "◐"; case "danger": return "▲"; case "brand": return "◆"; default: return "○"; }
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
