import type { NavIcon } from "@/lib/nav";

const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Minimal, dependency-free stroke icons for the sidebar. */
export function NavIconGlyph({ icon }: { icon: NavIcon }) {
  switch (icon) {
    case "command":
      return (
        <svg {...S}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "control":
      return (
        <svg {...S}>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "queue":
      return (
        <svg {...S}>
          <path d="M4 6h16M4 12h10M4 18h13" />
          <path d="M18 10l3 2-3 2" />
        </svg>
      );
    case "incidents":
      return (
        <svg {...S}>
          <path d="M12 3l9 16H3L12 3Z" />
          <path d="M12 9v5M12 17h.01" />
        </svg>
      );
    case "timeline":
      return (
        <svg {...S}>
          <path d="M6 3v18" />
          <circle cx="6" cy="7" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="6" cy="13" r="1.6" fill="currentColor" stroke="none" />
          <path d="M10 7h9M10 13h9M10 19h6" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...S}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...S}>
          <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
          <path d="M4 13h4l1.5 2.5h5L16 13h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
        </svg>
      );
    case "approvals":
      return (
        <svg {...S}>
          <path d="M9 12l2 2 4-4" />
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
        </svg>
      );
    case "brands":
      return (
        <svg {...S}>
          <path d="M4 7a2 2 0 0 1 2-2h5l9 9-7 7-9-9V7Z" />
          <circle cx="8.5" cy="8.5" r="1.4" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...S}>
          <path d="M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M15 9h5M18 6v6" />
          <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
        </svg>
      );
    case "insights":
      return (
        <svg {...S}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "reports":
      return (
        <svg {...S}>
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case "rules":
      return (
        <svg {...S}>
          <path d="M4 6h16M4 12h10M4 18h7" />
          <circle cx="18" cy="15" r="3" />
        </svg>
      );
    case "audit":
      return (
        <svg {...S}>
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "leads":
      return (
        <svg {...S}>
          <path d="M3 8l9 6 9-6" />
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M8 21h8" />
        </svg>
      );
    case "team":
      return (
        <svg {...S}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
          <path d="M16 4a3 3 0 0 1 0 6M18 20c0-2-.6-3.5-1.6-4.6" />
        </svg>
      );
    case "billing":
      return (
        <svg {...S}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...S}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h5l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.06-.33.1-.66.1-1Z" />
        </svg>
      );
    default:
      return null;
  }
}
