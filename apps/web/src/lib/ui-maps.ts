import {
  ConnectorStatus,
  DecisionStatus,
  Priority,
  ReputationStatus,
  RiskLevel,
} from "@guardora/core";

/** Badge tone per risk level. */
export const RISK_TONE: Record<RiskLevel, string> = {
  [RiskLevel.None]: "neutral",
  [RiskLevel.Low]: "brand",
  [RiskLevel.Medium]: "warn",
  [RiskLevel.High]: "danger",
  [RiskLevel.Critical]: "danger",
};

export const STATUS_TONE: Record<ReputationStatus, string> = {
  [ReputationStatus.New]: "brand",
  [ReputationStatus.Classified]: "neutral",
  [ReputationStatus.NeedsApproval]: "warn",
  [ReputationStatus.Actioned]: "ok",
  [ReputationStatus.Escalated]: "danger",
  [ReputationStatus.Ignored]: "neutral",
  [ReputationStatus.Resolved]: "ok",
};

export const PRIORITY_TONE: Record<Priority, string> = {
  [Priority.Low]: "neutral",
  [Priority.Normal]: "brand",
  [Priority.High]: "warn",
  [Priority.Urgent]: "danger",
};

export const DECISION_TONE: Record<DecisionStatus, string> = {
  [DecisionStatus.Proposed]: "warn",
  [DecisionStatus.Approved]: "brand",
  [DecisionStatus.Rejected]: "neutral",
  [DecisionStatus.Executed]: "ok",
  [DecisionStatus.Failed]: "danger",
  [DecisionStatus.Cancelled]: "neutral",
};

export const CONNECTOR_TONE: Record<ConnectorStatus, string> = {
  [ConnectorStatus.Pending]: "warn",
  [ConnectorStatus.Active]: "ok",
  [ConnectorStatus.MockConnected]: "brand",
  [ConnectorStatus.Expired]: "warn",
  [ConnectorStatus.Disconnected]: "neutral",
  [ConnectorStatus.Error]: "danger",
};
