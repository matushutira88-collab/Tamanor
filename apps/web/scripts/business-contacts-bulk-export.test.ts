/**
 * BUSINESS-CRM-V2 (Phase B) — targeted tests for bulk contact workflow and secure CSV export.
 *
 * Pure unit tests over the exported domain helpers and the shared CSV serializer, plus source invariants over
 * the repository, server actions, export route and UI. NO database and NO network: the Postgres-backed suites
 * need the repository's isolated local test database, which is unavailable here and is reported as not run
 * rather than repointed.
 */
import { readFileSync } from "node:fs";
import {
  normalizeBulkContactIds, summarizeBulkContacts, contactExportRow, contactExportFilename,
  csvEscapeField, toCsv,
  MAX_BULK_CONTACT_IDS, CONTACT_EXPORT_MAX_ROWS, CONTACT_EXPORT_COLUMNS,
  BusinessContactStatus, BusinessContactSource, Permission, Role, can,
} from "@guardora/core";
import { businessDict } from "../src/app/dashboard/business-i18n";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
const id = (n: number) => `c${String(n).padStart(24, "0")}`;

console.log("\n1) bulk selection normalization");
{
  check("1a) empty selection is rejected", (() => {
    const r = normalizeBulkContactIds([]); return !r.ok && r.reason === "empty";
  })());
  check("1b) null / non-array is rejected", !normalizeBulkContactIds(null).ok && !normalizeBulkContactIds(undefined).ok);
  check("1c) a valid selection is accepted", (() => {
    const r = normalizeBulkContactIds([id(1), id(2)]);
    return r.ok && r.ids.length === 2 && r.duplicatesDropped === 0;
  })());
  check("1d) duplicates are dropped deterministically, first-seen order preserved", (() => {
    const r = normalizeBulkContactIds([id(2), id(1), id(2), id(1)]);
    return r.ok && r.ids.join(",") === `${id(2)},${id(1)}` && r.duplicatesDropped === 2;
  })());
  check("1e) exactly the maximum is accepted", (() => {
    const r = normalizeBulkContactIds(Array.from({ length: MAX_BULK_CONTACT_IDS }, (_, i) => id(i)));
    return r.ok && r.ids.length === MAX_BULK_CONTACT_IDS;
  })());
  check("1f) one over the maximum is rejected", (() => {
    const r = normalizeBulkContactIds(Array.from({ length: MAX_BULK_CONTACT_IDS + 1 }, (_, i) => id(i)));
    return !r.ok && r.reason === "too_many";
  })());
  check("1g) de-duplication happens BEFORE the cap (repeats cannot consume the budget)", (() => {
    const r = normalizeBulkContactIds(Array.from({ length: 300 }, () => id(1)));
    return r.ok && r.ids.length === 1;
  })());
  check("1h) a malformed id rejects the request rather than being silently dropped", (() => {
    const cases = [["  "], ["../../etc/passwd"], ["<script>"], ["short"], ["A".repeat(30)], [id(1), "not-an-id"]];
    return cases.every((c) => { const r = normalizeBulkContactIds(c); return !r.ok && (r.reason === "invalid" || r.reason === "empty"); });
  })());
  check("1i) the maximum is 100", MAX_BULK_CONTACT_IDS === 100);
  check("1j) the bounded summary exposes counts only", (() => {
    const s = summarizeBulkContacts({ changed: [id(1), id(2)], failed: [{ id: id(3), reason: "not_found" }] });
    return s.affected === 2 && s.failed === 1 && Object.keys(s).sort().join(",") === "affected,failed"
      && !JSON.stringify(s).includes(id(1));
  })());
}

console.log("\n2) permissions — export is NOT read");
{
  check("2a) Owner and Admin may export", can(Role.Owner, Permission.BusinessContactsExport) && can(Role.Admin, Permission.BusinessContactsExport));
  check("2b) Analyst can READ contacts but NOT export",
    can(Role.Analyst, Permission.BusinessContactsRead) && !can(Role.Analyst, Permission.BusinessContactsExport));
  check("2c) Analyst cannot perform bulk changes either", !can(Role.Analyst, Permission.BusinessContactsManage));
  check("2d) Viewer has none of the three",
    !can(Role.Viewer, Permission.BusinessContactsRead) && !can(Role.Viewer, Permission.BusinessContactsExport) && !can(Role.Viewer, Permission.BusinessContactsManage));
  check("2e) read access is never silently equated with export access",
    can(Role.Analyst, Permission.BusinessContactsRead) !== can(Role.Analyst, Permission.BusinessContactsExport));
}

