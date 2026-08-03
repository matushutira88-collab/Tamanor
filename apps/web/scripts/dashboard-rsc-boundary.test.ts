/**
 * DASHBOARD RSC BOUNDARY — regression guard for every Server Component → Client Component prop bundle
 * under apps/web/src/app/dashboard and apps/web/src/components/dashboard.
 *
 * WHY: a Client Component prop that is an ordinary function (a render callback, a label formatter inside
 * a translation object) cannot be encoded into the RSC payload. React throws
 * `Functions cannot be passed directly to Client Components` and the whole route fails at render time —
 * this already happened twice: /dashboard/contacts (renderRow + labels.selectedCount) and the child-safety
 * reviewer console (REVIEWER_COPY.list.results / .list.page / .actions.statusTitle / .actions.statusBody
 * passed wholesale as `t={t}` into FilterBar, EvidencePanel and ProtectionPlanPanel).
 *
 * HOW: this suite runs the REAL encoder — React's Flight server, the exact copy Next.js ships
 * (`next/dist/compiled/react-server-dom-webpack/server.node`) — under the `react-server` export
 * condition. It is not a reimplementation of React's rule: it IS React's rule. Server Actions are
 * validated through `registerServerReference`, the same marker Next applies to a `"use server"` export,
 * so a valid action is proven legal rather than assumed.
 *
 * Run: pnpm dashboard-rsc-boundary:test
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { Writable } from "node:stream";
import { INTEGRATION_COPY } from "../src/app/dashboard/child-safety/integrations/integration-i18n";
import { PILOT_COPY } from "../src/app/dashboard/child-safety/integrations/pilots/pilot-i18n";
import { POLICY_COPY } from "../src/app/dashboard/child-safety/policies/policy-i18n";
import { REVIEWER_COPY, fillCopy } from "../src/app/dashboard/child-safety/reviewer/reviewer-i18n";
import { INBOX_COPY } from "../src/app/dashboard/comments/inbox-i18n";
import { getDictionary } from "../src/i18n";
import { businessDict } from "../src/app/dashboard/business-i18n";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");

// ============================================================================================
// The real Flight encoder.
// ============================================================================================
type FlightServer = {
  renderToPipeableStream: (
    model: unknown,
    manifest: unknown,
    options?: { onError?: (e: unknown) => void },
  ) => { pipe: (dest: Writable) => void };
  registerServerReference: <T>(ref: T, id: string, exportName: string | null) => T;
};
const require_ = createRequire(import.meta.url);
let flight: FlightServer;
try {
  flight = require_("next/dist/compiled/react-server-dom-webpack/server.node") as FlightServer;
} catch (e) {
  console.error(
    "BLOCKED — could not load React's Flight server encoder.\n" +
    "This suite must run with the `react-server` export condition:\n" +
    "  NODE_OPTIONS=--conditions=react-server pnpm dashboard-rsc-boundary:test\n" +
    `Underlying error: ${(e as Error).message}`,
  );
  process.exit(1);
}

/** Encode a value exactly the way the RSC payload does. Resolves with React's own error, if any. */
function encode(model: unknown): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    let err = "";
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve({ ok: err === "", error: err }); } };
    sink.on("finish", done);
    sink.on("error", done);
    const timer = setTimeout(done, 5000);
    timer.unref?.();
    try {
      flight.renderToPipeableStream(model, {}, { onError: (e) => { if (!err) err = String((e as Error)?.message ?? e); } }).pipe(sink);
    } catch (e) { err = String((e as Error)?.message ?? e); done(); }
  });
}
const FN_ERROR = /Functions cannot be passed directly to Client Components/;

const LOCALES = ["en", "sk", "de"] as const;
type L = (typeof LOCALES)[number];

