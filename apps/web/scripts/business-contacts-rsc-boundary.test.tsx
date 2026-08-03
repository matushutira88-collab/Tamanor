/**
 * BUSINESS-CRM-V2 — REGRESSION GUARD for the /dashboard/contacts RSC boundary.
 *
 * WHY THIS EXISTS: Phase B shipped `renderRow` (a render callback) and `labels.selectedCount` (a label
 * formatter) as props of the `"use client"` <ContactsBulkTable/>. Both are ordinary functions, React
 * cannot serialize an ordinary function into the RSC payload, and the route died at render time with
 * `Functions cannot be passed directly to Client Components` (digests 1649972383 / 2917134719).
 * Pure unit tests and `next build` never caught it — neither one serializes props across the boundary.
 *
 * WHAT IS PROVEN HERE — three independent layers, plus an honest statement of the limit:
 *   A) RUNTIME: a deep walker over the ACTUAL prop values the page builds (real dictionaries, real row
 *      objects, real React elements) rejects any function that is not a Server Action. A negative
 *      control proves the walker fails on the exact props that shipped, so this test cannot rot silently.
 *   B) RENDER: the real client component is rendered with react-dom/server — row ids stay paired with
 *      their own cells, reader and manager modes both render, no row markup is duplicated.
 *   C) PURE: the selection helpers the checkboxes call are asserted directly, so "current page only"
 *      is provable without a browser.
 *
 * LIMITATION, STATED PLAINLY: this suite does NOT run Next.js's own RSC serializer —
 * `react-server-dom-webpack` is not a resolvable dependency of this repo (Next vendors it internally),
 * so it cannot be imported from a standalone tsx script. Layer A reimplements React's rule
 * (function ⇒ illegal unless it carries the server-reference marker) rather than calling React's
 * encoder. It is the strongest deterministic check available in this stack, not a literal payload encode.
 *
 * Run: pnpm business-contacts-rsc-boundary:test
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContactsBulkTable, SELECTED_COUNT_PLACEHOLDER, formatSelectedCount,
  nextPageSelection, selectedOnPage,
  type ContactsBulkLabels, type ContactsBulkRow,
} from "../src/components/dashboard/contacts-bulk-table";
import { businessDict } from "../src/app/dashboard/business-i18n";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
/** Source with comments removed — assertions about CODE must not match explanatory prose. */
const readCode = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TABLE = "apps/web/src/components/dashboard/contacts-bulk-table.tsx";
const PAGE = "apps/web/src/app/dashboard/contacts/page.tsx";
const LOCALES = ["en", "sk", "de"] as const;

// ============================================================================================
// The rule React enforces at the boundary, reimplemented.
// ============================================================================================
const SERVER_REFERENCE = Symbol.for("react.server.reference");
const ELEMENT_TYPES = new Set<symbol>([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
]);

