/**
 * Child Safety Policy Engine V1 — UI test (no DB/browser/network). Proves the pure view-model, EN/SK/DE
 * i18n parity, and SOURCE INVARIANTS: permission gating, immutable indicators, two-person notice, no
 * window.confirm, no unsafe HTML, NO executable/eval content, accessible activation dialog, and safe
 * API/server boundaries. Run: pnpm child-safety-policy-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  policyStatusTone, isImmutableVersion, versionUiActions, shortHash, decisionSummaryFlags, fmtDateTime,
} from "../src/app/dashboard/child-safety/policies/policy-view";
import { POLICY_COPY, POLICY_ERROR_CODES } from "../src/app/dashboard/child-safety/policies/policy-i18n";
import {
  ChildSafetyPolicyStatus, CHILD_SAFETY_POLICY_PURPOSES, POLICY_OPERATORS, POLICY_EFFECT_TYPES,
} from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "src", "app", "dashboard", "child-safety", "policies");
const read = (rel: string): string => readFileSync(join(DIR, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(DIR, rel));
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

function main() {
  // ── 1. PURE VIEW-MODEL ────────────────────────────────────────────
  console.log("\n1. view-model");
  check("★ statusTone: ACTIVE→ok, PENDING→warn, REJECTED→danger, DRAFT→brand, RETIRED→neutral", policyStatusTone("ACTIVE") === "ok" && policyStatusTone("PENDING_APPROVAL") === "warn" && policyStatusTone("REJECTED") === "danger" && policyStatusTone("DRAFT") === "brand" && policyStatusTone("RETIRED") === "neutral");
  check("★ isImmutableVersion: DRAFT mutable; PENDING/ACTIVE/RETIRED/REJECTED immutable", !isImmutableVersion("DRAFT") && isImmutableVersion("PENDING_APPROVAL") && isImmutableVersion("ACTIVE") && isImmutableVersion("RETIRED") && isImmutableVersion("REJECTED"));
  const caps = { manage: true, submit: true, approve: true, activate: true, simulate: true };
  const draftA = versionUiActions("DRAFT", caps);
  const pendingA = versionUiActions("PENDING_APPROVAL", caps);
  const activeA = versionUiActions("ACTIVE", caps);
  check("★ DRAFT → edit + submit (not approve/activate)", draftA.canEdit && draftA.canSubmit && !draftA.canApprove && !draftA.canActivate);
  check("★ PENDING → approve + reject + activate (not edit/submit)", pendingA.canApprove && pendingA.canReject && pendingA.canActivate && !pendingA.canEdit && !pendingA.canSubmit);
  check("★ ACTIVE → no edit/submit/approve/activate (only simulate)", !activeA.canEdit && !activeA.canSubmit && !activeA.canApprove && !activeA.canActivate && activeA.canSimulate);
  check("★ capabilities gate the actions (reviewer caps: no manage/approve/activate)", (() => { const r = versionUiActions("PENDING_APPROVAL", { manage: false, submit: false, approve: false, activate: false, simulate: true }); return !r.canApprove && !r.canActivate && r.canSimulate; })());
  check("★ shortHash truncates", shortHash("a".repeat(64)).includes("…") && shortHash("short") === "short");
  check("★ decisionSummaryFlags is bounded + code-only", (() => { const flags = decisionSummaryFlags({ purpose: "SIGNAL_TRIAGE" as never, createIncident: true, updateIncident: false, recommendedSeverity: "critical", recommendedUrgency: null, requireReview: true, requireSupervisorReview: true, recommendEscalation: false, escalationLevel: null, proposeProtectionPlan: false, proposedActions: [], allowAutomaticIntervention: false, automaticInterventionBounds: [], requireManualInterventionApproval: false, allowGuardianContactConsideration: false, prohibitGuardianContact: true, manualOnly: true }); return flags.includes("manual_only") && flags.includes("require_supervisor_review") && flags.includes("severity:critical") && flags.includes("guardian_contact_prohibited") && flags.every((f) => f.length < 40); })());
  check("★ fmtDateTime deterministic UTC", fmtDateTime("2026-07-27T09:35:00.000Z") === "2026-07-27 09:35" && fmtDateTime(null) === "—");

  // ── 2. i18n PARITY ────────────────────────────────────────────────
  console.log("\n2. i18n parity (en/sk/de)");
  const keyPaths = (o: unknown, p = ""): string[] => (o === null || typeof o !== "object") ? [p] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, p ? `${p}.${k}` : k));
  const en = keyPaths(POLICY_COPY.en).sort();
  check("★ sk structure == en", JSON.stringify(keyPaths(POLICY_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de structure == en", JSON.stringify(keyPaths(POLICY_COPY.de).sort()) === JSON.stringify(en));
  check("★ every purpose localized in all locales", LOCALES.every((l) => CHILD_SAFETY_POLICY_PURPOSES.every((p) => !!POLICY_COPY[l].purpose[p])));
  check("★ every lifecycle status localized", LOCALES.every((l) => Object.values(ChildSafetyPolicyStatus).every((s) => !!POLICY_COPY[l].statusLabel[s])));
  check("★ every operator localized", LOCALES.every((l) => POLICY_OPERATORS.every((o) => !!POLICY_COPY[l].operator[o])));
  check("★ every effect localized", LOCALES.every((l) => POLICY_EFFECT_TYPES.every((e) => !!POLICY_COPY[l].effect[e])));
  check("★ every error code localized", LOCALES.every((l) => POLICY_ERROR_CODES.every((c) => !!POLICY_COPY[l].errors[c])));
  check("★ privacy + guardian + manual-only + two-person + prospective notices present in all locales", LOCALES.every((l) => POLICY_COPY[l].privacyNotice && POLICY_COPY[l].guardianNotice && POLICY_COPY[l].manualOnlyNotice && POLICY_COPY[l].twoPersonNotice && POLICY_COPY[l].prospectiveNotice && POLICY_COPY[l].immutableNotice));

  // ── 3. SOURCE INVARIANTS ──────────────────────────────────────────
  console.log("\n3. permission gating");
  const listPage = read("page.tsx"); const detailPage = read("[policyId]/page.tsx");
  check("★ list page gates on canViewChildSafetyPolicy → <Unauthorized>", /canViewChildSafetyPolicy\(session\.role\)/.test(listPage) && /<Unauthorized/.test(listPage));
  check("★ detail page gates on canViewChildSafetyPolicy → <Unauthorized>", /canViewChildSafetyPolicy\(session\.role\)/.test(detailPage) && /<Unauthorized/.test(detailPage));
  check("★ create form only rendered when canManage", /canManageChildSafetyPolicy\(session\.role\)/.test(listPage) && /canManage \? <NewPolicyForm/.test(listPage));

  console.log("\n4. safety + accessibility + no executable content");
  const versionActions = read("[policyId]/version-actions.tsx"); const newForm = read("new-policy-form.tsx");
  const allClient = [versionActions, newForm].map(stripComments).join("\n");
  check("★ NO window.confirm anywhere", ["page.tsx", "[policyId]/page.tsx", "[policyId]/version-actions.tsx", "new-policy-form.tsx", "policy-view.ts"].every((f) => !/window\.confirm/.test(stripComments(read(f)))));
  check("★ NO dangerouslySetInnerHTML", ["page.tsx", "[policyId]/page.tsx", "[policyId]/version-actions.tsx", "new-policy-form.tsx"].every((f) => !/dangerouslySetInnerHTML/.test(read(f))));
  check("★ NO eval / new Function / dynamic code execution (policy is data)", !/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/.test(allClient));
  check("★ activation dialog is accessible (role=dialog + aria-modal + Escape)", /role="dialog"/.test(versionActions) && /aria-modal="true"/.test(versionActions) && /Escape/.test(versionActions));
  check("★ activation dialog shows the two-person notice", /twoPersonNotice/.test(versionActions));
  check("★ immutable indicator present in detail page", /immutable/.test(detailPage) && /🔒/.test(detailPage));
  check("★ simulation labelled side-effect-free in UI", /noSideEffects/.test(versionActions));
  check("★ loading + error boundaries exist; error never renders raw error", has("loading.tsx") && has("error.tsx") && !/error\.message|\{error\}|error\.stack/.test(stripComments(read("error.tsx"))));
  check("★ definition editor is a plain textarea (data), not a code runner", /<textarea/.test(newForm) && /<textarea/.test(versionActions) && /JSON\.parse/.test(newForm));

  console.log("\n5. API + server safety (source)");
  const server = readFileSync(join(HERE, "..", "src", "server", "child-safety", "policy.ts"), "utf8");
  const apiBase = join(HERE, "..", "src", "app", "api", "v1", "child-safety", "policies");
  check("★ server resolves session + membership + gates on canViewChildSafetyPolicy", /getSession\(\)/.test(server) && /membership\.findFirst/.test(server) && /canViewChildSafetyPolicy/.test(server));
  check("★ mutations require same-origin (isSameOrigin)", /isSameOrigin\(\)/.test(server));
  check("★ server returns SAFE codes, never raw message/stack", /"forbidden"/.test(server) && !/e\.message/.test(stripComments(server)) && !/\.stack/.test(stripComments(server)));
  check("★ request size is bounded", /MAX_BODY_BYTES|too_large/.test(server));
  check("★ API routes exist (policies, versions, action, decisions)", existsSync(join(apiBase, "route.ts")) && existsSync(join(apiBase, "[policyId]", "versions", "[versionId]", "action", "route.ts")) && existsSync(join(HERE, "..", "src", "app", "api", "v1", "child-safety", "policy-decisions", "route.ts")));

  console.log("\n6. content-free (no raw content anywhere in the policy UI)");
  const allSrc = ["page.tsx", "[policyId]/page.tsx", "[policyId]/version-actions.tsx", "new-policy-form.tsx", "policy-view.ts", "policy-i18n.ts"].map((f) => stripComments(read(f))).join("\n");
  check("★ policy UI never references raw content / message / transcript fields", !/detectorPayload|rawContent|transcript|messageBody|noteBody|\.body\b/.test(allSrc));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Policy Engine UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
