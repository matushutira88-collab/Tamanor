/**
 * ConnectorMode describes how a connected account is *executed* at runtime,
 * independent of which platform it is. It is the single gate that decides
 * whether a connector may sync and whether it may perform moderation actions.
 *
 * V1.2 invariant: NO mode enables actions. Real moderation execution stays off
 * until a later phase — the approval workflow remains the security gate, and on
 * top of it the runtime hard-disables reply/hide/delete for every mode here.
 */
export enum ConnectorMode {
  /** No real OAuth. Mock/dev only — sync yields clearly-labelled MOCK data. */
  Placeholder = "placeholder",
  /** OAuth app is configured; the account can start OAuth but isn't connected. */
  OauthReady = "oauth_ready",
  /** Connected via official OAuth. Read-only sync allowed; actions disabled. */
  ReadOnly = "read_only",
  /** Connected, but actions are explicitly disabled (no sync assumptions). */
  ActionDisabled = "action_disabled",
}

/** Health of a connection, surfaced in the dashboard. */
export enum ConnectorHealth {
  Unknown = "unknown",
  Healthy = "healthy",
  Degraded = "degraded",
  Error = "error",
}

export interface ConnectorModeCapabilities {
  /** May the connector pull content? */
  canSync: boolean;
  /** May the connector execute moderation actions? (false everywhere in V1.2) */
  canAct: boolean;
  /** Does this mode represent a real, OAuth-backed connection? */
  isReal: boolean;
}

export const CONNECTOR_MODE_CAPABILITIES: Record<
  ConnectorMode,
  ConnectorModeCapabilities
> = {
  [ConnectorMode.Placeholder]: { canSync: true, canAct: false, isReal: false },
  [ConnectorMode.OauthReady]: { canSync: false, canAct: false, isReal: false },
  [ConnectorMode.ReadOnly]: { canSync: true, canAct: false, isReal: true },
  [ConnectorMode.ActionDisabled]: { canSync: true, canAct: false, isReal: true },
};

export function modeAllowsSync(mode: ConnectorMode): boolean {
  return CONNECTOR_MODE_CAPABILITIES[mode].canSync;
}

/** Always false in V1.2 — kept as the single choke point for future phases. */
export function modeAllowsActions(mode: ConnectorMode): boolean {
  return CONNECTOR_MODE_CAPABILITIES[mode].canAct;
}

export function isRealConnection(mode: ConnectorMode): boolean {
  return CONNECTOR_MODE_CAPABILITIES[mode].isReal;
}

/**
 * True when a real connection needs the user to re-authorize: token expired, or
 * health has degraded/errored. Placeholder/mock connections never need reconnect.
 */
export function connectorNeedsReconnect(input: {
  health: ConnectorHealth;
  tokenExpiresAt?: Date | string | null;
}): boolean {
  if (
    input.health === ConnectorHealth.Error ||
    input.health === ConnectorHealth.Degraded
  ) {
    return true;
  }
  if (input.tokenExpiresAt) {
    const expiry = new Date(input.tokenExpiresAt).getTime();
    if (Number.isFinite(expiry) && expiry <= Date.now()) return true;
  }
  return false;
}

/** Human-facing label + description for a mode (dashboard). */
export const CONNECTOR_MODE_META: Record<
  ConnectorMode,
  { label: string; description: string }
> = {
  [ConnectorMode.Placeholder]: {
    label: "Placeholder",
    description: "Mock/dev only. No real OAuth. Sync yields labelled MOCK data.",
  },
  [ConnectorMode.OauthReady]: {
    label: "OAuth ready",
    description: "OAuth app configured. Ready to connect; not yet connected.",
  },
  [ConnectorMode.ReadOnly]: {
    label: "Read-only",
    description: "Connected via OAuth. Sync enabled; moderation actions disabled.",
  },
  [ConnectorMode.ActionDisabled]: {
    label: "Actions disabled",
    description: "Connected. Moderation actions are disabled.",
  },
};
