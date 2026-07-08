import { PLATFORM_META, Platform } from "@guardora/core";
import { BrandIcon } from "@/components/dashboard/platform-icon";

/** Display order requested for the landing badges. */
const ORDER: Platform[] = [
  Platform.FacebookPage,
  Platform.InstagramBusiness,
  Platform.YouTube,
  Platform.LinkedInCompany,
  Platform.TikTok,
  Platform.GoogleBusiness,
];

export function PlatformBadges() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {ORDER.map((p) => (
        <div
          key={p}
          className="gu-card flex items-center gap-2.5 px-3.5 py-2"
          title={PLATFORM_META[p].label}
        >
          <BrandIcon platform={p} size={24} />
          <span className="text-sm text-[var(--color-fg)]">{PLATFORM_META[p].label}</span>
        </div>
      ))}
    </div>
  );
}
