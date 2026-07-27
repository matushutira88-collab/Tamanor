/**
 * Platform Admin V1 — PURE view helpers (no React/I/O). Date-range resolution + formatting + tones.
 */
export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export type RangePreset = "today" | "7" | "30" | "90" | "custom";
export function resolveRange(preset: string | undefined, from?: string, to?: string, nowMs?: number): { from: string; to: string; preset: RangePreset } {
  const now = new Date(nowMs ?? Date.UTC(2026, 0, 1));
  const day = 86400000;
  const p: RangePreset = (["today", "7", "30", "90", "custom"] as const).includes(preset as RangePreset) ? (preset as RangePreset) : "30";
  if (p === "custom" && from && to) return { from, to, preset: "custom" };
  const days = p === "today" ? 0 : p === "7" ? 6 : p === "90" ? 89 : 29;
  const end = now;
  const start = new Date(end.getTime() - days * day);
  return { from: start.toISOString(), to: end.toISOString(), preset: p === "custom" ? "30" : p };
}
export function roleTone(role: string): Tone {
  return role === "owner" ? "danger" : role === "admin" ? "brand" : role === "analyst" || role === "support" ? "warn" : "neutral";
}
export function botTone(bot: string): Tone {
  return bot === "KNOWN_BOT" ? "danger" : bot === "SUSPECTED_BOT" ? "warn" : bot === "HUMAN_LIKELY" ? "ok" : "neutral";
}
export function fmtNum(n: number): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}
export function fmtPct(n: number): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n}%` : "—";
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t); const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
