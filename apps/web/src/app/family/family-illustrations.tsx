/**
 * FAMILY-UI-02 — Family-local line-art illustrations for empty states.
 *
 * Same visual language as `components/illustrations.tsx` (96x96 frame, `currentColor`,
 * 2.5 stroke, no faces, no photos, no third-party marks), but kept inside the Family
 * route so the Family console never depends on Business/marketing assets.
 * Presentational only: no data, no props beyond size/class.
 */

type Props = { className?: string; size?: number };

function frame(size = 96) {
  return { width: size, height: size, viewBox: "0 0 96 96", fill: "none" as const };
}

export type FamilyIllustration =
  | "protected"
  | "profiles"
  | "guardians"
  | "invitations"
  | "authorizations"
  | "signals"
  | "deliveries"
  | "error";

/** Shield around a small figure — the family space is protected and quiet. */
function IllusProtected({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <path d="M48 14l24 9v17c0 17-11 28-24 34-13-6-24-17-24-34V23l24-9Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity="0.9" />
      <circle cx="48" cy="42" r="7" stroke="currentColor" strokeWidth="2.5" />
      <path d="M36 62a12 12 0 0 1 24 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.3" />
    </svg>
  );
}

/** An empty profile card — a safe label and an age band, nothing more. */
function IllusProfiles({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <rect x="18" y="24" width="60" height="48" rx="8" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="38" cy="43" r="7" stroke="currentColor" strokeWidth="2.5" />
      <path d="M28 60a10 10 0 0 1 20 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M56 40h14M56 50h14M56 60h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

/** Two figures side by side — authorized people around a profile. */
function IllusGuardians({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <circle cx="36" cy="38" r="9" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 66a16 16 0 0 1 32 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="62" cy="42" r="7" stroke="currentColor" strokeWidth="2.5" opacity="0.55" />
      <path d="M50 66a13 13 0 0 1 26 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/** Envelope with a one-time link — invitations are handed over, never sent by us. */
function IllusInvitations({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <rect x="18" y="28" width="60" height="40" rx="7" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 34l24 17a7 7 0 0 0 8 0l24-17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.3" />
    </svg>
  );
}

/** Padlock with a check — an authorization is a closed, verified chain. */
function IllusAuthorizations({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <rect x="26" y="44" width="44" height="30" rx="7" stroke="currentColor" strokeWidth="2.5" />
      <path d="M36 44v-9a12 12 0 0 1 24 0v9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 59l5 5 11-11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Calm radar — listening, but nothing has been detected. */
function IllusSignals({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <circle cx="48" cy="52" r="5" fill="currentColor" />
      <path d="M34 52a14 14 0 0 1 28 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
      <path d="M24 52a24 24 0 0 1 48 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
      <path d="M14 52a34 34 0 0 1 68 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.22" />
      <path d="M20 68h56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** Tray — internal delivery: made available inside Tamanor, not sent anywhere. */
function IllusDeliveries({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <path d="M22 30h52v32a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V30Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M22 52h14l4 8h16l4-8h14" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M40 22h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** Interrupted circle — something did not load. Deliberately not alarming. */
function IllusError({ className = "", size = 96 }: Props) {
  return (
    <svg {...frame(size)} className={className} aria-hidden="true">
      <circle cx="48" cy="48" r="26" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <path d="M48 36v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="59" r="2.2" fill="currentColor" />
      <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.3" />
    </svg>
  );
}

export function FamilyIllus({ name, size = 96, className = "" }: { name: FamilyIllustration } & Props) {
  switch (name) {
    case "protected": return <IllusProtected size={size} className={className} />;
    case "profiles": return <IllusProfiles size={size} className={className} />;
    case "guardians": return <IllusGuardians size={size} className={className} />;
    case "invitations": return <IllusInvitations size={size} className={className} />;
    case "authorizations": return <IllusAuthorizations size={size} className={className} />;
    case "signals": return <IllusSignals size={size} className={className} />;
    case "deliveries": return <IllusDeliveries size={size} className={className} />;
    case "error": return <IllusError size={size} className={className} />;
  }
}
