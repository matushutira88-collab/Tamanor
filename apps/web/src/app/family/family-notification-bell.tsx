"use client";

/**
 * FAMILY NOTIFICATION CENTER V1 — Family shell notification bell. Presentational only: it renders the
 * server-computed unread badge (0 → no numeric badge; 1..99 → exact; >=100 → "99+") and links to the center.
 * No polling / websocket / auto-mark-read. All props are plain serializable strings/booleans (computed in the
 * server layout, where an unread-count failure degrades to `showBadge:false` so the shell never crashes).
 */
import Link from "next/link";
import { FAMILY_FOCUS } from "./family-ui";

export interface FamilyBellProps { ariaLabel: string; badgeText: string; showBadge: boolean }

export function FamilyNotificationBell({ bell }: { bell: FamilyBellProps }) {
  return (
    <Link
      href="/family/notifications"
      aria-label={bell.ariaLabel}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] ${FAMILY_FOCUS}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {bell.showBadge && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[var(--color-danger)] px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
          {bell.badgeText}
        </span>
      )}
    </Link>
  );
}
