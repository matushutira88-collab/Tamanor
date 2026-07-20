"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  locales,
  localeShort,
  localeNames,
  LOCALE_COOKIE,
  localePrefix,
  isLocale,
  type Locale,
} from "@/i18n/config";

function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** Strip a leading /sk or /de from a marketing path, returning the rest. */
function stripLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  if (isLocale(seg) && seg !== "en") {
    const rest = pathname.slice(seg.length + 1);
    return rest === "" ? "/" : rest;
  }
  return pathname || "/";
}

export function LanguageSwitcher({
  current,
  variant = "marketing",
}: {
  current: Locale;
  variant?: "marketing" | "app";
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Only these marketing paths have locale-prefixed route variants.
  const LOCALIZED_ROUTES = ["/", "/case-studies"];

  function switchTo(locale: Locale) {
    setLocaleCookie(locale);
    if (variant === "marketing") {
      const rest = stripLocale(pathname);
      if (LOCALIZED_ROUTES.includes(rest)) {
        const prefix = localePrefix(locale);
        router.push(rest === "/" ? prefix || "/" : `${prefix}${rest}`);
        return;
      }
      // Other marketing pages (trust pages) localize their shell via cookie.
      router.refresh();
    } else {
      router.refresh();
    }
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border-strong)] p-0.5"
      role="group"
      aria-label="Language"
    >
      {locales.map((l) => {
        const on = l === current;
        return (
          <button
            key={l}
            type="button"
            onClick={() => switchTo(l)}
            aria-label={localeNames[l]}
            aria-pressed={on}
            // V1.66 — the horizontal padding steps up with the viewport: at 320px the narrowest padding is
            // what lets the public header also fit Log in + Start free in the longest locale (DE), and from
            // 360px up the tap target widens again. Vertical padding is larger on mobile at zero width cost.
            className={`rounded-md px-1 py-1.5 text-xs font-semibold transition min-[360px]:px-1.5 sm:px-2 sm:py-1 ${
              on
                ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {localeShort[l]}
          </button>
        );
      })}
    </div>
  );
}