console.log("\n3) CSV column contract");
{
  check("3a) stable, documented column order",
    CONTACT_EXPORT_COLUMNS.join(",") === "full_name,email,phone,company,source,campaign_name,form_name,received_at,status,assigned_to,latest_activity_at",
    CONTACT_EXPORT_COLUMNS.join(","));
  const row = contactExportRow({
    fullName: "Jane Doe", email: "jane@lead.test", phone: "+421900111222", company: "Acme",
    sourcePlatform: BusinessContactSource.Facebook, campaignName: "Spring", formName: "Contact",
    receivedAt: new Date("2026-06-01T10:00:00Z"), status: BusinessContactStatus.New,
    assignedTo: "member@tenant.test", latestActivityAt: new Date("2026-06-02T11:30:00Z"),
  });
  check("3b) row length matches the column count", row.length === CONTACT_EXPORT_COLUMNS.length);
  check("3c) dates are locale-neutral ISO 8601 UTC",
    row[7] === "2026-06-01T10:00:00.000Z" && row[10] === "2026-06-02T11:30:00.000Z");
  check("3d) empty values become empty strings, never 'null'", (() => {
    const r = contactExportRow({
      fullName: null, email: null, phone: null, company: null, sourcePlatform: BusinessContactSource.WebForm,
      campaignName: null, formName: null, receivedAt: new Date(0), status: BusinessContactStatus.New,
      assignedTo: null, latestActivityAt: new Date(0),
    });
    return !r.includes("null") && r[0] === "" && r[9] === "";
  })());
  check("3e) assignee is a member display value, never a raw user id", row[9] === "member@tenant.test");
}

console.log("\n4) CSV safety — quoting, formula injection, UTF-8");
{
  check("4a) a leading = is neutralized", csvEscapeField("=1+1").startsWith("'="));
  check("4b) a leading + is neutralized", csvEscapeField("+1").startsWith("'+"));
  check("4c) a leading - is neutralized", csvEscapeField("-1").startsWith("'-"));
  check("4d) a leading @ is neutralized", csvEscapeField("@SUM(A1)").startsWith("'@"));
  check("4e) a leading tab is neutralized", csvEscapeField("\tx").startsWith("'"));
  // A CR-prefixed value is neutralized with the apostrophe AND then RFC-4180 quoted (it contains CR), so the
  // guard sits inside the quotes rather than at position 0.
  check("4f) a leading carriage return is neutralized", csvEscapeField("\rx") === '"\'\rx"');
  check("4g) the classic DDE payload is neutralized",
    csvEscapeField('=cmd|\' /C calc\'!A0').startsWith("'="));
  check("4h) commas are quoted", csvEscapeField("Doe, Jane") === '"Doe, Jane"');
  check("4i) embedded quotes are doubled and wrapped", csvEscapeField('say "hi"') === '"say ""hi"""');
  check("4j) line breaks are quoted", csvEscapeField("a\nb") === '"a\nb"' && csvEscapeField("a\r\nb").includes('"'));
  check("4k) a safe value is untouched", csvEscapeField("Jane Doe") === "Jane Doe");
  check("4l) non-ASCII survives unchanged (UTF-8)", csvEscapeField("Zuzana Šťastná") === "Zuzana Šťastná");
  check("4m) toCsv emits the header then rows with CRLF endings", (() => {
    const doc = toCsv(["a", "b"], [["1", "2"]]);
    return doc === "a,b\r\n1,2\r\n";
  })());
  check("4n) every exported field passes through the same guard", (() => {
    const doc = toCsv(CONTACT_EXPORT_COLUMNS, [contactExportRow({
      fullName: "=HYPERLINK(1)", email: "+evil@x.test", phone: "-1", company: "@cmd",
      sourcePlatform: BusinessContactSource.Facebook, campaignName: "a,b", formName: 'q"q',
      receivedAt: new Date(0), status: BusinessContactStatus.New, assignedTo: "\tx", latestActivityAt: new Date(0),
    })]);
    return doc.includes("'=HYPERLINK(1)") && doc.includes("'+evil@x.test") && doc.includes("'-1")
      && doc.includes("'@cmd") && doc.includes('"a,b"') && doc.includes('"q""q"');
  })());
  check("4o) sanitization is export-only — the source value is not mutated", (() => {
    const src = { fullName: "=1+1", email: null, phone: null, company: null,
      sourcePlatform: BusinessContactSource.Facebook, campaignName: null, formName: null,
      receivedAt: new Date(0), status: BusinessContactStatus.New, assignedTo: null, latestActivityAt: new Date(0) };
    contactExportRow(src);
    return src.fullName === "=1+1";
  })());
}

