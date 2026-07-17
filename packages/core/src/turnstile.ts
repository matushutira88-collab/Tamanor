/**
 * V1.58.9 — Cloudflare Turnstile server verification + adaptive-challenge decision. The token from the
 * browser is ALWAYS verified server-side against Cloudflare's siteverify (mere presence is never
 * enough). FAIL-CLOSED in production: if Turnstile is enabled but the secret/site key is missing, config
 * is invalid and the guarded flow must refuse. The secret is server-only and NEVER logged or placed in a
 * URL/query. Adaptive login: the SERVER decides when a challenge is required (the frontend cannot bypass it).
 */
export interface TurnstileConfig {
  enabled: boolean;
  siteKey?: string;
  hasSecret: boolean;
  /** Non-production may run an explicit test mode (Cloudflare provides always-pass/always-fail test keys). */
  testMode: boolean;
}

export function getTurnstileConfig(source: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  const enabled = source.TURNSTILE_ENABLED === "true" || source.TURNSTILE_ENABLED === "1";
  return {
    enabled,
    siteKey: source.TURNSTILE_SITE_KEY?.trim() || undefined,
    hasSecret: Boolean(source.TURNSTILE_SECRET_KEY?.trim()),
    testMode: (source.NODE_ENV ?? "development") !== "production",
  };
}

/** FAIL-CLOSED invariant: in production, enabled Turnstile MUST have both a site key and a secret. */
export function turnstileConfigInvalid(source: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = getTurnstileConfig(source);
  const isProd = (source.NODE_ENV ?? "development") === "production";
  return isProd && cfg.enabled && (!cfg.siteKey || !cfg.hasSecret);
}

type FetchLike = (url: string, init?: { method?: string; body?: URLSearchParams; signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface TurnstileVerifyResult {
  ok: boolean;
  /** Safe classification only — never the token or secret. */
  reason?: "success" | "missing_token" | "invalid" | "timeout" | "config_missing" | "hostname_mismatch";
}

/**
 * Verify a Turnstile token against Cloudflare. `fetchImpl` is injectable for tests. Optionally asserts
 * the response hostname matches `expectedHostname`. Bounded timeout. Returns only a safe classification.
 */
export async function verifyTurnstile(opts: {
  token: string | null | undefined;
  secret: string | undefined;
  remoteip?: string;
  expectedHostname?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<TurnstileVerifyResult> {
  if (!opts.secret) return { ok: false, reason: "config_missing" };
  if (!opts.token) return { ok: false, reason: "missing_token" };
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const body = new URLSearchParams({ secret: opts.secret, response: opts.token });
  if (opts.remoteip) body.set("remoteip", opts.remoteip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    if (!res.ok) return { ok: false, reason: "invalid" };
    const data = (await res.json()) as { success?: boolean; hostname?: string };
    if (data.success !== true) return { ok: false, reason: "invalid" };
    if (opts.expectedHostname && data.hostname && data.hostname !== opts.expectedHostname) {
      return { ok: false, reason: "hostname_mismatch" };
    }
    return { ok: true, reason: "success" };
  } catch {
    return { ok: false, reason: "timeout" };
  }
}

/** Adaptive login: the SERVER requires a challenge once failed attempts reach the threshold. */
export function loginChallengeRequired(failedCount: number, threshold = 3): boolean {
  return failedCount >= Math.max(1, threshold);
}
