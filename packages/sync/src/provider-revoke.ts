/**
 * V1.37.4 — provider-neutral credential revoke adapter (M). Business/UI layers call
 * ONE contract; provider specifics live only here. Truthful by default: with no real
 * revoke transport wired (placeholder connectors), Meta returns `unsupported` and the
 * read-only Google connector returns `unsupported` — never a fake "revoked". A raw
 * provider error never escapes; only a normalized reason is returned.
 */

export type RevokeResult = "revoked" | "unsupported" | "failed" | "already_invalid";

/** Injectable provider transport (tests supply this; production has none by default). */
export interface RevokeTransport {
  /** Revoke a Meta Page/user token. `alreadyInvalid` = token was already dead. */
  revokeMeta?: (input: { externalAccountId: string; accessToken: string }) => Promise<{ ok: boolean; alreadyInvalid?: boolean }>;
}

export interface RevokeInput {
  platform: string;
  /** PLAINTEXT token (already decrypted by the caller). Null → nothing to revoke. */
  accessToken: string | null;
  externalAccountId: string;
}

/**
 * Best-effort revoke of provider credentials. Returns a normalized result; the caller
 * always removes the LOCAL credentials regardless of this outcome.
 */
export async function revokeProviderCredentials(
  input: RevokeInput,
  opts?: { transport?: RevokeTransport },
): Promise<RevokeResult> {
  if (!input.accessToken) return "already_invalid";

  if (input.platform === "facebook_page" || input.platform === "instagram_business") {
    const revoke = opts?.transport?.revokeMeta;
    // No confirmed real revoke flow is wired in placeholder mode → truthful unsupported.
    if (!revoke) return "unsupported";
    try {
      const r = await revoke({ externalAccountId: input.externalAccountId, accessToken: input.accessToken });
      if (r.alreadyInvalid) return "already_invalid";
      return r.ok ? "revoked" : "failed";
    } catch {
      return "failed";
    }
  }

  // Google Business is a read-only connector — no confirmed programmatic revoke flow.
  // Do NOT pretend to revoke; the caller still removes local credentials.
  return "unsupported";
}
