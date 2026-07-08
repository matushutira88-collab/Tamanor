import { Badge } from "./ui";

const TONE: Record<string, string> = {
  ok: "ok",
  error: "danger",
  unsupported: "warn",
  warn: "warn",
  info: "brand",
};

/**
 * Unified server-action feedback banner. Reads the `?notice=&kind=` query
 * params that server actions redirect with. Renders nothing when absent.
 */
export function Notice({
  notice,
  kind = "ok",
}: {
  notice?: string;
  kind?: string;
}) {
  if (!notice) return null;
  const tone = TONE[kind] ?? "brand";
  const label =
    kind === "ok" ? "Done" : kind === "error" ? "Error" : kind === "unsupported" ? "Unsupported" : "Notice";
  return (
    <div
      role="status"
      className="mb-5 flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-card)]"
    >
      <Badge tone={tone}>{label}</Badge>
      <span className="text-sm text-[var(--color-fg)]">{notice}</span>
    </div>
  );
}
