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

/**
 * The DOCUMENTED Cloudflare siteverify error codes, as a closed allow-list. Anything Cloudflare returns
 * that is not on this list becomes `unknown_provider_error` — an unrecognised provider string is never
 * echoed into telemetry, because `reason` is a bounded SafeLabel and free-form provider text could carry
 * unexpected content.
 *
 * PRECEDENCE (deterministic, most-actionable first). Cloudflare may return several codes; we emit exactly
 * ONE canonical reason, chosen by this order, so the same response always yields the same label:
 *   1. missing-input-secret   — OUR secret was not sent            (deployment fault, we control it)
 *   2. invalid-input-secret   — OUR secret is wrong                (deployment fault, we control it)
 *   3. bad-request            — OUR request was malformed          (integration fault, we control it)
 *   4. missing-input-response — no token was submitted             (client/widget did not produce one)
 *   5. timeout-or-duplicate   — token expired or already consumed  (most specific token fault)
 *   6. invalid-input-response — token invalid/unparseable          (includes hostname not allow-listed)
 *   7. internal-error         — Cloudflare-side failure            (retryable, not ours)
 * Config faults rank above token faults because they invalidate every request, not just one.
 */
const PROVIDER_ERROR_PRECEDENCE = [
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
  "missing-input-response",
  "timeout-or-duplicate",
  "invalid-input-response",
  "internal-error",
] as const;

export type TurnstileProviderReason = (typeof PROVIDER_ERROR_PRECEDENCE)[number] | "unknown_provider_error";

/** Local (pre-network) classifications plus the bounded provider vocabulary. */
export type TurnstileReason =
  | "success"
  | "missing_token"
  | "config_missing"
  | "timeout"
  | "hostname_mismatch"
  /** Retained for compatibility: a non-2xx siteverify HTTP response carries no parsable error-codes. */
  | "invalid"
  | TurnstileProviderReason;

export interface TurnstileVerifyResult {
  ok: boolean;
  /** Safe classification only — never the token, secret, hostname, IP or raw provider body. */
  reason?: TurnstileReason;
}

/**
 * Reduce Cloudflare's `error-codes` array to ONE bounded reason. Never returns provider text: an
 * unrecognised or malformed value collapses to `unknown_provider_error`. An empty/absent array on a
 * `success:false` response also collapses to `unknown_provider_error` — the failure is still honoured.
 */
export function canonicalTurnstileErrorReason(raw: unknown): TurnstileProviderReason {
  const codes = new Set(
    (Array.isArray(raw) ? raw : []).filter((c): c is string => typeof c === "string"),
  );
  for (const known of PROVIDER_ERROR_PRECEDENCE) {
    if (codes.has(known)) return known;
  }
  return "unknown_provider_error";
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
    // Only these three fields are read. The raw body is never returned, logged or retained.
    const data = (await res.json()) as { success?: boolean; hostname?: string; "error-codes"?: unknown };
    // FAIL-CLOSED, unchanged: anything other than an explicit `success: true` is a rejection. The only
    // difference from before is that the rejection now carries the canonical provider category instead of
    // a flat "invalid", so production telemetry can name the actual failure.
    if (data.success !== true) return { ok: false, reason: canonicalTurnstileErrorReason(data["error-codes"]) };
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
