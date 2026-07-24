/**
 * FAMILY-UI-02B — Family success-toast focused test. No DB / browser / network.
 *
 * Two provable surfaces:
 *   1. PURE logic — verb→message resolution and the show-once (dedupe) decision, plus SK/EN/DE
 *      parity: EVERY `?ok=<verb>` a Family server action can emit has a specific localized
 *      message in all three locales (so a real success never falls back to the generic label).
 *   2. SOURCE INVARIANTS — the toaster renders from decoupled client state, strips `?ok=`
 *      (show-once + no replay), has an aria-live region, Escape + auto-dismiss, and is
 *      success-only (never reads the `?e=` error param — inline errors are left untouched).
 *
 * Run: pnpm family-toast:test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { familyDict } from "../src/app/family/family-i18n";
import { FAMILY_TOAST_VERBS, familyToastMessage, shouldEmitToast, isFamilyToastVerb } from "../src/app/family/family-feedback-core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, "..", "src", rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];

// The exact set of ?ok= verbs the Family server actions redirect with (grep of `?ok=` across
// app/family). If a new action verb is added without updating FAMILY_TOAST_VERBS + the i18n
// message maps, this list is the tripwire.
const ACTION_VERBS = [
  "created", "updated", "archived", "restored", "revoked", "evaluated", "guardian_deactivated",
  "authority_revoked", "authority_suspended", "consent_revoked", "consent_suspended",
  "assessment_rejected", "assessment_suspended", "assessment_expired",
];

// ===========================================================================
// A. Pure verb → message resolution
// ===========================================================================
console.log("\nA. familyToastMessage");
const msgs = { created: "Created", archived: "Archived" };
check("known verb → specific message", familyToastMessage("created", msgs, "Saved") === "Created");
check("unknown-but-present verb → generic fallback (still a success)", familyToastMessage("frobnicated", msgs, "Saved") === "Saved");
check("null verb → null (no toast)", familyToastMessage(null, msgs, "Saved") === null);
check("empty verb → null (no toast)", familyToastMessage("", msgs, "Saved") === null);
check("resolved message is ALWAYS dictionary text, never the raw token", familyToastMessage("archived", msgs, "Saved") === "Archived");

// ===========================================================================
// B. Show-once / no-replay decision
// ===========================================================================
console.log("\nB. shouldEmitToast (dedupe)");
check("first arrival of a verb → emit", shouldEmitToast(null, "archived") === true);
check("same verb already emitted → do NOT re-emit (re-render / Back)", shouldEmitToast("archived", "archived") === false);
check("a different verb after one → emit", shouldEmitToast("archived", "created") === true);
check("absent verb → never emit", shouldEmitToast("archived", null) === false);
check("error result carries no ok verb → never emit a success toast", shouldEmitToast(null, null) === false);

// ===========================================================================
// C. Verb registry + SK/EN/DE message parity
// ===========================================================================
console.log("\nC. verb registry & locale parity");
check("FAMILY_TOAST_VERBS matches the action ?ok= verb set", JSON.stringify([...FAMILY_TOAST_VERBS].sort()) === JSON.stringify([...ACTION_VERBS].sort()),
  `${JSON.stringify([...FAMILY_TOAST_VERBS].sort())} vs ${JSON.stringify([...ACTION_VERBS].sort())}`);
for (const v of ACTION_VERBS) check(`isFamilyToastVerb("${v}")`, isFamilyToastVerb(v));
check('isFamilyToastVerb rejects an unknown token', !isFamilyToastVerb("nope"));
for (const loc of LOCALES) {
  const m = familyDict(loc as Locale).feedback.messages;
  for (const v of ACTION_VERBS) {
    const specific = typeof m[v] === "string" && m[v]!.length > 0;
    check(`[${loc}] verb "${v}" has a specific message`, specific, `missing feedback.messages.${v}`);
  }
  // A real verb must resolve to its OWN message, not the generic fallback.
  check(`[${loc}] known verb does not fall back to generic`, familyToastMessage("archived", m, familyDict(loc as Locale).feedback.saved) === m.archived);
}

// ===========================================================================
// D. Source invariants — the toaster component
// ===========================================================================
console.log("\nD. FamilyToaster source invariants");
const toaster = read("app/family/family-feedback.tsx");
const code = stripComments(toaster);
check("has an aria-live region", /aria-live=/.test(code));
check("region is polite", /aria-live="polite"/.test(code));
check("Escape dismisses the toast", /e\.key === "Escape"/.test(code) && /setMessage\(null\)/.test(code));
check("auto-dismisses on a timer", /setTimeout\(\s*\(\)\s*=>\s*setMessage\(null\)/.test(code));
check("strips ?ok= from the URL synchronously (show-once + no replay on refresh/Back)", /\.delete\("ok"\)/.test(code) && /history\.replaceState/.test(code));
check("renders from client state (message), not the live ?ok= param", /\{message \?/.test(code));
check("dedupes with a last-token ref", /lastToken/.test(code) && /shouldEmitToast/.test(code));
check("SUCCESS-ONLY: never reads the ?e= error param (inline errors untouched)", !/get\("e"\)/.test(code) && !/params\.get\(["']e["']\)/.test(code));
check("no window.confirm / alert", !/window\.confirm|alert\(/.test(code));

// The success/error split lives in the pages: destructive actions still return their safe error
// GROUP for the inline banner. Spot-check the profiles page keeps inline errors and adds no
// success banner (success is the toast).
const profiles = stripComments(read("app/family/(console)/profiles/page.tsx"));
check("profiles page keeps inline error banner (danger only)", /banner\?\.tone === "danger"/.test(profiles));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — FAMILY-UI-02B success toast: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
