/**
 * Tamanor brand mark — a shield with a padlock, in the mint→teal gradient.
 * `Logo` is the compact wordmark used in headers and the sidebar; `ShieldEmblem`
 * is the large, glowing hero emblem. (Public brand: Tamanor. Internal package
 * names may still use "guardora" during the transition.)
 */

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <ShieldMark size={28} />
      <span className="gu-display text-[18px] tracking-tight">Tamanor</span>
    </span>
  );
}

/** The shield-with-lock icon on its own, no wordmark. */
export function ShieldMark({ size = 28 }: { size?: number }) {
  const id = "gu-shield-grad";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3 5 6.5v7.2c0 6.4 4.5 10.7 11 13.3 6.5-2.6 11-6.9 11-13.3V6.5L16 3Z"
        fill={`url(#${id})`}
        stroke="var(--color-brand-strong)"
        strokeWidth="1.1"
      />
      {/* padlock body */}
      <rect
        x="11"
        y="14.5"
        width="10"
        height="8"
        rx="1.6"
        fill="#ffffff"
        opacity="0.95"
      />
      {/* padlock shackle */}
      <path
        d="M13 14.5v-1.8a3 3 0 0 1 6 0v1.8"
        stroke="#ffffff"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.95"
      />
      {/* keyhole */}
      <circle cx="16" cy="17.8" r="1.15" fill="var(--color-brand)" />
      <rect x="15.45" y="18.2" width="1.1" height="2.4" rx="0.55" fill="var(--color-brand)" />
      <defs>
        <linearGradient id={id} x1="5" y1="3" x2="27" y2="28">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Large hero emblem — shield + lock with faint circuit traces and a radial
 * glow (via the `.gu-emblem` wrapper). Mirrors the brand mockup centerpiece.
 */
export function ShieldEmblem({ size = 132 }: { size?: number }) {
  return (
    <span className="gu-emblem inline-flex">
      <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true">
        {/* circuit traces */}
        <g stroke="var(--color-brand)" strokeWidth="1" opacity="0.45" strokeLinecap="round">
          <path d="M80 18v-8M80 150v-8M18 80h-8M150 80h-8" />
          <path d="M40 40 28 28M120 40l12-12M40 120l-12 12M120 120l12 12" />
          <circle cx="28" cy="28" r="2" fill="var(--color-brand)" stroke="none" />
          <circle cx="132" cy="28" r="2" fill="var(--color-brand)" stroke="none" />
          <circle cx="28" cy="132" r="2" fill="var(--color-brand)" stroke="none" />
          <circle cx="132" cy="132" r="2" fill="var(--color-brand)" stroke="none" />
          <circle cx="80" cy="10" r="2" fill="var(--color-brand)" stroke="none" />
        </g>
        {/* shield */}
        <path
          d="M80 26 38 40v27c0 25 17 41 42 51 25-10 42-26 42-51V40L80 26Z"
          fill="url(#gu-emblem-fill)"
          stroke="var(--color-brand-strong)"
          strokeWidth="1.6"
        />
        {/* inner bevel line */}
        <path
          d="M80 37 49 47.5v18.8c0 18.8 12.6 30.8 31 38.4 18.4-7.6 31-19.6 31-38.4V47.5L80 37Z"
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="0.8"
          opacity="0.4"
        />
        {/* padlock */}
        <rect x="66" y="72" width="28" height="24" rx="4.5" fill="#ffffff" opacity="0.95" />
        <path d="M71 72v-6a9 9 0 0 1 18 0v6" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" opacity="0.95" />
        <circle cx="80" cy="82" r="3.2" fill="var(--color-brand)" />
        <rect x="78.4" y="83" width="3.2" height="7" rx="1.6" fill="var(--color-brand)" />
        <defs>
          <linearGradient id="gu-emblem-fill" x1="38" y1="26" x2="122" y2="118">
            <stop stopColor="#60a5fa" />
            <stop offset="0.55" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}
