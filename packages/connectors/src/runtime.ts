import {
  ConnectorMode,
  modeAllowsActions,
  modeAllowsSync,
  type Platform,
} from "@guardora/core";
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
 * ConnectorRuntime wraps a raw {@link PlatformConnector} and enforces its
 * {@link ConnectorMode}. It is the single choke point that guarantees:
 *
 *   - moderation actions are HARD-DISABLED in every V1.2 mode (returns
 *     `{ ok:false, disabled:true }` — never a fake success), and
 *   - sync is only attempted when the mode permits it.
 *
 * The approval workflow is still the primary gate; this runtime is defense in
 * depth beneath it, so even an approved+executed action cannot reach a real
 * platform API while actions are disabled.
 */
export class ConnectorRuntime implements PlatformConnector {
  readonly platform: Platform;

  constructor(
    private readonly inner: PlatformConnector,
    public readonly mode: ConnectorMode,
  ) {
    this.platform = inner.platform;
  }

  async connect(auth: ConnectorAuthContext): Promise<void> {
    return this.inner.connect(auth);
  }

  async syncComments(options?: SyncOptions): Promise<SyncResult> {
    if (!modeAllowsSync(this.mode)) return { items: [] };
    return this.inner.syncComments(options);
  }

  async syncReviews(options?: SyncOptions): Promise<SyncResult> {
    if (!modeAllowsSync(this.mode)) return { items: [] };
    return this.inner.syncReviews(options);
  }

  async reply(input: ReplyInput): Promise<ActionResult> {
    return this.guardAction(() => this.inner.reply(input));
  }

  async hide(ref: ContentRef): Promise<ActionResult> {
    return this.guardAction(() => this.inner.hide(ref));
  }

  async delete(ref: ContentRef): Promise<ActionResult> {
    return this.guardAction(() => this.inner.delete(ref));
  }

  async markResolved(ref: ContentRef): Promise<ActionResult> {
    // Guardora-side only; never touches a platform. Always allowed.
    return this.inner.markResolved(ref);
  }

  private async guardAction(
    run: () => Promise<ActionResult>,
  ): Promise<ActionResult> {
    if (!modeAllowsActions(this.mode)) {
      return {
        ok: false,
        disabled: true,
        error: `Moderation actions are disabled in "${this.mode}" mode (V1.2 read-only).`,
      };
    }
    return run();
  }
}

/** Wrap a connector with a runtime that enforces the given mode. */
export function withMode(
  connector: PlatformConnector,
  mode: ConnectorMode,
): ConnectorRuntime {
  return new ConnectorRuntime(connector, mode);
}
