import { Platform } from "@guardora/core";

const TILE: Record<string, { short: string; tint: string }> = {
  [Platform.FacebookPage]: { short: "Fb", tint: "#1877f2" },
  [Platform.InstagramBusiness]: { short: "Ig", tint: "#e1476f" },
  [Platform.YouTube]: { short: "Yt", tint: "#ff0033" },
  [Platform.LinkedInCompany]: { short: "in", tint: "#0a66c2" },
  [Platform.TikTok]: { short: "Tk", tint: "#111827" },
  [Platform.GoogleBusiness]: { short: "G", tint: "#ea9a2e" },
};

/** Small brand-tinted monogram tile for a platform. Neutral fallback. */
export function PlatformIcon({
  platform,
  size = 24,
}: {
  platform: string;
  size?: number;
}) {
  const t = TILE[platform] ?? { short: "?", tint: "#94a3b8" };
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{
        backgroundColor: t.tint,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
      title={platform}
      aria-hidden="true"
    >
      {t.short}
    </span>
  );
}
