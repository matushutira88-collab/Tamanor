import { ConnectorMode, Platform, isRealConnection } from "@guardora/core";
import type { PlatformConnector } from "./types";
import { ConnectorRuntime } from "./runtime";
import { MetaConnector } from "./adapters/meta-connector";
import { MetaReadOnlyConnector } from "./adapters/meta-read-only-connector";
import { YouTubeConnector } from "./adapters/youtube-connector";
import { LinkedInConnector } from "./adapters/linkedin-connector";
import { TikTokConnector } from "./adapters/tiktok-connector";
import { GoogleBusinessConnector } from "./adapters/google-business-connector";

/**
 * Create the placeholder connector for a platform. Facebook and Instagram both
 * map to the Meta placeholder, parameterized by platform. This is the mock path.
 */
export function createConnector(platform: Platform): PlatformConnector {
  switch (platform) {
    case Platform.FacebookPage:
    case Platform.InstagramBusiness:
      return new MetaConnector(platform);
    case Platform.YouTube:
      return new YouTubeConnector();
    case Platform.LinkedInCompany:
      return new LinkedInConnector();
    case Platform.TikTok:
      return new TikTokConnector();
    case Platform.GoogleBusiness:
      return new GoogleBusinessConnector();
    default: {
      const _exhaustive: never = platform;
      throw new Error(`No connector registered for platform: ${_exhaustive}`);
    }
  }
}

/**
 * Create the raw connector appropriate for a mode: a REAL read-only adapter for
 * genuine OAuth connections (Meta only in V1.2), otherwise the placeholder.
 */
export function createRawConnector(
  platform: Platform,
  mode: ConnectorMode,
): PlatformConnector {
  const real = isRealConnection(mode);
  if (
    real &&
    (platform === Platform.FacebookPage ||
      platform === Platform.InstagramBusiness)
  ) {
    return new MetaReadOnlyConnector(platform);
  }
  // No other platform has a real adapter yet — fall back to placeholder.
  return createConnector(platform);
}

/**
 * Build a mode-enforcing runtime for an account. This is the ONLY way callers
 * should obtain a connector for execution: it guarantees actions are gated and
 * sync is only attempted when the mode allows it.
 */
export function createConnectorRuntime(
  platform: Platform,
  mode: ConnectorMode,
): ConnectorRuntime {
  return new ConnectorRuntime(createRawConnector(platform, mode), mode);
}
