/**
 * Child Safety Integration V1 — PURE view-model (no React/I/O). Deterministic presentation helpers for the
 * LOCAL SANDBOX console: status/result tones, short fingerprints, date formatting. Content-free.
 */
export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export function installationStatusTone(status: string): Tone {
  return status === "active" ? "ok" : status === "suspended" ? "warn" : "danger"; // revoked
}
export function keyStatusTone(status: string): Tone {
  switch (status) { case "active": return "ok"; case "rotating": return "warn"; default: return "danger"; } // revoked/suspended
}
/** SIGNAL_ACCEPTED→ok, SIGNAL_DUPLICATE→neutral, RATE_LIMITED→warn, every error code→danger. */
export function resultCodeTone(code: string): Tone {
  if (code === "SIGNAL_ACCEPTED") return "ok";
  if (code === "SIGNAL_DUPLICATE") return "neutral";
  if (code === "RATE_LIMITED") return "warn";
  return "danger";
}
export function isAcceptedResult(code: string): boolean {
  return code === "SIGNAL_ACCEPTED" || code === "SIGNAL_DUPLICATE";
}
/** Short, non-secret fingerprint for display. */
export function shortFingerprint(fp: string): string {
  return typeof fp === "string" && fp.length > 12 ? `${fp.slice(0, 10)}…${fp.slice(-4)}` : (fp ?? "—");
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
