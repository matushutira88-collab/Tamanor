/**
 * Guardora line-art illustrations. Dependency-free SVGs that inherit color via
 * `currentColor` (set a text color on the wrapper). No stock photos, no faces,
 * no third-party logos. Premium security / reputation / network motifs.
 */

type Props = { className?: string; size?: number };

function frame(size = 96) {
  return { width: size, height: size, viewBox: "0 0 96 96", fill: "none" as const };
}

/** Shield + checkmark — protection / firewall. */
export function IllusShield({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <path d="M48 12l26 10v18c0 18-12 30-26 36-14-6-26-18-26-36V22l26-10Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity="0.9" />
      <path d="M36 48l9 9 17-19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.35" />
    </svg>
  );
}

/** Nodes + links — multi-platform network / reputation graph. */
export function IllusNetwork({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" opacity="0.5">
        <path d="M24 26L48 48M72 26L48 48M24 70L48 48M72 70L48 48" />
      </g>
      <g fill="currentColor">
        <circle cx="48" cy="48" r="8" />
        <circle cx="24" cy="26" r="5" opacity="0.85" />
        <circle cx="72" cy="26" r="5" opacity="0.85" />
        <circle cx="24" cy="70" r="5" opacity="0.85" />
        <circle cx="72" cy="70" r="5" opacity="0.85" />
      </g>
    </svg>
  );
}

/** Inbox tray — unified inbox / empty inbox. */
export function IllusInbox({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <path d="M20 28h56v34a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V28Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M20 50h16l4 8h16l4-8h16" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M34 20h28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** Bars + trend — insights / analytics. */
export function IllusChart({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <path d="M20 74h56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <g stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.85">
        <path d="M30 74V58" />
        <path d="M46 74V46" />
        <path d="M62 74V52" />
      </g>
      <path d="M26 40l16-10 12 8 18-16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

/** Approval / human-in-the-loop. */
export function IllusApproval({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <rect x="22" y="20" width="52" height="44" rx="6" stroke="currentColor" strokeWidth="2.5" />
      <path d="M34 38l8 8 20-20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 76h16M48 64v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