async function main() {
  // ==========================================================================================
  console.log("\n1) encoder self-check — the harness really is React's rule, not a lookalike");
  {
    const plain = await encode({ a: "x", n: 1, b: true, nested: { list: ["a", "b"], nil: null } });
    check("1a) a plain data bundle encodes", plain.ok, plain.error);

    const formatter = await encode({ labels: { selectedCount: (n: number) => `${n} selected` } });
    check("1b) a FORMATTER inside a label object is rejected by React", !formatter.ok && FN_ERROR.test(formatter.error), formatter.error);

    const renderCb = await encode({ renderRow: (id: string) => ({ id }) });
    check("1c) a RENDER CALLBACK prop is rejected", !renderCb.ok && FN_ERROR.test(renderCb.error), renderCb.error);

    // React reports `onX` props with its own dedicated message rather than the generic function one.
    const handler = await encode({ onClick: () => undefined });
    check("1d) an EVENT HANDLER created on the server is rejected",
      !handler.ok && (FN_ERROR.test(handler.error) || /Event handlers cannot be passed to Client Component props/.test(handler.error)),
      handler.error);

    const nested = await encode({ rows: [{ id: "a", cell: { fmt: (n: number) => String(n) } }] });
    check("1e) a function nested inside an array/object is rejected", !nested.ok && FN_ERROR.test(nested.error), nested.error);

    class Row { constructor(public id: string) {} }
    const instance = await encode({ row: new Row("x") });
    check("1f) a CLASS INSTANCE (e.g. a non-plain ORM value) is rejected", !instance.ok, instance.error || "encoded without error");

    const dates = await encode({ createdAt: new Date(0), ids: ["a"] });
    check("1g) Date IS serializable (so DB rows carrying timestamps are fine)", dates.ok, dates.error);

    // Requirement: confirm Server Actions through the ACTUAL server-reference boundary, not `typeof`.
    const action = flight.registerServerReference(async (_fd: FormData) => {}, "test-module#bulkAction", null);
    const withAction = await encode({ statusAction: action, assignAction: action, canManage: true });
    check("1h) a REGISTERED SERVER ACTION encodes cleanly (valid actions are not defects)", withAction.ok, withAction.error);

    const bareFn = await encode({ statusAction: async (_fd: FormData) => {} });
    check("1i) the same function WITHOUT the server-reference marker is rejected", !bareFn.ok && FN_ERROR.test(bareFn.error), bareFn.error);
  }

  // ==========================================================================================
  console.log("\n2) every dictionary bundle that crosses a dashboard boundary encodes cleanly");
  {
    const bundles: { label: string; pick: (l: L) => unknown }[] = [
      { label: "child-safety/integrations  <IntegrationConsole t={…}>", pick: (l) => INTEGRATION_COPY[l] },
      { label: "child-safety/pilots        <PilotListConsole|PilotDetailControls t={…}>", pick: (l) => PILOT_COPY[l] },
      { label: "child-safety/policies      <NewPolicyForm|VersionActions t={…}>", pick: (l) => POLICY_COPY[l] },
      { label: "child-safety/reviewer      <FilterBar|EvidencePanel|ProtectionPlanPanel t={…}>", pick: (l) => REVIEWER_COPY[l] },
      { label: "child-safety/reviewer      <NotesPanel|ReviewActions errors={t.errors}>", pick: (l) => REVIEWER_COPY[l].errors },
      { label: "child-safety/reviewer      <ReviewActions statusTarget={t.statusTarget}>", pick: (l) => REVIEWER_COPY[l].statusTarget },
      { label: "dashboard/layout           <DashboardShell navLabels={dict.dashboardNav}>", pick: (l) => (getDictionary(l) as unknown as Record<string, unknown>).dashboardNav },
      { label: "dashboard/layout           <DashboardShell sidebarStrings={dict.sidebar}>", pick: (l) => (getDictionary(l) as unknown as Record<string, unknown>).sidebar },
      {
        label: "dashboard/contacts         <ContactsBulkTable labels={…}>",
        pick: (l) => {
          const t = businessDict(l).contacts as unknown as Record<string, unknown>;
          return {
            selectRow: t.selectRow, selectPage: t.selectPage, selectedCountTemplate: t.selectedCountTemplate,
            clearSelection: t.clearSelection, bulkStatus: t.bulkStatus, bulkAssign: t.bulkAssign,
            bulkUnassign: t.bulkUnassign, apply: t.apply,
          };
        },
      },
    ];
    for (const b of bundles) {
      for (const l of LOCALES) {
        const r = await encode(b.pick(l));
        check(`2) ${b.label} [${l}]`, r.ok, r.error);
      }
    }

    // NEGATIVE CONTROL — the reviewer copy AS IT WAS before this fix. React must reject it, otherwise
    // section 2 would be passing vacuously and the defect could return unnoticed.
    const prefix = {
      ...REVIEWER_COPY.en,
      list: { ...REVIEWER_COPY.en.list, results: (n: number) => `${n} incidents`, page: (a: number, b: number) => `Page ${a} of ${b}` },
      actions: { ...REVIEWER_COPY.en.actions, statusTitle: (s: string) => `${s}?`, statusBody: (s: string) => `…${s}…` },
    };
    const control = await encode(prefix);
    check("2z) NEGATIVE CONTROL: the PRE-FIX reviewer copy (4 formatters) is rejected by React",
      !control.ok && FN_ERROR.test(control.error), control.error || "encoded without error");
  }

  // ==========================================================================================
  console.log("\n3) the reviewer copy keeps its wording after the formatter → template change");
  {
    const EXPECTED_RESULTS: Record<L, string> = { en: "7 incidents", sk: "7 incidentov", de: "7 Vorfälle" };
    const EXPECTED_ONE: Record<L, string> = { en: "1 incident", sk: "1 incidentov", de: "1 Vorfälle" };
    const EXPECTED_PAGE: Record<L, string> = { en: "Page 2 of 5", sk: "Strana 2 z 5", de: "Seite 2 von 5" };
    for (const l of LOCALES) {
      const c = REVIEWER_COPY[l];
      check(`3a) ${l}: plural result count is unchanged`, fillCopy(c.list.resultsMany, { count: 7 }) === EXPECTED_RESULTS[l], fillCopy(c.list.resultsMany, { count: 7 }));
      check(`3b) ${l}: singular result count is unchanged`, fillCopy(c.list.resultsOne, { count: 1 }) === EXPECTED_ONE[l], fillCopy(c.list.resultsOne, { count: 1 }));
      check(`3c) ${l}: pagination wording is unchanged`, fillCopy(c.list.pageTemplate, { page: 2, total: 5 }) === EXPECTED_PAGE[l], fillCopy(c.list.pageTemplate, { page: 2, total: 5 }));
      check(`3d) ${l}: the status confirm copy interpolates the status`, (() => {
        const title = fillCopy(c.actions.statusTitleTemplate, { status: "resolved" });
        const body = fillCopy(c.actions.statusBodyTemplate, { status: "resolved" });
        return title === "resolved?" && body.includes("resolved") && !body.includes("{status}");
      })());
    }
    check("3e) English still distinguishes singular from plural", REVIEWER_COPY.en.list.resultsOne !== REVIEWER_COPY.en.list.resultsMany);
    check("3f) the three locales are genuinely distinct (nothing hard-coded to English)",
      new Set(LOCALES.map((l) => REVIEWER_COPY[l].list.pageTemplate)).size === 3);
    check("3g) the server call site uses the templates, not a formatter", (() => {
      const page = read("apps/web/src/app/dashboard/child-safety/reviewer/page.tsx");
      return /fillCopy\(list\.total === 1 \? t\.list\.resultsOne : t\.list\.resultsMany/.test(page)
        && /fillCopy\(t\.list\.pageTemplate/.test(page)
        && !/t\.list\.results\(|t\.list\.page\(/.test(page);
    })());
  }

  // ==========================================================================================
  console.log("\n4) structural guards on the boundary itself");
  {
    const reviewerI18n = read("apps/web/src/app/dashboard/child-safety/reviewer/reviewer-i18n.ts");
    check("4a) the reviewer copy INTERFACE declares no function-typed member", (() => {
      const iface = (reviewerI18n.match(/export interface ReviewerCopy \{[\s\S]*?\n\}/) ?? [""])[0];
      return iface.length > 0 && !iface.includes("=>");
    })());
    check("4b) no reviewer locale object defines a formatter",
      !/\b(results|page|statusTitle|statusBody):\s*\(/.test(reviewerI18n));

    // The comments inbox dictionary DOES contain formatters (selectedCount, updatedOf, …). That is safe only
    // because every importer is a Client Component that resolves it in the browser from a `locale` STRING
    // prop. It must never gain a Server Component importer, or those formatters would start crossing.
    const inbox = INBOX_COPY.en as unknown as Record<string, unknown>;
    check("4c) the comments inbox dictionary really does contain formatters (so 4d is load-bearing)",
      typeof inbox.selectedCount === "function" && typeof inbox.updatedOf === "function");
    const importers = walk("apps/web/src")
      .filter((f) => !f.endsWith("inbox-i18n.ts") && /from "\.{1,2}\/inbox-i18n"/.test(read(f)));
    const serverImporters = importers.filter((f) => !/^\s*"use client";/.test(read(f)));
    check(`4d) only Client Components import it (${importers.length} importers), so its formatters never cross a boundary`,
      importers.length > 0 && serverImporters.length === 0, serverImporters.join(", "));
    check("4e) the comments components receive a `locale` string, not a dictionary", (() => {
      const page = read("apps/web/src/app/dashboard/comments/page.tsx");
      return /<BulkActionBar[^>]*locale=\{locale\}/.test(page) && !/<BulkActionBar[^>]*(copy|labels|t)=\{/.test(page);
    })());

    // Change detector: a NEW Server → Client boundary must be audited, not merged silently.
    const edges = serverToClientEdges();
    check(`4f) the audited Server→Client boundary set is unchanged (${edges.length} edges)`,
      edges.length === KNOWN_EDGES.length && edges.every((e) => KNOWN_EDGES.includes(e)),
      `new/changed: ${edges.filter((e) => !KNOWN_EDGES.includes(e)).join(", ")} | removed: ${KNOWN_EDGES.filter((e) => !edges.includes(e)).join(", ")}`);
  }

  console.log(
    "\nNOTE: sections 1-2 run React's own Flight encoder (the copy Next.js ships), so a bundle that passes\n" +
    "here is genuinely encodable. Props built from live database rows are not reachable without a database;\n" +
    "they are covered structurally — the Prisma schema declares no Decimal/Bytes column, so DB rows reaching\n" +
    "a boundary are plain objects, strings, numbers, null and Date, all of which 1f/1g exercise directly.",
  );
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — dashboard RSC boundaries: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ============================================================================================
// Source scanning helpers.
// ============================================================================================
function walk(rel: string): string[] {
  const out: string[] = [];
  const rec = (p: string) => {
    for (const e of readdirSync(`${ROOT}${p}`)) {
      const child = `${p}/${e}`;
      if (statSync(`${ROOT}${child}`).isDirectory()) rec(child);
      else if (child.endsWith(".ts") || child.endsWith(".tsx")) out.push(child);
    }
  };
  rec(rel);
  return out;
}

/** Every `server module -> client module` import edge whose client module lives in the dashboard scope. */
function serverToClientEdges(): string[] {
  const files = walk("apps/web/src");
  const src = new Map(files.map((f) => [f, read(f)]));
  const isClient = (f: string) => /^\s*"use client";/.test(src.get(f) ?? "");
  const inScope = (f: string) => f.startsWith("apps/web/src/app/dashboard") || f.startsWith("apps/web/src/components/dashboard");
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = `apps/web/src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) {
      const parts = `${from.split("/").slice(0, -1).join("/")}/${spec}`.split("/");
      const stack: string[] = [];
      for (const p of parts) { if (p === "." || p === "") continue; if (p === "..") stack.pop(); else stack.push(p); }
      base = stack.join("/");
    } else return null;
    for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) if (src.has(c)) return c;
    return null;
  };
  const edges = new Set<string>();
  for (const f of files) {
    if (isClient(f)) continue;
    for (const m of (src.get(f) ?? "").matchAll(/import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/g)) {
      const target = resolve(f, m[1] ?? "");
      if (target && isClient(target) && inScope(target)) {
        edges.add(`${f.replace("apps/web/src/", "")} -> ${target.replace("apps/web/src/", "")}`);
      }
    }
  }
  return [...edges].sort();
}

/** The boundaries audited on 2026-08-03. Adding one here means it was reviewed for serializability. */
const KNOWN_EDGES: string[] = [
  "app/dashboard/accounts/[accountId]/page.tsx -> components/dashboard/submit-button.tsx",
  "app/dashboard/action-queue/[id]/page.tsx -> components/dashboard/live-hide-form.tsx",
  "app/dashboard/action-queue/[id]/page.tsx -> components/dashboard/submit-button.tsx",
  "app/dashboard/billing/page.tsx -> app/dashboard/billing/checkout-button.tsx",
  "app/dashboard/child-safety/integrations/page.tsx -> app/dashboard/child-safety/integrations/integration-console.tsx",
  "app/dashboard/child-safety/integrations/pilots/[pilotId]/page.tsx -> app/dashboard/child-safety/integrations/pilots/[pilotId]/pilot-detail-controls.tsx",
  "app/dashboard/child-safety/integrations/pilots/page.tsx -> app/dashboard/child-safety/integrations/pilots/pilot-list-console.tsx",
  "app/dashboard/child-safety/policies/[policyId]/page.tsx -> app/dashboard/child-safety/policies/[policyId]/version-actions.tsx",
  "app/dashboard/child-safety/policies/page.tsx -> app/dashboard/child-safety/policies/new-policy-form.tsx",
  "app/dashboard/child-safety/reviewer/[incidentId]/page.tsx -> app/dashboard/child-safety/reviewer/[incidentId]/evidence-panel.tsx",
  "app/dashboard/child-safety/reviewer/[incidentId]/page.tsx -> app/dashboard/child-safety/reviewer/[incidentId]/notes-panel.tsx",
  "app/dashboard/child-safety/reviewer/[incidentId]/page.tsx -> app/dashboard/child-safety/reviewer/[incidentId]/protection-plan-panel.tsx",
  "app/dashboard/child-safety/reviewer/[incidentId]/page.tsx -> app/dashboard/child-safety/reviewer/[incidentId]/review-actions.tsx",
  "app/dashboard/child-safety/reviewer/page.tsx -> app/dashboard/child-safety/reviewer/filter-bar.tsx",
  "app/dashboard/comments/page.tsx -> app/dashboard/comments/assignee-editor.tsx",
  "app/dashboard/comments/page.tsx -> app/dashboard/comments/inbox-controls.tsx",
  "app/dashboard/comments/page.tsx -> app/dashboard/comments/inbox-selection.tsx",
  "app/dashboard/comments/page.tsx -> app/dashboard/comments/label-editor.tsx",
  "app/dashboard/comments/page.tsx -> app/dashboard/comments/notes-section.tsx",
  "app/dashboard/contacts/[id]/page.tsx -> components/dashboard/submit-note-button.tsx",
  "app/dashboard/contacts/page.tsx -> components/dashboard/contacts-bulk-table.tsx",
  "app/dashboard/control-center/page.tsx -> components/dashboard/auto-hide-optin.tsx",
  "app/dashboard/control-center/page.tsx -> components/dashboard/autonomy-save.tsx",
  "app/dashboard/layout.tsx -> components/dashboard/dashboard-shell.tsx",
  "app/dashboard/leads/[id]/page.tsx -> components/dashboard/lead-erase.tsx",
  "app/dashboard/security/cyberbullying/incidents/[incidentId]/evidence/add/page.tsx -> app/dashboard/security/cyberbullying/incidents/[incidentId]/evidence/add/upload-form.tsx",
  "app/dashboard/security/cyberbullying/report/page.tsx -> app/dashboard/security/cyberbullying/report/report-form.tsx",
  "app/dashboard/security/cyberbullying/report/page.tsx -> app/dashboard/security/cyberbullying/report/report-success.tsx",
  "app/dashboard/settings/page.tsx -> components/dashboard/account-danger-zone.tsx",
  "app/dashboard/settings/page.tsx -> components/dashboard/danger-zone.tsx",
  "app/dashboard/settings/page.tsx -> components/dashboard/onboarding-settings-card.tsx",
  "app/e2e/double-submit/page.tsx -> components/dashboard/submit-button.tsx",
  "components/dashboard/accounts-table.tsx -> components/dashboard/accounts-bulk.tsx",
  "components/dashboard/accounts-table.tsx -> components/dashboard/monitoring-switch.tsx",
  "components/dashboard/onboarding-panel.tsx -> components/dashboard/onboarding-checklist.tsx",
  "components/dashboard/onboarding-panel.tsx -> components/dashboard/onboarding-welcome.tsx",
];

main().catch((e) => { console.error(e); process.exit(1); });
