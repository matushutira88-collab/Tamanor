import { createConnector, type PlatformConnector } from "@guardora/connectors";
import { RiskClassifier } from "@guardora/ai";
import {
  Platform,
  RiskLevel,
  type ConnectorAccount,
} from "@guardora/core";
import { log } from "./logger";

/**
 * The reputation pipeline: sync -> classify -> triage.
 *
 * This is a SKELETON. It wires the real interfaces (connectors + AI engine) but:
 *   - connectors are placeholders (no platform API calls)
 *   - persistence is not performed (marked with TODO)
 *   - NO moderation action is ever executed automatically here
 *
 * Triage only decides where an item goes (auto-eligible vs. human approval).
 * Actual execution belongs to a separate, audited action step.
 */

const classifier = new RiskClassifier();

/** Confidence required before an item is even *eligible* for auto-action. */
const AUTO_ACTION_MIN_CONFIDENCE = 0.9;

export interface PipelineStats {
  fetched: number;
  classified: number;
  routedToApproval: number;
  autoEligible: number;
}

export async function runPipelineForAccount(
  account: ConnectorAccount,
): Promise<PipelineStats> {
  const connector: PlatformConnector = createConnector(account.platform);

  // In production we'd load & refresh the account's OAuth tokens here
  // (official OAuth only) before connecting. Placeholder passes empty tokens.
  await connector.connect({
    accessToken: "",
    externalId: account.externalId,
    scopes: account.scopes,
  });

  const stats: PipelineStats = {
    fetched: 0,
    classified: 0,
    routedToApproval: 0,
    autoEligible: 0,
  };

  const comments = await connector.syncComments({ limit: 100 });
  const reviews = await connector.syncReviews({ limit: 100 });
  const fetched = [...comments.items, ...reviews.items];
  stats.fetched = fetched.length;

  for (const content of fetched) {
    // TODO(persist): upsert ContentItem, dedupe by (connectedAccountId, externalId)
    const risk = await classifier.classify({
      text: content.text,
      platform: content.platform,
      locale: content.author.locale,
      rating: content.rating,
    });
    stats.classified++;

    const requiresApproval = shouldRouteToApproval(risk.level, risk.confidence);
    if (requiresApproval) stats.routedToApproval++;
    else if (isAutoEligible(risk.confidence)) stats.autoEligible++;

    // TODO(persist): upsert ReputationItem with risk + status
    // TODO(rules): evaluate BrandRules; any action still passes through audit
  }

  log.info("pipeline.account.done", {
    platform: account.platform,
    ...stats,
  });
  return stats;
}

/**
 * Sensitive or low-confidence items always go to a human. This is deliberately
 * conservative — err toward human review.
 */
function shouldRouteToApproval(level: RiskLevel, confidence: number): boolean {
  const sensitive =
    level === RiskLevel.High || level === RiskLevel.Critical;
  return sensitive || confidence < AUTO_ACTION_MIN_CONFIDENCE;
}

function isAutoEligible(confidence: number): boolean {
  return confidence >= AUTO_ACTION_MIN_CONFIDENCE;
}

/** Placeholder: enumerate accounts to sync. Real version queries the DB. */
export async function loadActiveAccounts(): Promise<ConnectorAccount[]> {
  // TODO(persist): SELECT connected accounts WHERE status = active
  // Returns empty until real accounts are connected via official OAuth.
  void Platform; // keep import meaningful for future use
  return [];
}
