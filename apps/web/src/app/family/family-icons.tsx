/**
 * FAMILY-UI-01 — minimal, dependency-free stroke icons for the Family console.
 * Presentational only: no data, no permissions, no enum semantics. Mirrors the
 * Business sidebar glyph style (18px, 1.7 stroke, currentColor) so both consoles
 * feel like one product, but stays on its own key union so the Family nav is not
 * coupled to the Business `NavIcon` model (FAMILY/BUSINESS separation).
 */

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

export type FamilyIcon =
  | "overview"
  | "profiles"
  | "guardians"
  | "invitations"
  | "authorizations"
  | "signals"
  | "deliveries"
  | "settings"
  | "shield"
  | "check"
  | "arrow";

export function FamilyIconGlyph({ icon }: { icon: FamilyIcon }) {
  switch (icon) {
    case "overview":
      return (
        <svg {...S}>
          <path d="M3 10.5 12 4l9 6.5" />
          <path d="M5 9.8V19a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1V9.8" />
        </svg>
      );
    case "profiles":
      return (
        <svg {...S}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case "guardians":
      return (
        <svg {...S}>
          <circle cx="9" cy="8.5" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <path d="M16 6.2a3 3 0 0 1 0 5.6M18 20a5.6 5.6 0 0 0-2.2-4.4" />
        </svg>
      );
    case "invitations":
      return (
        <svg {...S}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.8 7 7.1 5.3a2 2 0 0 0 2.2 0L20.2 7" />
        </svg>
      );
    case "authorizations":
      return (
        <svg {...S}>
          <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
          <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
          <path d="M12 14.3v2.2" />
        </svg>
      );
    case "signals":
      return (
        <svg {...S}>
          <path d="M12 3.5 20.5 19a1 1 0 0 1-.87 1.5H4.37A1 1 0 0 1 3.5 19z" />
          <path d="M12 9.5v4M12 16.8h.01" />
        </svg>
      );
    case "deliveries":
      return (
        <svg {...S}>
          <path d="M4 8.5 12 4.5l8 4v7L12 19.5l-8-4z" />
          <path d="M4 8.5 12 12.5l8-4M12 12.5v7" />
        </svg>
      );
    case "settings":
      return (
        <svg {...S}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
        </svg>
      );
    case "shield":
      return (
        <svg {...S} width="22" height="22">
          <path d="M12 3.2 19 6v5.6c0 4.2-2.8 7.7-7 9.2-4.2-1.5-7-5-7-9.2V6z" />
          <path d="m9 12 2.2 2.2L15.2 10" />
        </svg>
      );
    case "check":
      return (
        <svg {...S} width="14" height="14" strokeWidth={2.4}>
          <path d="m5 12.5 4.2 4.2L19 7" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...S} width="16" height="16">
          <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
        </svg>
      );
  }
}
