/**
 * V1.46/47 — the ops-event abstraction now lives in @guardora/core/observability so the web app AND
 * the worker share ONE vendor-neutral implementation (bounded event catalog, secret redaction, sink).
 * This module is a thin re-export for existing web call sites.
 */
export {
  emitOpsEvent,
  setOpsSink,
  resetOpsSink,
  redact,
  newCorrelationId,
  validateCorrelationId,
  resolveCorrelationId,
  metrics,
  MetricsRegistry,
  type OpsEvent,
  type OpsSink,
} from "@guardora/core";
