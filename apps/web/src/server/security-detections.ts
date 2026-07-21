import "server-only";
import { listAtoDetections } from "@guardora/db";
import { SecurityDetectionStatus } from "@guardora/core";

/**
 * S2 — read model for the "Potential Account Takeover" section. Tenant-scoped through the repo's
 * `withTenant` (RLS). Foundation: no detector generates rows yet, so this returns an empty list in practice
 * — the UI renders the honest "No detections" state.
 */
export interface AtoDetectionListItem {
  id: string;
  kind: string;
  severity: string;
  confidence: number | null;
  status: string;
  source: string | null;
  subjectType: string;
  detectedAt: Date;
}

export interface AtoDetectionList {
  items: AtoDetectionListItem[];
  openCount: number;
}

export async function loadAtoDetections(tenantId: string): Promise<AtoDetectionList> {
  const rows = await listAtoDetections(tenantId, { limit: 100 });
  const items: AtoDetectionListItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    confidence: r.confidence,
    status: r.status,
    source: r.source,
    subjectType: r.subjectType,
    detectedAt: r.detectedAt,
  }));
  const openCount = items.filter((i) => i.status === SecurityDetectionStatus.Open).length;
  return { items, openCount };
}