/** Every function reachable from `value` that React would refuse to serialize, as `path: name`. */
function illegalFunctions(value: unknown, path = "props", out: string[] = [], seen = new Set<object>()): string[] {
  if (typeof value === "function") {
    // A Server Action is legal: React replaces it with its reference id instead of serializing the body.
    if ((value as { $$typeof?: symbol }).$$typeof !== SERVER_REFERENCE) {
      out.push(`${path}: function ${(value as { name?: string }).name || "anonymous"}`);
    }
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  if (value instanceof Date) return out;           // Dates ARE serializable by the RSC encoder.
  if (seen.has(value as object)) return out;
  seen.add(value as object);

  if (Array.isArray(value)) {
    value.forEach((v, i) => illegalFunctions(v, `${path}[${i}]`, out, seen));
    return out;
  }
  const el = value as { $$typeof?: symbol; props?: unknown };
  if (typeof el.$$typeof === "symbol" && ELEMENT_TYPES.has(el.$$typeof)) {
    // `type` is a component/host reference the encoder resolves itself; only the PROPS must serialize.
    illegalFunctions(el.props, `${path}.props`, out, seen);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    illegalFunctions(v, `${path}.${k}`, out, seen);
  }
  return out;
}

/** Stand-in for a real Server Action: an ordinary function carrying React's server-reference marker. */
const serverAction = Object.assign((_fd: FormData) => {}, { $$typeof: SERVER_REFERENCE, $$id: "test#bulkAction" });

// ============================================================================================
// Fixtures — shaped exactly like what page.tsx hands the component.
// ============================================================================================
const labelsFor = (loc: (typeof LOCALES)[number]): ContactsBulkLabels => {
  const t = businessDict(loc);
  return {
    selectRow: t.contacts.selectRow, selectPage: t.contacts.selectPage,
    selectedCountTemplate: t.contacts.selectedCountTemplate, clearSelection: t.contacts.clearSelection,
    bulkStatus: t.contacts.bulkStatus, bulkAssign: t.contacts.bulkAssign,
    bulkUnassign: t.contacts.bulkUnassign, apply: t.contacts.apply,
  };
};

const ROW_IDS = ["ct_aaa", "ct_bbb", "ct_ccc"];
const rows: ContactsBulkRow[] = ROW_IDS.map((id) => ({
  id,
  cells: (<>
    <td className="px-3 py-2">NAME-{id}</td>
    <td className="px-3 py-2">MAIL-{id}</td>
    <td className="px-3 py-2"><time dateTime="2026-08-01T00:00:00.000Z">01 Aug 2026</time></td>
  </>),
}));

const header = (<>
  <th scope="col">Name</th><th scope="col">Contact</th><th scope="col">Received</th>
</>);

const propsFor = (loc: (typeof LOCALES)[number], canManage: boolean) => ({
  rows,
  labels: labelsFor(loc),
  statusOptions: [{ value: "new", label: "New" }, { value: "handled", label: "Handled" }],
  assigneeOptions: [{ value: "u_1", label: "owner@tenant.test" }],
  canManage,
  statusAction: serverAction,
  assignAction: serverAction,
  header,
});

const render = (loc: (typeof LOCALES)[number], canManage: boolean) =>
  renderToStaticMarkup(<ContactsBulkTable {...propsFor(loc, canManage)} />);

console.log("\n1) A — every prop crossing the boundary is serializable (runtime walk of real values)");
{
  for (const loc of LOCALES) {
    for (const canManage of [true, false]) {
      const bad = illegalFunctions(propsFor(loc, canManage));
      check(`1a) ${loc} / canManage=${canManage}: no non-action function reaches the client component`,
        bad.length === 0, bad.join(" | "));
    }
  }
  // Server Actions must still be functions — the fix must not have turned them into data.
  const p = propsFor("en", true);
  check("1b) the two bulk props are Server Actions (functions carrying the server-reference marker)",
    typeof p.statusAction === "function" && typeof p.assignAction === "function"
    && (p.statusAction as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE
    && (p.assignAction as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE);

  // NEGATIVE CONTROL — the walker must reject the two props that actually broke production.
  const withRenderRow = { ...p, renderRow: (id: string) => <td>{id}</td> };
  const withFormatter = { ...p, labels: { ...p.labels, selectedCount: (n: number) => `${n} selected` } };
  const rowsWithFn = { ...p, rows: [{ id: "x", cells: <td onClick={() => {}}>x</td> }] };
  check("1c) NEGATIVE CONTROL: a renderRow prop is detected",
    illegalFunctions(withRenderRow).some((f) => f.includes("renderRow")));
  check("1d) NEGATIVE CONTROL: a formatter inside labels is detected",
    illegalFunctions(withFormatter).some((f) => f.includes("labels.selectedCount")));
  check("1e) NEGATIVE CONTROL: a function nested inside a row's cells is detected",
    illegalFunctions(rowsWithFn).some((f) => f.includes("onClick")));
  check("1f) NEGATIVE CONTROL: a Server Action is NOT flagged", illegalFunctions({ a: serverAction }).length === 0);
}

console.log("\n2) A — the label bundle is strings only, in every locale");
{
  for (const loc of LOCALES) {
    const labels = labelsFor(loc) as unknown as Record<string, unknown>;
    const values = Object.entries(labels);
    check(`2a) ${loc}: every label is a non-empty string (no formatter survives)`,
      values.every(([, v]) => typeof v === "string" && (v as string).trim().length > 0),
      values.filter(([, v]) => typeof v !== "string").map(([k]) => k).join(","));
    check(`2b) ${loc}: no function anywhere in labels`, illegalFunctions(labels, "labels").length === 0);
  }
  const dict = businessDict("en").contacts as unknown as Record<string, unknown>;
  check("2c) the dictionary no longer exposes a selectedCount formatter at all",
    !("selectedCount" in dict) && typeof dict.selectedCountTemplate === "string");
}

console.log("\n3) A/C — the count text is localized without a function crossing the boundary");
{
  // The exact strings the removed formatters produced, so SK/EN/DE output is provably unchanged.
  const EXPECTED: Record<(typeof LOCALES)[number], string> = {
    en: "7 selected", sk: "Vybraných: 7", de: "7 ausgewählt",
  };
  for (const loc of LOCALES) {
    const tpl = businessDict(loc).contacts.selectedCountTemplate;
    check(`3a) ${loc}: the template is a string holding exactly one ${SELECTED_COUNT_PLACEHOLDER}`,
      typeof tpl === "string" && tpl.split(SELECTED_COUNT_PLACEHOLDER).length === 2, tpl);
    const out = formatSelectedCount(tpl, 7);
    check(`3b) ${loc}: client-side substitution reproduces the previous wording exactly`,
      out === EXPECTED[loc], `${out} != ${EXPECTED[loc]}`);
    check(`3c) ${loc}: no placeholder leaks into the rendered text`, !out.includes(SELECTED_COUNT_PLACEHOLDER));
  }
  const tpls = LOCALES.map((l) => businessDict(l).contacts.selectedCountTemplate);
  check("3d) the three locales are genuinely distinct (nothing hard-coded to English)",
    new Set(tpls).size === 3 && !tpls.every((t) => t.includes("selected")));
  check("3e) zero and large counts substitute cleanly",
    formatSelectedCount("{count} selected", 0) === "0 selected" && formatSelectedCount("{count} selected", 100) === "100 selected");
}

console.log("\n4) B — rendered truth: ids stay paired with their own cells (manager)");
{
  const html = render("en", true);
  const rowBlocks = html.split('<tr data-contact-row="').slice(1);
  check("4a) exactly one <tr> per row, no duplicated row markup", rowBlocks.length === ROW_IDS.length,
    `${rowBlocks.length} rows`);
  check("4b) each row carries its own id and ONLY its own cells", ROW_IDS.every((id, i) => {
    const block = rowBlocks[i] ?? "";
    const others = ROW_IDS.filter((o) => o !== id);
    return block.startsWith(`${id}"`) && block.includes(`NAME-${id}`) && block.includes(`MAIL-${id}`)
      && others.every((o) => !block.includes(`NAME-${o}`));
  }));
  check("4c) every row's content appears exactly once in the document",
    ROW_IDS.every((id) => html.split(`NAME-${id}`).length === 2));
  check("4d) rows render in the server-supplied order",
    ROW_IDS.every((id, i) => (rowBlocks[i] ?? "").startsWith(`${id}"`)));
  check("4e) the server-supplied header is rendered in the head row", html.includes(">Received</th>"));
}

console.log("\n5) B — rendered truth: permission gating and accessible checkboxes");
{
  const manager = render("sk", true);
  const reader = render("sk", false);
  const L = labelsFor("sk");
  const count = (h: string, needle: string) => h.split(needle).length - 1;

  check("5a) manager: one select-all checkbox plus one per row", count(manager, 'type="checkbox"') === ROW_IDS.length + 1);
  check("5b) manager: the select-all checkbox is labelled for assistive tech",
    manager.includes(`aria-label="${L.selectPage}"`) && manager.includes(`title="${L.selectPage}"`));
  check("5c) manager: every row checkbox is labelled",
    count(manager, `aria-label="${L.selectRow}"`) === ROW_IDS.length);
  check("5d) manager: nothing is selected on first render (selection never survives a page change)",
    !manager.includes('name="contactIds"') && !manager.includes("<form"));

  check("5e) reader: no checkbox is rendered at all", !reader.includes('type="checkbox"'));
  check("5f) reader: the rows themselves still render in full",
    ROW_IDS.every((id) => reader.includes(`data-contact-row="${id}"`) && reader.includes(`NAME-${id}`)));
  check("5g) reader: no bulk form and no bulk control is reachable",
    !reader.includes("<form") && !reader.includes(L.apply) && !reader.includes(L.clearSelection));
}

console.log("\n6) C — selection is scoped to the rendered page only");
{
  const empty = new Set<string>();
  check("6a) select-all selects exactly the rendered page",
    [...nextPageSelection(ROW_IDS, empty)].sort().join(",") === [...ROW_IDS].sort().join(","));
  check("6b) select-all never unions an id from another page",
    !nextPageSelection(ROW_IDS, new Set(["ct_from_page_2"])).has("ct_from_page_2"));
  check("6c) toggling select-all off clears everything",
    nextPageSelection(ROW_IDS, new Set(ROW_IDS)).size === 0);
  check("6d) an empty page cannot produce a selection", nextPageSelection([], empty).size === 0);
  check("6e) submitted ids are filtered through the page ids, so a stale id can never be submitted",
    selectedOnPage(ROW_IDS, new Set(["ct_aaa", "ct_from_page_2"])).join(",") === "ct_aaa");
  check("6f) submitted ids keep the rendered order",
    selectedOnPage(ROW_IDS, new Set(["ct_ccc", "ct_aaa"])).join(",") === "ct_aaa,ct_ccc");
}

console.log("\n7) source contract: the boundary cannot regress");
{
  const table = readCode(TABLE);
  const page = readCode(PAGE);

  check("7a) renderRow no longer exists anywhere on this route",
    !/renderRow/.test(table) && !/renderRow/.test(page));
  check("7b) no selectedCount formatter is referenced by the page or the component",
    !/\bselectedCount\b/.test(table) && !/\bselectedCount\b/.test(page));
  check("7c) the labels interface declares no function type", (() => {
    const iface = (table.match(/export interface ContactsBulkLabels \{[\s\S]*?\n\}/) ?? [""])[0];
    return iface.length > 0 && !iface.includes("=>");
  })());
  check("7d) the ONLY function-typed props are the two Server Actions", (() => {
    // The inline props type literal of the component signature.
    const sig = (table.match(/export function ContactsBulkTable\(\{[\s\S]*?\n\}\) \{/) ?? [""])[0];
    const fnProps = [...sig.matchAll(/^\s*(\w+):[^;]*=>/gm)].map((m) => m[1]).sort();
    return sig.length > 0 && fnProps.join(",") === "assignAction,statusAction";
  })());
  check("7e) rows are built as data — id and cells come from the SAME map callback",
    /rows=\{page\.items\.map\(\(c\) => \(\{[\s\S]*?id: c\.id,[\s\S]*?cells: \(<>/.test(page));
  check("7f) the component still receives only the current page's rows (no full-list hydration)",
    !/rows=\{[^}]*allContacts|rows=\{[^}]*counts\.total/.test(page) && /rows=\{page\.items\.map/.test(page));
  check("7g) the table is still a Client Component and the page is still a Server Component",
    /^"use client";/m.test(read(TABLE)) && !/"use client"/.test(read(PAGE)));
  check("7h) the bulk actions are still Server Actions passed by reference",
    /statusAction=\{bulkChangeStatusAction\}/.test(page) && /assignAction=\{bulkAssignAction\}/.test(page)
    && /^"use server";/m.test(read("apps/web/src/app/dashboard/contacts/actions.ts")));
  check("7i) selection still resets on any view change (remount key preserved)",
    /key=\{selectionKey\}/.test(page)
    && ["sp.q", "sp.status", "sp.source", "sp.life", "sp.review", "sp.cursor"]
      .every((k) => ((page.match(/const selectionKey = `[^`]*`/) ?? [""])[0]).includes(k)));
  check("7j) anonymized rows still render nothing identifying and no provider/campaign linkability", (() => {
    const cells = (page.match(/cells: \(<>[\s\S]*?<\/>\)/) ?? [""])[0];
    const anon = "BusinessContactLifecycle.Anonymized";
    return cells.includes(`${anon}\n                      ? t.contacts.anonymizedContact`)
      && cells.includes(`${anon} ? "—" : (c.email`)
      && cells.includes(`${anon} ? "—" : bizLabel(t.source`)
      && cells.includes(`${anon} ? "—" : (c.campaignName`);
  })());
  check("7k) no contact field is passed to the client component outside the rendered cells",
    !/\b(email|phone|fullName|campaignName|formName)=\{/.test((page.match(/<ContactsBulkTable[\s\S]*?\n {10}\/>/) ?? [""])[0]));
}

console.log(
  "\nNOTE (limitation): react-server-dom-webpack is not resolvable in this repo, so Next.js's own RSC\n" +
  "encoder is not invoked here. Section 1 applies React's serialization rule with an independent walker\n" +
  "over the real prop values and proves, via negative controls, that it rejects the exact props that\n" +
  "broke production. Sections 4-5 are real react-dom/server renders; interactive selection after a click\n" +
  "is covered by the pure helpers in section 6, not by a simulated DOM event.",
);
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — contacts RSC boundary serialization: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
