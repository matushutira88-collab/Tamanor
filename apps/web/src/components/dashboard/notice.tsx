import type { Locale } from "@/i18n";
import { Badge } from "./ui";

const TONE: Record<string, string> = {
  ok: "ok",
  error: "danger",
  unsupported: "warn",
  warn: "warn",
  info: "brand",
};

const LABELS: Record<Locale, { done: string; error: string; unsupported: string; notice: string }> = {
  en: { done: "Done", error: "Error", unsupported: "Unsupported", notice: "Notice" },
  sk: { done: "Hotovo", error: "Chyba", unsupported: "Nepodporované", notice: "Oznámenie" },
  de: { done: "Fertig", error: "Fehler", unsupported: "Nicht unterstützt", notice: "Hinweis" },
};

/**
 * Unified server-action feedback banner. Reads the `?notice=&kind=` query
 * params that server actions redirect with. Renders nothing when absent.
 */
export function Notice({
  notice,
  kind = "ok",
  locale = "en",
}: {
  notice?: string;
  kind?: string;
  locale?: Locale;
}) {
  if (!notice) return null;
  const tone = TONE[kind] ?? "brand";
  const labels = LABELS[locale] ?? LABELS.en;
  const label =
    kind === "ok" ? labels.done : kind === "error" ? labels.error : kind === "unsupported" ? labels.unsupported : labels.notice;
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
