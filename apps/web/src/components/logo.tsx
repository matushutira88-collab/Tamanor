export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 2 4 5v6c0 5 3.4 8.3 8 11 4.6-2.7 8-6 8-11V5l-8-3Z"
          fill="url(#gu-shield)"
          stroke="var(--color-brand)"
          strokeWidth="1.2"
        />
        <path
          d="M8.5 12.2 11 14.7l4.6-4.9"
          stroke="#08111f"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <defs>
          <linearGradient id="gu-shield" x1="4" y1="2" x2="20" y2="22">
            <stop stopColor="#5cb6ff" />
            <stop offset="1" stopColor="#17d3a3" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">
        Guardora<span className="text-[var(--color-brand)]">.ai</span>
      </span>
    </span>
  );
}