console.log("\n5) export filename and bounds");
{
  const name = contactExportFilename(new Date("2026-08-03T12:34:56Z"));
  check("5a) generic, dated filename", name === "tamanor-contacts-2026-08-03.csv");
  check("5b) the filename carries no tenant, filter, search text or PII",
    !/@|jane|acme|tenant|status|source/i.test(name));
  check("5c) the export bound is 10,000 rows", CONTACT_EXPORT_MAX_ROWS === 10_000);
}

console.log("\n6) repository: tenant isolation, bounds, no N+1");
{
  const repo = read("packages/db/src/business-contacts-repo.ts");
  check("6a) bulk status runs inside a tenant transaction (RLS)",
    /export async function bulkSetBusinessContactStatus[\s\S]*?withTenant\(tenantId/.test(repo));
  check("6b) bulk assign runs inside a tenant transaction (RLS)",
    /export async function bulkAssignBusinessContacts[\s\S]*?withTenant\(tenantId/.test(repo));
  check("6c) the existing transition rule is applied per contact, not bypassed",
    /canTransitionContactStatus\(from, to\)/.test(repo));
  check("6d) a foreign / unknown id is uniformly not_found (existence never leaks)",
    /if \(from === undefined\) \{ failed\.push\(\{ id, reason: "not_found" \}\)/.test(repo));
  check("6e) the assignee is validated against THIS tenant's memberships before mutation",
    /membership\.findFirst\(\{ where: \{ userId: assigneeUserId, tenantId \}/.test(repo));
  check("6f) both bulk paths are capped server-side too", (repo.match(/slice\(0, MAX_BULK_CONTACT_IDS\)/g) ?? []).length === 2);
  check("6g) per-contact audit rows are written in the SAME transaction (timeline accuracy)",
    /writeContactAudits\(db, tenantId, actorUserId, toWrite, CONTACT_STATUS_AUDIT_EVENT/.test(repo)
    && /writeContactAudits\(db, tenantId, actorUserId, changed, CONTACT_ASSIGNMENT_AUDIT_EVENT/.test(repo));
  check("6h) per-contact audit metadata is the same PII-free shape as the single-contact actions",
    /CONTACT_STATUS_AUDIT_EVENT, \{ to \}/.test(repo) && /CONTACT_ASSIGNMENT_AUDIT_EVENT, \{ assigned: assigneeUserId !== null \}/.test(repo));
  check("6i) export is tenant-scoped and bounded",
    /export async function exportBusinessContacts[\s\S]*?withTenant\(tenantId/.test(repo)
    && /Math\.min\(limit, CONTACT_EXPORT_MAX_ROWS\)/.test(repo) && /take: take \+ 1/.test(repo));
  check("6j) export ordering is deterministic", /orderBy: \[\{ receivedAt: "desc" \}, \{ id: "desc" \}\], take: take \+ 1/.test(repo));
  check("6k) export honours search + status + source", (() => {
    const fn = repo.slice(repo.indexOf("export async function exportBusinessContacts"));
    return /filters\.status/.test(fn) && /filters\.sourcePlatform/.test(fn) && /searchWhere\(filters\.search\)/.test(fn);
  })());
  check("6l) no N+1: members read once, notes aggregated once", (() => {
    const fn = repo.slice(repo.indexOf("export async function exportBusinessContacts"));
    return (fn.match(/membership\.findMany/g) ?? []).length === 1
      && (fn.match(/businessContactNote\.groupBy/g) ?? []).length === 1
      && !/businessContactNote\.findMany/.test(fn);
  })());
  check("6m) export selects no internal/provider identifier beyond the id needed for the note join", (() => {
    const sel = repo.slice(repo.indexOf("export async function exportBusinessContacts"));
    const block = sel.slice(sel.indexOf("select: {"), sel.indexOf("});", sel.indexOf("select: {")));
    return !/externalLeadId|dedupeKey|connectionId|campaignId|adId|formId|consentReference|consentVersion/.test(block);
  })());
  check("6n) note BODIES are never read by the export", (() => {
    const fn = repo.slice(repo.indexOf("export async function exportBusinessContacts"));
    return !/body: true/.test(fn);
  })());
}

console.log("\n7) server actions: gates, bounded results, PII-free audit");
{
  const a = read("apps/web/src/app/dashboard/contacts/actions.ts");
  const bulk = a.slice(a.indexOf("export async function bulkChangeStatusAction"));
  check("7a) both bulk actions go through the manage gate",
    /bulkChangeStatusAction[\s\S]*?await manageGate\(\)/.test(a) && /bulkAssignAction[\s\S]*?await manageGate\(\)/.test(a));
  check("7b) both enforce same-origin", (bulk.match(/isSameOrigin\(\)/g) ?? []).length === 2);
  check("7c) both are rate limited per tenant", (bulk.match(/businessBulkLimiter\.check\(session\.tenantId\)/g) ?? []).length === 2);
  check("7d) the browser submits only ids + a bounded operation value",
    /fd\.getAll\("contactIds"\)/.test(a) && /fd\.get\("status"\)/.test(a) && /fd\.get\("assigneeUserId"\)/.test(a)
    && !/fd\.get\("tenantId"\)/.test(a) && !/fd\.get\("actor/.test(a));
  check("7e) tenant and actor come only from the session",
    /bulkSetBusinessContactStatus\(session\.tenantId, selection\.ids, to as BusinessContactStatus, session\.userId\)/.test(a)
    && /bulkAssignBusinessContacts\(session\.tenantId, selection\.ids, assignee, session\.userId\)/.test(a));
  check("7f) an invalid status is rejected before any mutation",
    bulk.indexOf("isValidContactStatus(to)") < bulk.indexOf("bulkSetBusinessContactStatus"));
  check("7g) an invalid assignee is reported without exposing the id", /e=bulk_assignee/.test(bulk) && !/assignee\}\`/.test(bulk));
  check("7h) the BULK audit carries counts only — no ids, names, emails or note bodies",
    /metadata: \{ operation: "status", to, affected: summary\.affected, failed: summary\.failed \}/.test(bulk)
    && /metadata: \{ operation: "assign", assigned: assignee !== null, affected: summary\.affected, failed: summary\.failed \}/.test(bulk)
    && !/metadata:[^}]*(ids|contactIds|email|name|phone)/.test(bulk));
  check("7i) redirects carry bounded counts only, never ids",
    /bulk=status&n=\$\{summary\.affected\}&f=\$\{summary\.failed\}/.test(bulk) && !/contactIds/.test(bulk.split("redirect(")[1] ?? ""));
  check("7j) selection errors are bounded codes, never echoed input",
    /e=bulk_too_many/.test(a) && /e=bulk_invalid/.test(a) && /e=bulk_empty/.test(a));
}

console.log("\n8) export route: method, gates, audit");
{
  const r = read("apps/web/src/app/api/dashboard/contacts/export/route.ts");
  check("8a) POST only — no GET handler exists", /export async function POST/.test(r) && !/export async function GET/.test(r));
  check("8b) filters travel in the request body, never a query string", /req\.formData\(\)/.test(r) && !/nextUrl\.searchParams/.test(r));
  check("8c) the Business entitlement gate is enforced", /requireDashboardCapability\("businessConnectedPlatforms"\)/.test(r));
  check("8d) the dedicated export permission is required", /Permission\.BusinessContactsExport/.test(r));
  check("8e) read permission alone is NOT accepted", !/Permission\.BusinessContactsRead/.test(r));
  check("8f) same-origin is enforced", /isSameOrigin\(\)/.test(r));
  check("8g) the export is rate limited per tenant", /businessExportLimiter\.check\(session\.tenantId\)/.test(r));
  check("8h) tenant comes only from the session", /exportBusinessContacts\(session\.tenantId/.test(r));
  // Compare against the CALL SITE, not the import at the top of the file.
  check("8i) malformed input is rejected before any database read",
    r.indexOf('error: "bad_request"') < r.indexOf("await exportBusinessContacts("));
  check("8j) the CSV is generated server-side with the shared injection-safe serializer", /toCsv\(CONTACT_EXPORT_COLUMNS/.test(r));
  check("8k) a UTF-8 BOM is emitted for spreadsheet compatibility", /UTF8_BOM \+ toCsv/.test(r));
  check("8l) the audit metadata is exactly the allowed PII-free set",
    /format: "csv"/.test(r) && /rows: result\.rows\.length/.test(r) && /filtersPresent: Boolean/.test(r) && /limited: result\.limited/.test(r));
  check("8m) the audit metadata is EXACTLY the allow-listed PII-free shape", (() => {
    // Pin the whole block rather than grepping: `filters.search` legitimately appears inside Boolean(...) — a
    // coercion that emits true/false, never the term. Pinning the shape also catches any future addition.
    const meta = r.slice(r.indexOf("metadata: {", r.indexOf("writeAudit(")));
    const block = meta.slice(0, meta.indexOf("},") + 2).replace(/\s+/g, " ");
    const expected = 'metadata: { format: "csv", rows: result.rows.length, '
      + 'filtersPresent: Boolean(filters.status || filters.sourcePlatform || filters.search), '
      + 'limited: result.limited, },';
    return block === expected;
  })());
  check("8m2) every filter reference in the audit is a boolean coercion, never a value", (() => {
    const meta = r.slice(r.indexOf("metadata: {", r.indexOf("writeAudit(")));
    const block = meta.slice(0, meta.indexOf("},") + 2);
    // Any mention of a filter must sit inside Boolean(...); no bare `search:`/`q:` key may exist.
    const bareFilter = /(^|[^(])\b(filters\.search|filters\.status|filters\.sourcePlatform)\b/.test(
      block.replace(/Boolean\([^)]*\)/g, "Boolean(...)"));
    return !bareFilter && !/\b(search|q|term|csv_content|body)\s*:/.test(block);
  })());
  check("8n) the ops event carries only operation + a bounded result", /operation: "contacts_export", result: result\.limited \? "limited" : "complete"/.test(r));
  check("8o) the filename is the generic dated one", /contactExportFilename\(new Date\(\)\)/.test(r));
  check("8p) the response is never cached", /"Cache-Control": "no-store"/.test(r));
  check("8q) auditing failure cannot break the download", /writeAudit\([\s\S]{0,400}\}\)\.catch\(/.test(r));
}

console.log("\n9) UI: selection scope, clearing, permission gating, pagination");
{
  const page = read("apps/web/src/app/dashboard/contacts/page.tsx");
  const table = read("apps/web/src/components/dashboard/contacts-bulk-table.tsx");
  check("9a) only the CURRENT page's ids reach the browser component", /pageIds=\{page\.items\.map\(\(c\) => c\.id\)\}/.test(page));
  check("9b) selection clears when search, filters or the page change (remount key)",
    /const selectionKey = `\$\{sp\.q \?\? ""\}\|\$\{sp\.status \?\? ""\}\|\$\{sp\.source \?\? ""\}\|\$\{sp\.cursor \?\? ""\}`/.test(page)
    && /key=\{selectionKey\}/.test(page));
  check("9c) selection state is never written to the URL",
    !/contactIds/.test(page) && !/searchParams\.set\("selected"/.test(page));
  check("9d) selected ids are submitted as hidden fields, not a query string", /type="hidden" name="contactIds"/.test(table));
  check("9e) select-all applies to the rendered page only, never all matches",
    /new Set\(pageIds\)/.test(table) && !/selectAllMatching|acrossPages/.test(table));
  check("9f) bulk controls render only for a manager", /canManage && selectedIds\.length > 0/.test(table));
  check("9g) the export button renders only with the export permission", /\{canExport \? \(/.test(page));
  check("9h) checkboxes are labelled for assistive tech", (table.match(/aria-label=\{labels\.select/g) ?? []).length === 2);
  check("9i) no drag-and-drop or Kanban", !/draggable|onDragStart|kanban/i.test(table) && !/draggable|kanban/i.test(page));
  check("9j) cursor pagination is unchanged", /cursor=\$\{encodeURIComponent\(page\.nextCursor\)\}/.test(page));
  check("9k) the export form posts the CURRENT filters", (() => {
    const f = page.slice(page.indexOf('action="/api/dashboard/contacts/export"'));
    return /name="q"/.test(f) && /name="status"/.test(f) && /name="source"/.test(f) && /method="post"/.test(page);
  })());
  check("9l) the limited-export notice is shown when the result set exceeds the bound",
    /counts\.total > CONTACT_EXPORT_MAX_ROWS/.test(page) && /exportLimited\(CONTACT_EXPORT_MAX_ROWS\)/.test(page));
  check("9m) redirect counts are bounded before rendering", /boundedCount = \(raw: string \| undefined\)/.test(page));
  check("9n) the list page stays a server component (no full dataset hydration)", !/"use client"/.test(page));
}

console.log("\n10) SK/EN/DE parity for the new copy");
{
  const dicts = { en: businessDict("en"), sk: businessDict("sk"), de: businessDict("de") };
  const strings = [
    "selectRow", "selectPage", "clearSelection", "bulkStatus", "bulkAssign", "bulkUnassign", "apply",
    "exportCsv", "bulkNoneSelected", "bulkTooMany", "bulkInvalid", "bulkAssigneeInvalid",
    "bulkDenied", "bulkFailedGeneric", "rateLimited",
  ] as const;
  const fns = ["selectedCount", "exportLimited", "bulkAffected", "bulkFailed"] as const;
  for (const loc of ["en", "sk", "de"] as const) {
    const c = dicts[loc].contacts as unknown as Record<string, unknown>;
    check(`10a) ${loc}: every new string key is non-empty`,
      strings.every((k) => typeof c[k] === "string" && (c[k] as string).trim().length > 0),
      strings.filter((k) => !c[k]).join(","));
    check(`10b) ${loc}: every new formatter is a function producing non-empty text`,
      fns.every((k) => typeof c[k] === "function" && String((c[k] as (n: number) => string)(3)).trim().length > 0));
  }
  check("10c) the three locales are genuinely distinct",
    dicts.en.contacts.exportCsv !== dicts.sk.contacts.exportCsv && dicts.en.contacts.exportCsv !== dicts.de.contacts.exportCsv
    && dicts.sk.contacts.exportCsv !== dicts.de.contacts.exportCsv);
  check("10d) formatters interpolate the count", dicts.en.contacts.selectedCount(7).includes("7") && dicts.sk.contacts.bulkAffected(4).includes("4"));
  check("10e) no user-facing English is hard-coded in the shared pages", (() => {
    const page = read("apps/web/src/app/dashboard/contacts/page.tsx");
    return !/>Export CSV</.test(page) && !/>Apply</.test(page) && !/>Clear selection</.test(page);
  })());
}

console.log("\n11) no PII, ids, tokens or provider identifiers leak");
{
  const surfaces = [
    "apps/web/src/app/dashboard/contacts/actions.ts",
    "apps/web/src/app/api/dashboard/contacts/export/route.ts",
    "apps/web/src/components/dashboard/contacts-bulk-table.tsx",
  ];
  for (const f of surfaces) {
    const src = read(f);
    check(`11a) ${f.split("/").pop()}: no token/provider identifier is read or rendered`,
      // Word-bounded: `pageIds` here is "ids of the contacts on this page", not a Meta Page id.
      !/\baccessToken\b|\blongLivedToken\b|appsecret|\bexternalLeadId\b|\bdedupeKey\b|\bpageId\b/.test(src));
  }
  check("11b) the export never emits notes or internal ids as columns",
    !CONTACT_EXPORT_COLUMNS.some((c) => /note|contact_id|tenant|external|dedupe|consent_reference|provider/i.test(c)));
  check("11c) the bulk summary shape cannot carry an id",
    JSON.stringify(summarizeBulkContacts({ changed: [id(9)], failed: [] })) === '{"affected":1,"failed":0}');
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts bulk + export (Phase B): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
