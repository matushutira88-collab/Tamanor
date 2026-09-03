/**
 * The pending-flow marker, persisted so an OAuth round trip survives the app being
 * backgrounded or killed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS STORED, AND WHY SO LITTLE.
 *
 * Only a flow id, a provider, an intent and a timestamp. That is everything needed
 * to resume: on cold start the app restores its bearer through the normal M2 path
 * and asks the server about this flow — the truth was never on the device.
 *
 * DELIBERATELY NEVER STORED: the OAuth state (the app never sees it — it lives in
 * the server-built authorization URL), the authorization code, any provider token,
 * or a second copy of the bearer. There is no field for any of them, so a device
 * compromise yields a correlation id whose status endpoint still demands a valid
 * session for the right user.
 *
 * It uses SecureStore because that keychain is already wired for the session; the
 * marker is not itself a secret, but storing it beside the session keeps one
 * storage discipline rather than two.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { OAuthIntent, OAuthProvider } from "@/api/types";
import type { SecureStoreLike } from "@/auth/session-storage-core";

export const PENDING_FLOW_KEY = "tamanor.oauth.pending";

export interface PendingFlow {
  flowId: string;
  provider: OAuthProvider;
  intent: OAuthIntent;
  /** ISO timestamp, used only to drop an absurdly stale marker. */
  startedAt: string;
}

/**
 * Markers older than this are discarded on read.
 *
 * Comfortably longer than the server's 10-minute flow TTL, because the SERVER is
 * the authority on expiry — this only stops a forgotten marker lingering forever.
 */
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROVIDERS: readonly string[] = ["meta", "google_business"];
const INTENTS: readonly string[] = ["connect", "reconnect"];

/** Validate anything read back from storage before it is trusted as shape. */
export function parsePendingFlow(raw: string | null, now: Date = new Date()): PendingFlow | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (typeof v.flowId !== "string" || !FLOW_ID_PATTERN.test(v.flowId)) return null;
  if (typeof v.provider !== "string" || !PROVIDERS.includes(v.provider)) return null;
  if (typeof v.intent !== "string" || !INTENTS.includes(v.intent)) return null;
  if (typeof v.startedAt !== "string") return null;

  const started = new Date(v.startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  if (now.getTime() - started > PENDING_MAX_AGE_MS) return null;

  return {
    flowId: v.flowId,
    provider: v.provider as OAuthProvider,
    intent: v.intent as OAuthIntent,
    startedAt: v.startedAt,
  };
}

export interface PendingFlowStorage {
  read: (now?: Date) => Promise<PendingFlow | null>;
  write: (flow: PendingFlow) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Build the storage over an injected keychain, so the whole contract is testable
 * off-device. Every operation fails soft: a keychain error must never break an
 * OAuth flow, because the server remains the source of truth either way.
 */
export function createPendingFlowStorage(store: SecureStoreLike): PendingFlowStorage {
  return {
    read: async (now = new Date()) => {
      try {
        return parsePendingFlow(await store.getItemAsync(PENDING_FLOW_KEY), now);
      } catch {
        return null;
      }
    },
    write: async (flow) => {
      try {
        await store.setItemAsync(PENDING_FLOW_KEY, JSON.stringify(flow));
      } catch {
        // A marker that could not be written only costs a resume; nothing is lost.
      }
    },
    clear: async () => {
      try {
        await store.deleteItemAsync(PENDING_FLOW_KEY);
      } catch {
        // Nothing to do — the marker is not authoritative.
      }
    },
  };
}
