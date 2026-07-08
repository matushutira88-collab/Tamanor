import { PLATFORM_META, type Platform } from "@guardora/core";
import type {
  ActionResult,
  ConnectorAuthContext,
  ContentRef,
  PlatformConnector,
  ReplyInput,
  SyncOptions,
  SyncResult,
} from "./types";

/**
 * BasePlaceholderConnector — safe default behavior for every adapter.
 *
 * IMPORTANT: this makes NO real API calls. Sync methods return empty results;
 * action methods return `unsupported` unless the platform's capability flags
 * say otherwise (in which case they return a benign no-op success). Real
 * adapters override these methods with official-API implementations.
 */
export abstract class BasePlaceholderConnector implements PlatformConnector {
  abstract readonly platform: Platform;

  protected auth?: ConnectorAuthContext;

  async connect(auth: ConnectorAuthContext): Promise<void> {
    // Placeholder: store context only. No token exchange, no network.
    this.auth = auth;
  }

  async syncComments(_options?: SyncOptions): Promise<SyncResult> {
    return { items: [] };
  }

  async syncReviews(_options?: SyncOptions): Promise<SyncResult> {
    if (!PLATFORM_META[this.platform].supportsReviews) {
      return { items: [] };
    }
    return { items: [] };
  }

  async reply(_input: ReplyInput): Promise<ActionResult> {
    return this.capabilityGuard("supportsReply");
  }

  async hide(_ref: ContentRef): Promise<ActionResult> {
    return this.capabilityGuard("supportsHide");
  }

  async delete(_ref: ContentRef): Promise<ActionResult> {
    return this.capabilityGuard("supportsDelete");
  }

  async markResolved(_ref: ContentRef): Promise<ActionResult> {
    // Resolution is a Guardora-side concept; always "succeeds" as a no-op.
    return { ok: true };
  }

  /**
   * Returns unsupported when the platform can't do the action; otherwise a
   * benign placeholder success (no real change is made).
   */
  protected capabilityGuard(
    capability: "supportsReply" | "supportsHide" | "supportsDelete",
  ): ActionResult {
    if (!PLATFORM_META[this.platform][capability]) {
      return {
        ok: false,
        unsupported: true,
        error: `${this.platform} API does not support this action`,
      };
    }
    return { ok: true };
  }
}
