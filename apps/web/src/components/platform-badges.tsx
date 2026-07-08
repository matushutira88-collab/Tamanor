import { PLATFORM_META, Platform } from "@guardora/core";

/** Display order requested for the landing badges. */
const ORDER: Platform[] = [
  Platform.FacebookPage,
  Platform.InstagramBusiness,
  Platform.YouTube,
  Platform.LinkedInCompany,
  Platform.TikTok,
  Platform.GoogleBusiness,
];

const MONOGRAM: Record<Platform, { short: string; tint: string }> = {
  [Platform.FacebookPage]: { short: "Fb", tint: "#4267ff" },
  [Platform.InstagramBusiness]: { short: "Ig", tint: "#e1476f" },
  [Platform.YouTube]: { short: "Yt", tint: "#ff5c72" },
  [Platform.LinkedInCompany]: { short: "In", tint: "#3ea6ff" },
  [Platform.TikTok]: { short: "Tk", tint: "#17d3a3" },
  [Platform.GoogleBusiness]: { short: "G", tint: "#ffb454" },
};

export function PlatformBadges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {ORDER.map((p) => {
        const meta = PLATFORM_META[p];
        const mono = MONOGRAM[p];
        return (
          <div
            key={p}
            className="gu-card flex items-center gap-2.5 px-3.5 py-2"
            title={meta.label}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold text-[#08111f]"
              style={{ backgroundColor: mono.tint }}
            >
              {mono.short}
            </span>
            <span className="text-sm text-[var(--color-fg)]">{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}
