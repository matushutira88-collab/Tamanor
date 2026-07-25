/**
 * Child Safety Protection Plans V1 — UI/source test (no DB / browser / network).
 *
 *   1. PURE view-model — plan/action/priority tones, the plan + action state-machine mirrors, title
 *      resolution, and the progress calculation.
 *   2. i18n parity — the `pp` block is localized in en/sk/de (action catalog, plan/action statuses,
 *      priorities, events, explanation codes).
 *   3. SOURCE INVARIANTS — the plan tab is view-gated and manager-gated; server actions are same-origin +
 *      manage-checked + return safe codes + revalidate; no window.confirm; terminal ops use accessible
 *      dialogs; no edit/delete of history; protected free text is rendered only from the action row; routes
 *      gate on resolveProtectionActor; the dashboard keeps existing metrics (backward compatible).
 *
 * Run: pnpm child-safety-protection-plan-ui:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planStatusTone, actionStatusTone, priorityTone, availablePlanTargets, availableActionTargets, resolveActionTitle,
} from "../src/app/dashboard/child-safety/reviewer/reviewer-view";
import { REVIEWER_COPY } from "../src/app/dashboard/child-safety/reviewer/reviewer-i18n";
import {
  computePlanProgress, ChildSafetyProtectionActionType, ChildSafetyProtectionPlanStatus, ChildSafetyProtectionActionStatus,
  ChildSafetyProtectionPriority, ChildSafetyProtectionEventType,
} from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "src");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");
const readDb = (rel: string): string => readFileSync(join(HERE, "..", "..", "..", "packages", "db", "src", rel), "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  console.log("\n1. view-model tones + state machine");
  check("★ planStatusTone: active→brand, completed→ok, reopened→warn", planStatusTone("active") === "brand" && planStatusTone("completed") === "ok" && planStatusTone("reopened") === "warn");
  check("★ actionStatusTone: blocked→danger, completed→ok, in_progress→brand", actionStatusTone("blocked") === "danger" && actionStatusTone("completed") === "ok" && actionStatusTone("in_progress") === "brand");
  check("★ priorityTone: urgent→danger, high→warn, normal→neutral", priorityTone("urgent") === "danger" && priorityTone("high") === "warn" && priorityTone("normal") === "neutral");
  check("★ availablePlanTargets: draft→[active,cancelled]", JSON.stringify(availablePlanTargets("draft").sort()) === JSON.stringify(["active", "cancelled"]));
  check("★ availablePlanTargets: completed→[reopened] only", JSON.stringify(availablePlanTargets("completed")) === JSON.stringify([ChildSafetyProtectionPlanStatus.Reopened]));
  check("★ availableActionTargets: pending offers start/block/complete/skip (not itself)", (() => { const t = availableActionTargets("pending"); return t.includes(ChildSafetyProtectionActionStatus.InProgress) && t.includes(ChildSafetyProtectionActionStatus.Completed) && !t.includes(ChildSafetyProtectionActionStatus.Pending); })());
  check("★ availableActionTargets: completed→[reopened] only", JSON.stringify(availableActionTargets("completed")) === JSON.stringify([ChildSafetyProtectionActionStatus.Reopened]));
  check("★ resolveActionTitle: catalog key → localized; custom passes through", resolveActionTitle("pp.action.legal_review.title", "legal_review", REVIEWER_COPY.en.pp.actionType) === REVIEWER_COPY.en.pp.actionType.legal_review!.title && resolveActionTitle("My custom", "custom_internal_action", REVIEWER_COPY.en.pp.actionType) === "My custom");

  console.log("\n2. progress calculation");
  const p = computePlanProgress([{ status: "completed", dueAt: null }, { status: "completed", dueAt: null }, { status: "skipped", dueAt: null }, { status: "pending", dueAt: new Date(Date.now() - 1000) }], new Date());
  check("★ completionPct excludes skipped from base: 2/(4−1)=67%", p.completionPct === 67);
  check("★ skipped counted separately, not as completed", p.skipped === 1 && p.completed === 2);
  check("★ overdue counts an unresolved past-due action", p.overdue === 1);
  check("★ empty/all-skipped plan → 100%", computePlanProgress([], new Date()).completionPct === 100 && computePlanProgress([{ status: "skipped", dueAt: null }], new Date()).completionPct === 100);

  console.log("\n3. i18n parity (pp block)");
  check("★ every action-catalog type localized (title+desc) in all locales", LOCALES.every((l) => Object.values(ChildSafetyProtectionActionType).every((tp) => !!REVIEWER_COPY[l].pp.actionType[tp]?.title && !!REVIEWER_COPY[l].pp.actionType[tp]?.desc)));
  check("★ every plan status localized", LOCALES.every((l) => Object.values(ChildSafetyProtectionPlanStatus).every((st) => !!REVIEWER_COPY[l].pp.planStatus[st])));
  check("★ every action status localized", LOCALES.every((l) => Object.values(ChildSafetyProtectionActionStatus).every((st) => !!REVIEWER_COPY[l].pp.actionStatus[st])));
  check("★ every priority localized", LOCALES.every((l) => Object.values(ChildSafetyProtectionPriority).every((pr) => !!REVIEWER_COPY[l].pp.priority[pr])));
  check("★ every event type localized", LOCALES.every((l) => Object.values(ChildSafetyProtectionEventType).every((ev) => !!REVIEWER_COPY[l].pp.event[ev])));

  console.log("\n4. tab gating + panel");
  const detail = read("app/dashboard/child-safety/reviewer/[incidentId]/page.tsx");
  const panel = read("app/dashboard/child-safety/reviewer/[incidentId]/protection-plan-panel.tsx");
  const console_ = read("app/dashboard/child-safety/reviewer/page.tsx");
  check("★ detail loads plan only when canViewChildSafetyProtectionPlan, wires ProtectionPlanPanel", /canViewChildSafetyProtectionPlan\(session\.role\)/.test(detail) && /<ProtectionPlanPanel/.test(detail));
  check("★ panel manage controls gated by canManage prop", /canManage=\{canManagePlan\}/.test(detail) && /canManage \?/.test(panel));
  check("★ dashboard extended with plan metrics, existing metrics kept (backward compatible)", /getProtectionPlanDashboard/.test(console_) && /getChildSafetyReviewerDashboard/.test(console_) && /dashActive/.test(console_));

  console.log("\n5. server actions fail-closed + safe");
  const actions = strip(read("app/dashboard/child-safety/reviewer/[incidentId]/protection-plan-actions.ts"));
  check("★ protection-plan-actions is a server module", /^\s*"use server"/.test(read("app/dashboard/child-safety/reviewer/[incidentId]/protection-plan-actions.ts")));
  check("★ mutations require same-origin + manage permission", /isSameOrigin\(\)/.test(actions) && /canManageChildSafetyProtectionPlan\(s\.role\)/.test(actions));
  check("★ actions revalidate + return safe codes, never raw message/stack", /revalidatePath/.test(actions) && /"forbidden"/.test(actions) && !/error:\s*e\.message/.test(actions) && !/\.stack/.test(actions));

  console.log("\n6. dialogs + no history mutation + protected text");
  check("★ NO window.confirm in the plan panel", !/window\.confirm/.test(strip(panel)));
  check("★ terminal plan ops use an accessible dialog (role=dialog + aria-modal + Esc)", /role="dialog"/.test(panel) && /aria-modal="true"/.test(panel) && /Escape/.test(panel));
  check("★ panel has NO edit/delete-history affordance", !/editAction|deleteAction|editPlan|deletePlan|removeEvent/i.test(strip(panel)));
  check("★ protected free text (blockReason/completionNote) rendered only from the action row", /a\.blockReason/.test(panel) && /a\.completionNote/.test(panel));
  check("★ no unsafe HTML (no dangerouslySetInnerHTML) in the plan panel", !/dangerouslySetInnerHTML/.test(panel));

  console.log("\n7. routes gate + service privacy");
  const r1 = strip(read("app/api/v1/child-safety/reviewer/incidents/[incidentId]/protection-plan/route.ts"));
  const r2 = strip(read("app/api/v1/child-safety/reviewer/incidents/[incidentId]/protection-plan/actions/route.ts"));
  const r3 = strip(read("app/api/v1/child-safety/reviewer/incidents/[incidentId]/protection-plan/actions/[actionId]/route.ts"));
  check("★ all plan routes gate on resolveProtectionActor + same-origin on writes", [r1, r2, r3].every((r) => /resolveProtectionActor\(\)/.test(r)) && /isSameOrigin\(\)/.test(r1) && /isSameOrigin\(\)/.test(r2) && /isSameOrigin\(\)/.test(r3));
  check("★ writes require plan MANAGE", /canManageChildSafetyProtectionPlan\(actor\.role\)/.test(r1) && /canManageChildSafetyProtectionPlan\(actor\.role\)/.test(r2));
  const svc = strip(readDb("child-safety-protection-plan.ts"));
  check("★ service NEVER writes completionNote/blockReason into events or audit", !/emit\([\s\S]{0,120}(completionNote|blockReason)/.test(svc) && !/audit\([\s\S]{0,160}(completionNote|blockReason)/.test(svc));
  check("★ no raw-content markers in the plan UI/service", !/transcript|messageBody|rawContent|detectorPayload/.test(strip(panel)) && !/transcript|messageBody|rawContent/.test(svc));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Protection Plans UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
