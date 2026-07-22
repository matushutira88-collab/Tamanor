/**
 * CS-C6.1 — "ROUTING FAIL-CLOSED & FAMILY UI HARDENING" focused test.
 *
 * Two provable surfaces, no DB / browser / network:
 *   1. PURE logic — the fail-closed `classifyWorkspaceRouting` classifier and the safe Family action-error
 *      contract (`FAMILY_ACTION_ERROR_CODES` / `isFamilyActionErrorCode`) + SK/EN/DE dictionary parity for
 *      every new UI section (unsupported / dialog / errorBoundary / actionErrors).
 *   2. SOURCE INVARIANTS — the routing/guard/boundary files are hardened as specified: unknown kinds fail
 *      closed to /unsupported-workspace (never a Business default), the central resolver is used at every
 *      routing decision, no `window.confirm`, accessible dialog markup, state-returning destructive actions,
 *      the error boundary never renders the raw error, and all loading/error boundaries exist.
 *
 * Run: pnpm child-safety-ui-hardening:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyWorkspaceRouting, WorkspaceKind, SELECTABLE_WORKSPACE_KINDS } from "@guardora/core";
import { familyDict, FAMILY_ACTION_ERROR_CODES, isFamilyActionErrorCode } from "../src/app/family/family-i18n";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const SRV = join(HERE, "..", "src", "server");
const read = (rel: string): string => readFileSync(join(HERE, "..", "src", rel), "utf8");
const has = (rel: string): boolean => existsSync(join(HERE, "..", "src", rel));
// Strip block + line comments so a scan checks the CODE, not a docstring that names a forbidden pattern
// (e.g. the ConfirmDialog docstring says "NO window.confirm" — that mention must not fail the check).
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const LOCALES: Locale[] = ["en", "sk", "de"];

// ===========================================================================
// A. classifyWorkspaceRouting — fail-closed (unknown/corrupt/unsupported → "unsupported", never business)
// ===========================================================================
console.log("\nA. classifyWorkspaceRouting fail-closed");
check("Family enum → family", classifyWorkspaceRouting(WorkspaceKind.Family) === "family");
check("Business enum → business", classifyWorkspaceRouting(WorkspaceKind.Business) === "business");
check('"family" string → family', classifyWorkspaceRouting("family") === "family");
check('"business" string → business', classifyWorkspaceRouting("business") === "business");
check("ChildSafetyOrganization → unsupported (NOT business)", classifyWorkspaceRouting(WorkspaceKind.ChildSafetyOrganization) === "unsupported");
check("Internal → unsupported (NOT business)", classifyWorkspaceRouting(WorkspaceKind.Internal) === "unsupported");
check("null → unsupported", classifyWorkspaceRouting(null) === "unsupported");
check("undefined → unsupported", classifyWorkspaceRouting(undefined) === "unsupported");
check('empty string "" → unsupported', classifyWorkspaceRouting("") === "unsupported");
check('wrong case "FAMILY" → unsupported (exact match only)', classifyWorkspaceRouting("FAMILY") === "unsupported");
check('trailing space "business " → unsupported', classifyWorkspaceRouting("business ") === "unsupported");
check("number 123 → unsupported", classifyWorkspaceRouting(123 as unknown) === "unsupported");
check("boolean true → unsupported", classifyWorkspaceRouting(true as unknown) === "unsupported");
check("object {} → unsupported", classifyWorkspaceRouting({} as unknown) === "unsupported");
check("array [] → unsupported", classifyWorkspaceRouting([] as unknown) === "unsupported");
check('raw enum "child_safety_organization" → unsupported', classifyWorkspaceRouting("child_safety_organization") === "unsupported");
check('raw enum "internal" → unsupported', classifyWorkspaceRouting("internal") === "unsupported");
check('unknown "startup" → unsupported', classifyWorkspaceRouting("startup") === "unsupported");
check("no input branch EVER returns business for a non-business kind", ["family", "unsupported"].includes(classifyWorkspaceRouting("child_safety_organization") === "business" ? "business" : classifyWorkspaceRouting("child_safety_organization")));
// every SELECTABLE kind classifies to a real console (never unsupported)
for (const k of SELECTABLE_WORKSPACE_KINDS) check(`selectable kind ${k} → not unsupported`, classifyWorkspaceRouting(k) !== "unsupported");

// ===========================================================================
// B. Safe action-error contract (the ONLY groups a destructive UI may surface)
// ===========================================================================
console.log("\nB. Safe Family action-error contract");
const EXPECTED_CODES = ["forbidden", "not_found", "invalid_state", "authorization_not_effective", "archived", "already_revoked", "retry_later"];
check("FAMILY_ACTION_ERROR_CODES == the 7 allowed groups", [...FAMILY_ACTION_ERROR_CODES].sort().join(",") === [...EXPECTED_CODES].sort().join(","));
for (const c of EXPECTED_CODES) check(`isFamilyActionErrorCode("${c}") === true`, isFamilyActionErrorCode(c));
check('isFamilyActionErrorCode("") === false', !isFamilyActionErrorCode(""));
check('isFamilyActionErrorCode("dashboard") === false', !isFamilyActionErrorCode("dashboard"));
check("isFamilyActionErrorCode(null) === false", !isFamilyActionErrorCode(null));
check("isFamilyActionErrorCode(undefined) === false", !isFamilyActionErrorCode(undefined));
check('isFamilyActionErrorCode("DROP TABLE") === false (no raw leak passes the guard)', !isFamilyActionErrorCode("DROP TABLE"));
check("isFamilyActionErrorCode(42) === false", !isFamilyActionErrorCode(42));

// ===========================================================================
// C. i18n — every new section present, non-empty, key-parity across SK/EN/DE, actually translated
// ===========================================================================
console.log("\nC. i18n SK/EN/DE parity for new sections");
const dicts = Object.fromEntries(LOCALES.map((l) => [l, familyDict(l)])) as Record<Locale, ReturnType<typeof familyDict>>;
const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

for (const l of LOCALES) {
  const u = dicts[l].unsupported;
  check(`[${l}] unsupported.* all non-empty`, [u.title, u.body, u.explain, u.logout, u.help].every(nonEmpty));
  const d = dicts[l].dialog;
  check(`[${l}] dialog.* all non-empty`, [d.confirm, d.cancel, d.working, d.errorTitle, d.archiveProfileTitle, d.archiveProfileBody, d.archiveProfileConfirm, d.revokeAuthTitle, d.revokeAuthBody, d.revokeAuthConfirm, d.revokeDeliveryTitle, d.revokeDeliveryBody, d.revokeDeliveryConfirm, d.archiveDeliveryTitle, d.archiveDeliveryBody, d.archiveDeliveryConfirm].every(nonEmpty));
  const e = dicts[l].errorBoundary;
  check(`[${l}] errorBoundary.* all non-empty`, [e.title, e.body, e.retry, e.back].every(nonEmpty));
  const codeKeys = Object.keys(dicts[l].actionErrors);
  check(`[${l}] actionErrors has an entry for every safe code`, EXPECTED_CODES.every((c) => nonEmpty(dicts[l].actionErrors[c])));
  check(`[${l}] actionErrors has NO extra/unknown keys`, codeKeys.every((k) => EXPECTED_CODES.includes(k)));
}
// key parity: every locale has identical dialog keys
const dialogKeys = (l: Locale) => Object.keys(dicts[l].dialog).sort().join(",");
check("dialog key-parity EN==SK", dialogKeys("en") === dialogKeys("sk"));
check("dialog key-parity EN==DE", dialogKeys("en") === dialogKeys("de"));
const unsuppKeys = (l: Locale) => Object.keys(dicts[l].unsupported).sort().join(",");
check("unsupported key-parity EN==SK==DE", unsuppKeys("en") === unsuppKeys("sk") && unsuppKeys("en") === unsuppKeys("de"));
// actually translated (SK/DE differ from EN on a representative string)
check("SK unsupported.title translated (≠ EN)", dicts.sk.unsupported.title !== dicts.en.unsupported.title);
check("DE unsupported.title translated (≠ EN)", dicts.de.unsupported.title !== dicts.en.unsupported.title);
check("SK errorBoundary.title translated (≠ EN)", dicts.sk.errorBoundary.title !== dicts.en.errorBoundary.title);
check("DE dialog.revokeAuthConfirm translated (≠ EN)", dicts.de.dialog.revokeAuthConfirm !== dicts.en.dialog.revokeAuthConfirm);
// no obvious leak tokens in any user-facing action-error text
const leak = /(prisma|sql|stack|tenantid|undefined|null|select \*)/i;
for (const l of LOCALES) check(`[${l}] actionErrors contain no leak tokens`, EXPECTED_CODES.every((c) => !leak.test(dicts[l].actionErrors[c] ?? "")));
// the straight-quote termination bug must not recur: SK/DE delivery "available means" must contain full clause
check("SK deliveries.availableMeans not truncated (curly quotes)", dicts.sk.deliveries.availableMeans.includes("Tamanor Rodina"));
check("DE deliveries.availableMeans not truncated (curly quotes)", dicts.de.deliveries.availableMeans.includes("Tamanor Familie"));

// ===========================================================================
// D. Source invariants — fail-closed routing + hardened UI
// ===========================================================================
console.log("\nD. Source invariants");
const workspaceRouting = readFileSync(join(SRV, "workspace-routing.ts"), "utf8");
check("resolver default/unsupported branch → /unsupported-workspace", workspaceRouting.includes("/unsupported-workspace"));
check("resolver no-workspace → /register/workspace-type", workspaceRouting.includes("/register/workspace-type"));
check("resolver uses classifyWorkspaceRouting", workspaceRouting.includes("classifyWorkspaceRouting"));
check("resolver has NO business default for unknown (unsupported case present)", /case "unsupported"|default:/.test(workspaceRouting) && workspaceRouting.includes("unsupported_workspace"));

const guard = readFileSync(join(SRV, "family-guard.ts"), "utf8");
const guardCode = stripComments(guard);
check("family-guard requireFamilyActor gates on classifyWorkspaceRouting !== \"family\"", guard.includes('classifyWorkspaceRouting(session.workspaceKind) !== "family"'));
check("family-guard uses resolveWorkspaceDestination (no hard /dashboard fallback)", guardCode.includes("resolveWorkspaceDestination") && !/redirect\("\/dashboard"\)/.test(guardCode));

const dashLayout = read("app/dashboard/layout.tsx");
check("dashboard layout gates on classifyWorkspaceRouting !== \"business\"", dashLayout.includes('classifyWorkspaceRouting(session.workspaceKind) !== "business"'));
check("dashboard layout uses resolver for non-business", dashLayout.includes("resolveWorkspaceDestination"));

// The forbidden pattern: a ternary/else that defaults an unknown kind to Business.
const routingFiles = [
  "app/login/actions.ts", "app/register/page.tsx", "app/register/workspace-type/page.tsx",
  "server/family-guard.ts", "app/dashboard/layout.tsx",
];
for (const f of routingFiles) {
  const src = read(f);
  check(`${f} has no \`? "/family" : "/dashboard"\` fallback ternary`, !/workspaceKind\s*===\s*["']family["']\s*\?\s*["']\/family["']\s*:\s*["']\/dashboard["']/.test(src));
}
check("login redirect uses resolveWorkspaceDestination", read("app/login/actions.ts").includes("resolveWorkspaceDestination"));
check("authenticated register redirect uses resolveWorkspaceDestination", read("app/register/page.tsx").includes("resolveWorkspaceDestination"));
check("workspace-type redirect uses resolveWorkspaceDestination", read("app/register/workspace-type/page.tsx").includes("resolveWorkspaceDestination"));

// Unsupported-workspace page — safe fail-closed, no loop, no raw kind
const unsupp = read("app/unsupported-workspace/page.tsx");
check("unsupported page exists", has("app/unsupported-workspace/page.tsx"));
check("unsupported page bounces SUPPORTED kinds (guards on classify !== unsupported)", unsupp.includes('classifyWorkspaceRouting(session.workspaceKind) !== "unsupported"'));
check("unsupported page sends no-workspace to /register/workspace-type", unsupp.includes("/register/workspace-type"));
check("unsupported page renders NO raw workspaceKind/tenantId", !/\{session\.(workspaceKind|tenantId)\}/.test(unsupp));
check("unsupported page offers a sign-out exit", unsupp.includes("signOut"));

// Confirmation dialog — no window.confirm, accessible, safe error only
const dialog = read("app/family/confirm-dialog.tsx");
const dialogCode = stripComments(dialog);
check("ConfirmDialog does NOT use window.confirm", !dialogCode.includes("window.confirm"));
check("ConfirmDialog is role=dialog + aria-modal", dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"'));
check("ConfirmDialog is aria-labelledby + aria-describedby", dialog.includes("aria-labelledby") && dialog.includes("aria-describedby"));
check("ConfirmDialog disables buttons while pending", dialog.includes("disabled={isPending}"));
check("ConfirmDialog does not accept tenantId/actorMembershipId props", !/tenantId|actorMembershipId/.test(dialogCode));
check("ConfirmDialog localizes only via safe error GROUP (isFamilyActionErrorCode)", dialog.includes("isFamilyActionErrorCode"));

// Destructive server actions — state-returning (safe), never redirect-to-?e=error
const destructive: Array<[string, string]> = [
  ["app/family/(console)/profiles/actions.ts", "archiveProtectedProfileAction"],
  ["app/family/(console)/authorizations/actions.ts", "revokeRecipientAuthorizationDecisionAction"],
  ["app/family/(console)/deliveries/actions.ts", "revokeSafetySignalDeliveryAction"],
  ["app/family/(console)/deliveries/actions.ts", "archiveSafetySignalDeliveryAction"],
];
for (const [f, fn] of destructive) {
  const src = read(f);
  const sig = new RegExp(`${fn}\\([^)]*_prev[^)]*FormData[^)]*\\)\\s*:\\s*Promise<FamilyActionState>`);
  check(`${fn} is useActionState-shaped (returns FamilyActionState)`, sig.test(src));
}
const safeErr = readFileSync(join(SRV, "family-safe-error.ts"), "utf8");
check("safe-error mapper maps Forbidden→forbidden, NotFound→not_found, NotEligible→authorization_not_effective, Validation→invalid_state, else→retry_later", ["FamilyForbiddenError", "\"forbidden\"", "FamilyNotFoundError", "\"not_found\"", "DeliveryNotEligibleError", "\"authorization_not_effective\"", "FamilyValidationError", "\"invalid_state\"", "\"retry_later\""].every((s) => safeErr.includes(s)));

// Error boundary — safe, never renders the raw error
const famErr = read("app/family/family-error.tsx");
check("family-error is a client component", famErr.includes('"use client"'));
check("family-error does NOT render {error.message} / stack to the user", !/\{error\.(message|stack)\}/.test(famErr));
check("family-error offers reset() + link back to /family", famErr.includes("reset()") && famErr.includes('href="/family"'));
check("family-error boundaries: /family + /family/(console) error.tsx exist", has("app/family/error.tsx") && has("app/family/(console)/error.tsx"));

// Loading boundaries — /family + 8 console routes
const loadingFiles = [
  "app/family/loading.tsx",
  "app/family/(console)/loading.tsx",
  "app/family/(console)/profiles/loading.tsx",
  "app/family/(console)/profiles/[profileId]/loading.tsx",
  "app/family/(console)/guardians/loading.tsx",
  "app/family/(console)/authorizations/loading.tsx",
  "app/family/(console)/signals/loading.tsx",
  "app/family/(console)/deliveries/loading.tsx",
  "app/family/(console)/settings/loading.tsx",
];
check(`all ${loadingFiles.length} loading.tsx boundaries exist (/family + 8 console)`, loadingFiles.every(has));
const skeletons = read("app/family/skeletons.tsx");
check("skeletons are content-free (aria-busy + sr-only Loading, no data)", skeletons.includes('aria-busy="true"') && skeletons.includes("sr-only"));
check("skeletons export the 4 shared shapes", ["FamilyPageSkeleton", "FamilyKpiSkeleton", "FamilyTableSkeleton", "FamilyDetailSkeleton"].every((s) => skeletons.includes(`export function ${s}`)));

// The 4 destructive call sites now render ConfirmDialog (not a bare submit form)
check("profiles page wires ConfirmDialog for archive", read("app/family/(console)/profiles/page.tsx").includes("ConfirmDialog"));
check("authorizations page wires ConfirmDialog for revoke", read("app/family/(console)/authorizations/page.tsx").includes("ConfirmDialog"));
check("deliveries page wires ConfirmDialog for revoke + archive", (read("app/family/(console)/deliveries/page.tsx").match(/ConfirmDialog/g) ?? []).length >= 2);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — child-safety UI hardening (CS-C6.1): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
