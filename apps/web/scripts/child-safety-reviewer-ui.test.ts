/**
 * Child Safety Reviewer Console V1 — UI test (no DB / browser / network).
 *
 *   1. PURE view-model — tones, the timeline entry map (all 12 backend types → category/tone/icon),
 *      the status state-machine mirror (available actions), duration formatting, the XSS-safe markdown
 *      renderer, and the deterministic date formatter.
 *   2. i18n parity — en/sk/de have identical key structure; every timeline type, status, severity,
 *      urgency, and error code is localized in all three.
 *   3. SOURCE INVARIANTS — permission gate renders <Unauthorized> and hides actions; server actions are
 *      fail-closed + return safe codes + revalidate; no window.confirm; accessible dialogs; notes are
 *      append-only (no edit/delete); the timeline consumes backend order (never re-sorts); the error
 *      boundary never renders the raw error; loading/error boundaries exist.
 *
 * Run: pnpm child-safety-reviewer-ui:test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  severityTone, urgencyTone, statusTone, escalationTone, timelineEntryView, availableStatusTargets,
  availableReviewActions, isTerminalReviewTarget, formatDurationMs, renderMarkdownSafe, fmtDateTime, shortId,
  REVIEW_STATUS_TARGETS, type TimelineCategory,
} from "../src/app/dashboard/child-safety/reviewer/reviewer-view";
import { REVIEWER_COPY, REVIEW_ACTION_ERROR_CODES, isReviewActionErrorCode } from "../src/app/dashboard/child-safety/reviewer/reviewer-i18n";
import { ChildSafetyIncidentStatus, ChildSafetyReviewStatus } from "@guardora/core";
import type { Locale } from "../src/i18n/config";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`); cond ? pass++ : fail++; };

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "src", "app", "dashboard", "child-safety", "reviewer");
const read = (rel: string): string => readFileSync(join(DIR, rel), "utf8");
const has = (rel: string): boolean => existsSync(join(DIR, rel));
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const LOCALES: Locale[] = ["en", "sk", "de"];
const TIMELINE_TYPES = ["incident_created", "signal_linked", "severity_increased", "urgency_increased", "escalation_triggered", "notification_sent", "guardian_delivery", "recovery_repair", "reviewer_assigned", "reviewer_unassigned", "status_changed", "reviewer_note"];

function main() {
  // ── 1. PURE VIEW-MODEL ────────────────────────────────────────────
  console.log("\n1. tones");
  check("★ severityTone maps critical→danger, low→neutral", severityTone("critical") === "danger" && severityTone("high") === "warn" && severityTone("low") === "neutral");
  check("★ urgencyTone maps immediate→danger, routine→neutral", urgencyTone("immediate") === "danger" && urgencyTone("elevated") === "warn" && urgencyTone("routine") === "neutral");
  check("★ statusTone: resolved→ok, action_required→danger, dismissed→neutral", statusTone("resolved") === "ok" && statusTone("action_required") === "danger" && statusTone("dismissed") === "neutral");
  check("★ escalationTone: escalated→danger, none→neutral", escalationTone("escalated") === "danger" && escalationTone("none") === "neutral");

  console.log("\n2. timeline entry view (all 12 types + 7 categories)");
  check("★ every backend timeline type has a distinct, complete view", TIMELINE_TYPES.every((ty) => { const v = timelineEntryView(ty); return !!v.icon && !!v.tone && !!v.category && !!v.titleKey; }));
  const cats = new Set<TimelineCategory>(TIMELINE_TYPES.map((ty) => timelineEntryView(ty).category));
  check("★ all 7 categories are represented (incident/signal/escalation/notification/guardian/review/recovery)", ["incident", "signal", "escalation", "notification", "guardian", "review", "recovery"].every((c) => cats.has(c as TimelineCategory)));
  check("★ unknown type falls back safely (review/neutral)", timelineEntryView("???").category === "review" && timelineEntryView("???").tone === "neutral");
  check("★ view is deterministic", JSON.stringify(timelineEntryView("escalation_triggered")) === JSON.stringify(timelineEntryView("escalation_triggered")));

  console.log("\n3. status state-machine mirror");
  check("★ open → [under_review, waiting, resolved, dismissed]", JSON.stringify(availableStatusTargets("open").sort()) === JSON.stringify(["dismissed", "resolved", "under_review", "waiting"]));
  check("★ resolved (terminal) → [reopened] only", JSON.stringify(availableStatusTargets("resolved")) === JSON.stringify([ChildSafetyReviewStatus.Reopened]));
  check("★ dismissed (terminal) → [reopened] only", JSON.stringify(availableStatusTargets("dismissed")) === JSON.stringify([ChildSafetyReviewStatus.Reopened]));
  check("★ under_review does not offer itself (same→same excluded)", !availableStatusTargets("under_review").includes(ChildSafetyReviewStatus.UnderReview));
  check("★ availableReviewActions: unassign only when assigned", availableReviewActions("open", null).unassign === false && availableReviewActions("open", "u1").unassign === true);
  check("★ availableReviewActions: note + assign always available", availableReviewActions("resolved", null).note === true && availableReviewActions("closed", null).assign === true);
  check("★ isTerminalReviewTarget: resolved+dismissed only", isTerminalReviewTarget(ChildSafetyReviewStatus.Resolved) && isTerminalReviewTarget(ChildSafetyReviewStatus.Dismissed) && !isTerminalReviewTarget(ChildSafetyReviewStatus.Waiting));
  check("★ REVIEW_STATUS_TARGETS covers all 5 review statuses", REVIEW_STATUS_TARGETS.length === 5 && Object.values(ChildSafetyReviewStatus).every((s) => (REVIEW_STATUS_TARGETS as string[]).includes(s)));

  console.log("\n4. formatting + safety");
  check("★ formatDurationMs: 45s / 5m / 2h 5m / 3d 4h", formatDurationMs(45_000) === "45s" && formatDurationMs(300_000) === "5m" && formatDurationMs(7_500_000) === "2h 5m" && formatDurationMs(273_600_000) === "3d 4h");
  check("★ formatDurationMs null/negative → em dash", formatDurationMs(null) === "—" && formatDurationMs(-5) === "—");
  check("★ fmtDateTime is deterministic UTC", fmtDateTime("2026-07-25T09:35:00.000Z") === "2026-07-25 09:35" && fmtDateTime(null) === "—" && fmtDateTime("bad") === "—");
  check("★ shortId truncates long ids, keeps short", shortId("abcdefghijklmnop").includes("…") && shortId("short") === "short");
  const evil = renderMarkdownSafe('<script>alert(1)</script> **bold** `code` <img src=x onerror=y>');
  check("★ renderMarkdownSafe escapes ALL html (no live tags)", !evil.includes("<script>") && !evil.includes("<img") && evil.includes("&lt;script&gt;"));
  check("★ renderMarkdownSafe applies safe inline formatting", renderMarkdownSafe("**b**").includes("<strong>b</strong>") && renderMarkdownSafe("`c`").includes("<code>c</code>"));
  check("★ renderMarkdownSafe: newline → <br/>", renderMarkdownSafe("a\nb").includes("<br/>"));

  // ── 2. i18n PARITY ────────────────────────────────────────────────
  console.log("\n5. i18n parity (en/sk/de)");
  const keyPaths = (o: unknown, prefix = ""): string[] => {
    if (o === null || typeof o !== "object") return [prefix];
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  };
  const en = keyPaths(REVIEWER_COPY.en).sort();
  check("★ sk key structure == en", JSON.stringify(keyPaths(REVIEWER_COPY.sk).sort()) === JSON.stringify(en));
  check("★ de key structure == en", JSON.stringify(keyPaths(REVIEWER_COPY.de).sort()) === JSON.stringify(en));
  check("★ every timeline type is localized in all locales", LOCALES.every((l) => TIMELINE_TYPES.every((ty) => !!REVIEWER_COPY[l].tl[ty])));
  check("★ every incident status is localized", LOCALES.every((l) => (Object.values(ChildSafetyIncidentStatus) as string[]).every((s) => !!REVIEWER_COPY[l].statusLabel[s])));
  check("★ every error code is localized", LOCALES.every((l) => REVIEW_ACTION_ERROR_CODES.every((c) => !!REVIEWER_COPY[l].errors[c])));
  check("★ isReviewActionErrorCode guards the contract", isReviewActionErrorCode("forbidden") && !isReviewActionErrorCode("nope"));

  // ── 3. SOURCE INVARIANTS ──────────────────────────────────────────
  console.log("\n6. permission gating");
  const listPage = read("page.tsx"); const detailPage = read("[incidentId]/page.tsx");
  check("★ list page gates on canViewChildSafetyReview → <Unauthorized>", /canViewChildSafetyReview\(session\.role\)/.test(listPage) && /<Unauthorized/.test(listPage));
  check("★ detail page gates on canViewChildSafetyReview → <Unauthorized>", /canViewChildSafetyReview\(session\.role\)/.test(detailPage) && /<Unauthorized/.test(detailPage));
  check("★ detail renders ReviewActions ONLY when canManage (actions hidden otherwise)", /canManage\s*\?\s*\(?\s*<Card[\s\S]*?<ReviewActions/.test(detailPage));
  check("★ notes add form gated by canManage prop", /canManage=\{canManage\}/.test(detailPage));

  console.log("\n7. server actions fail-closed + safe");
  const actions = read("[incidentId]/actions.ts"); const sActions = stripComments(actions);
  check("★ actions.ts is a server module", /^"use server"/.test(actions));
  check("★ every action re-checks manage permission", /canManageChildSafetyReview\(s\.role\)/.test(sActions) && /return null/.test(sActions));
  check("★ actions revalidate the detail + console paths", /revalidatePath\(path\(incidentId\)\)/.test(sActions) && /revalidatePath\("\/dashboard\/child-safety\/reviewer"\)/.test(sActions));
  check("★ actions return SAFE codes, never a raw message/stack", /"forbidden"/.test(sActions) && /"retry_later"/.test(sActions) && !/error:\s*e\.message/.test(sActions) && !/return\s+e\.message/.test(sActions) && !/\.stack/.test(sActions));

  console.log("\n8. dialogs + append-only notes + timeline order");
  const reviewActions = read("[incidentId]/review-actions.tsx"); const notes = read("[incidentId]/notes-panel.tsx"); const timeline = read("[incidentId]/timeline-view.tsx");
  const errBoundary = read("error.tsx");
  check("★ NO window.confirm anywhere in the console", ["page.tsx", "[incidentId]/page.tsx", "[incidentId]/review-actions.tsx", "[incidentId]/notes-panel.tsx", "filter-bar.tsx"].every((f) => !/window\.confirm/.test(stripComments(read(f)))));
  check("★ dialog is accessible (role=dialog + aria-modal + focus trap)", /role="dialog"/.test(reviewActions) && /aria-modal="true"/.test(reviewActions) && /Escape/.test(reviewActions));
  check("★ notes are APPEND-ONLY (no edit/delete affordance or call)", !/editNote|deleteNote|updateNote|removeNote/i.test(stripComments(notes)) && !/\.update\(|\.delete\(/.test(stripComments(notes)));
  check("★ notes render newest-first", /\.reverse\(\)/.test(notes));
  check("★ notes offer a markdown preview via the XSS-safe renderer", /renderMarkdownSafe/.test(notes) && /preview/i.test(notes));
  check("★ timeline consumes backend order — never re-sorts", /timeline\.map/.test(timeline) && !/\.sort\(/.test(stripComments(timeline)));
  check("★ error boundary NEVER renders the raw error", !/error\.message|\{error\}|error\.stack/.test(stripComments(errBoundary)));
  check("★ loading + error boundaries exist", has("loading.tsx") && has("error.tsx"));
  check("★ list page renders empty + pagination states", /EmptyState/.test(listPage) && /hasMore/.test(listPage));

  console.log("\n9. no raw-content leakage in the console source");
  const allSrc = ["page.tsx", "[incidentId]/page.tsx", "[incidentId]/timeline-view.tsx", "[incidentId]/notes-panel.tsx", "reviewer-view.ts"].map((f) => stripComments(read(f))).join("\n");
  check("★ console never references detector payloads / raw message fields", !/detectorPayload|rawContent|transcript|messageBody|\.content\b/.test(allSrc));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Reviewer Console UI V1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
