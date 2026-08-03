/**
 * BUSINESS-CRM-V2 (Phase B) — tenant-scoped CSV export of business contacts.
 *
 * POST, deliberately. A GET would place the user's search text — which can itself be an e-mail, phone or name —
 * into the request path, and request paths are recorded verbatim in platform access logs. Filters therefore
 * travel in the request BODY, which is never logged, and the same-origin check plus the POST method give
 * cross-origin credential abuse no useful shape. No contact id ever appears in a query string, and the route
 * mutates nothing.
 *
 * Gates, in order: authenticated session → Business entitlement → BusinessContactsExport (NOT merely
 * BusinessContactsRead — bulk PII egress is a distinct act) → same-origin → per-tenant rate limit.
 *
 * The tenant comes only from the session, the read runs under RLS, and the CSV is generated server-side with
 * the existing injection-safe serializer. The audit entry records counts and booleans only.
 */
import { type NextRequest, NextResponse } from "next/server";
import {
  can, Permission, toCsv, isValidContactStatus, normalizeContactSearch, contactExportRow,
  contactExportFilename, CONTACT_EXPORT_COLUMNS, CONTACT_EXPORT_MAX_ROWS,
  BusinessContactStatus, BusinessContactSource, emitOpsEvent,
  BusinessContactLifecycle, isValidContactLifecycle, contactTombstoneExportRow,
} from "@guardora/core";
import { exportBusinessContacts } from "@guardora/db";
import { requireDashboardCapability } from "@/server/route-guard";
import { writeAudit } from "@/server/audit";
import { isSameOrigin } from "@/server/csrf";
import { businessExportLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Excel needs a UTF-8 BOM to read non-ASCII (e.g. Slovak/German names) correctly. */
const UTF8_BOM = "﻿";

const ALL_SOURCES: string[] = Object.values(BusinessContactSource);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cap = await requireDashboardCapability("businessConnectedPlatforms");
  if (!cap.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = cap.session;
  // Export is its OWN permission. Read access alone never grants bulk egress.
  if (!can(session.role, Permission.BusinessContactsExport)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await isSameOrigin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await businessExportLimiter.check(session.tenantId)).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Bounded body: filters only. Malformed input is rejected before any database read.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const rawStatus = String(form.get("status") ?? "");
  const rawLifecycle = String(form.get("life") ?? "");
  const rawSource = String(form.get("source") ?? "");
  const filters = {
    status: isValidContactStatus(rawStatus) ? (rawStatus as BusinessContactStatus) : undefined,
    sourcePlatform: ALL_SOURCES.includes(rawSource) ? (rawSource as BusinessContactSource) : undefined,
    search: normalizeContactSearch(String(form.get("q") ?? "")) ?? undefined,
    // Phase C — the export honours the SAME lifecycle view as the list. Omitted means active only: archived,
    // spam and anonymized contacts are never in a default export.
    lifecycle: isValidContactLifecycle(rawLifecycle) ? (rawLifecycle as BusinessContactLifecycle) : undefined,
  };

  const result = await exportBusinessContacts(session.tenantId, filters, CONTACT_EXPORT_MAX_ROWS);
  // One uniform pass: `toCsv` RFC-4180-quotes every field AND neutralizes formula triggers (= + - @ tab CR).
  // An anonymized contact exports as a GENERIC TOMBSTONE row — no personal value and no provider/campaign
  // identifier — so even an explicit anonymized export cannot re-identify or re-link anyone.
  const csv = UTF8_BOM + toCsv(
    CONTACT_EXPORT_COLUMNS,
    result.rows.map((r) => r.lifecycleState === BusinessContactLifecycle.Anonymized
      ? contactTombstoneExportRow(r.receivedAt, r.latestActivityAt)
      : contactExportRow(r)),
  );

  // PII-FREE audit: counts and booleans only — never the search text, a filter value, an id or CSV content.
  await writeAudit({
    session, event: "business_contact.exported", targetType: "business_contact_export",
    metadata: {
      format: "csv",
      rows: result.rows.length,
      filtersPresent: Boolean(filters.status || filters.sourcePlatform || filters.search),
      limited: result.limited,
    },
  }).catch(() => { /* the download must not fail because auditing did */ });
  emitOpsEvent("business.contacts_exported", { operation: "contacts_export", result: result.limited ? "limited" : "complete" });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Generic filename — no tenant name, no filter, no PII.
      "Content-Disposition": `attachment; filename="${contactExportFilename(new Date())}"`,
      "Cache-Control": "no-store",
      // The response body is the user's own tenant data; never let a shared cache or embedder near it.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
