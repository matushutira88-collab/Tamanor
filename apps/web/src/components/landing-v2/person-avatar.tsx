/**
 * V1.62 — human portrait avatar for the landing's people/examples. It adds warmth
 * (real human faces) without fabricating named testimonials — each avatar just
 * represents a GENERIC role (support agent, brand owner, …).
 *
 * SWAP-IN PATH: pass `src` (e.g. "/humans/support.jpg") to render a real photo.
 * With no `src` it falls back to a friendly, diverse illustrated portrait, so the
 * page already feels human today; real photos can be dropped into /public/humans/
 * and wired via `src` later with zero layout changes.
 */

const SKIN = ["#f2c9a0", "#e0a878", "#c78b5c", "#8d5a3c", "#f6d2b3", "#a86b45"];
const HAIR = ["#2b2b32", "#5a3a22", "#8a5a2b", "#3a2a20", "#0f0f14", "#6b4423"];
const SHIRT = ["#2563eb", "#0ea5a5", "#7c3aed", "#e5573f", "#0f766e", "#334155"];
const BGC = ["#dbeafe", "#e0f2fe", "#ede9fe", "#fee2e2", "#dcfce7", "#f1f5f9"];

export function PersonAvatar({
  seed = 0,
  size = 44,
  src,
  alt = "",
}: {
  seed?: number;
  size?: number;
  src?: string;
  alt?: string;
}) {
  if (src) {
    // Real photo: object-cover circle so any aspect ratio sits cleanly. Plain <img>
    // (not next/image) keeps this a self-contained swap target for /public/humans/.
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "9999px", objectFit: "cover", display: "block", flexShrink: 0 }}
      />
    );
  }

  const i = ((seed % SKIN.length) + SKIN.length) % SKIN.length;
  const skin = SKIN[i]!;
  const hair = HAIR[i]!;
  const shirt = SHIRT[i]!;
  const bg = BGC[i]!;
  // Two simple hair silhouettes alternate for variety.
  const shortHair = seed % 2 === 0;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label={alt || "Illustrated person"} style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={`pa-clip-${seed}`}><circle cx="40" cy="40" r="40" /></clipPath>
      </defs>
      <g clipPath={`url(#pa-clip-${seed})`}>
        <rect width="80" height="80" fill={bg} />
        {/* shoulders */}
        <path d="M14 80c0-15 12-24 26-24s26 9 26 24Z" fill={shirt} />
        {/* neck */}
        <rect x="35" y="45" width="10" height="12" rx="5" fill={skin} />
        {/* head */}
        <circle cx="40" cy="36" r="15" fill={skin} />
        {/* hair */}
        {shortHair ? (
          <path d="M25 34c0-9 7-16 15-16s15 7 15 16c-3-6-8-8-15-8s-12 2-15 8Z" fill={hair} />
        ) : (
          <path d="M24 40c0-12 7-20 16-20s16 8 16 20c0-4-2-6-4-7 0 0-4 3-12 3s-12-3-12-3c-2 1-4 3-4 7Z" fill={hair} />
        )}
        {/* face */}
        <circle cx="34.5" cy="36" r="1.5" fill="#1f2937" />
        <circle cx="45.5" cy="36" r="1.5" fill="#1f2937" />
        <path d="M35 42.5c1.6 1.8 8.4 1.8 10 0" fill="none" stroke="#9a5b45" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
