/**
 * V1.50B — production social sign-in buttons for USER login. Enabled links to the real
 * OAuth start routes (Google / Facebook). No disabled state, no "available soon": the
 * routes handle an unconfigured provider by redirecting back with a truthful message.
 * These are USER-login providers only — unrelated to connecting a Facebook Page.
 */
const btn =
  "flex w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface)]";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#1877F2" d="M18 9a9 9 0 1 0-10.41 8.89v-6.29H5.31V9h2.28V7.02c0-2.25 1.34-3.5 3.4-3.5.98 0 2.01.18 2.01.18v2.22h-1.13c-1.12 0-1.47.69-1.47 1.4V9h2.5l-.4 2.6h-2.1v6.29A9 9 0 0 0 18 9Z" />
    </svg>
  );
}

export function SocialAuthButtons({
  mode,
  googleLabel,
  facebookLabel,
}: {
  mode: "login" | "register";
  googleLabel: string;
  facebookLabel: string;
}) {
  return (
    <div className="space-y-2">
      <a href={`/api/auth/google/start?mode=${mode}`} className={btn}>
        <GoogleMark />
        {googleLabel}
      </a>
      <a href={`/api/auth/facebook/start?mode=${mode}`} className={btn}>
        <FacebookMark />
        {facebookLabel}
      </a>
    </div>
  );
}
