import { type NextRequest, NextResponse } from "next/server";
import { Permission, can, toCsv, emitOpsEvent } from "@guardora/core";
import { getTenantEntitlements, buildExportTable, EXPORT_DATASETS, type ExportDataset } from "@guardora/db";
import { requireSession } from "@/server/auth";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V1.69 (Release B / B3) — tenant-scoped CSV export. Auth (session) → ReportView permission → `export`
 * entitlement (paid) → dataset-specific capability (incidents needs the `incidents` feature) → bounded,
 * RLS-scoped query → injection-safe CSV → audited download. A tenant can only ever export its OWN rows
 * (withTenant/RLS in the repo, tenantId from the session — never from the query string).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session.role, Permission.ReportView)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const dataset = sp.get("dataset") as ExportDataset | null;
  if (!dataset || !EXPORT_DATASETS.includes(dataset)) {
    return NextResponse.json({ error: "bad_dataset" }, { status: 400 });
  }

  // Entitlement gate — CSV export is a PAID feature; incidents additionally require the incidents feature.
  const ent = await getTenantEntitlements(session.tenantId);
  if (!ent.export) return NextResponse.json({ error: "export_not_in_plan" }, { status: 402 });
  if (dataset === "incidents" && !ent.incidents) return NextResponse.json({ error: "incidents_not_in_plan" }, { status: 402 });

  const parseDate = (v: string | null): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = parseDate(sp.get("from"));
  const to = parseDate(sp.get("to"));

  const table = await buildExportTable(session.tenantId, dataset, { from, to, plan: ent.plan });
  const csv = toCsv(table.headers, table.rows);

  await writeAudit({
    session, event: "report.exported", targetType: "export", targetId: dataset,
    metadata: { dataset, rows: table.rows.length, truncated: table.truncated, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
  }).catch(() => {});
  emitOpsEvent("report.exported", { operation: dataset });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="guardora-${dataset}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
