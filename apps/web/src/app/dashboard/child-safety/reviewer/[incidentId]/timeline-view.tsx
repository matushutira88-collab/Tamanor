import { timelineEntryView, fmtDateTime, shortId, type Tone } from "../reviewer-view";
import type { ReviewerCopy } from "../reviewer-i18n";

/** A single backend timeline entry (as returned by getChildSafetyIncidentDetail). */
export interface TimelineEntry { at: string; type: string; actorUserId?: string; detail: Record<string, string | number | boolean>; }

const DOT: Record<Tone, string> = {
  neutral: "bg-[var(--color-muted)]", brand: "bg-[var(--color-brand)]", ok: "bg-[var(--color-ok)]",
  warn: "bg-[var(--color-warn)]", danger: "bg-[var(--color-danger)]",
};

/**
 * Chronological timeline. It renders the backend `timeline` array IN THE ORDER RECEIVED — the console
 * never re-sorts (the backend guarantees a deterministic order). Each event shows an icon, a colored dot
 * by category, a localized title, timestamp, actor, and a short content-free description built from the
 * event's bounded detail fields.
 */
export function TimelineView({ timeline, t }: { timeline: TimelineEntry[]; t: ReviewerCopy }) {
  if (timeline.length === 0) return <p className="text-sm text-[var(--color-muted)]">—</p>;
  return (
    <ol className="relative space-y-4 border-l border-[var(--color-border)] pl-5">
      {timeline.map((e, i) => {
        const v = timelineEntryView(e.type);
        const desc = Object.entries(e.detail).map(([k, val]) => `${k}: ${val}`).join(" · ");
        return (
          <li key={`${e.type}-${e.at}-${i}`} className="relative">
            <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-2 ring-[var(--color-surface)] ${DOT[v.tone]}`} aria-hidden="true" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span aria-hidden="true">{v.icon}</span>
              <span className="text-sm font-semibold text-[var(--color-fg)]">{t.tl[e.type.replace(/^tl\./, "")] ?? t.tl[v.titleKey.replace(/^tl\./, "")] ?? t.tl.event}</span>
              <time dateTime={e.at} className="text-xs text-[var(--color-muted)]">{fmtDateTime(e.at)}</time>
              {e.actorUserId ? <span className="font-mono text-xs text-[var(--color-muted)]">· {shortId(e.actorUserId)}</span> : null}
            </div>
            {desc ? <p className="mt-0.5 text-xs text-[var(--color-muted)]">{desc}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
