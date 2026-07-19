/**
 * V1.42B — RENDERED truth test for the shared inbox mutation-feedback layer (`inbox-ux`). This is
 * the ONE piece of the interactive UI that is cleanly unit-renderable (the LabelSelector /
 * AssigneeSelector / NotesSection / BulkActionBar / InboxControls are coupled to Next server
 * actions — `next/cache` — and are render-tested end-to-end by the real browser suite instead,
 * e2e/inbox.spec.ts). Here we assert the honest-error contract: every repository reason maps to a
 * safe human string, unknown reasons fall back generically, and NO raw SQL / Prisma / token / note
 * body is ever surfaced.
 *
 * Run: pnpm inbox-ux:test
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonText, ActionNotice } from "../src/app/dashboard/comments/inbox-ux";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// The full set of machine reasons the repository / server actions can return.
const REASONS = [
  "not_found", "assignee_not_member", "assignee_required", "duplicate_label", "invalid_name",
  "item_or_label_missing", "item_missing", "empty_note", "note_too_long", "not_found_or_not_author",
  "action_not_bulk_eligible", "empty_selection", "priority_required", "status_required",
  "permission_denied", "label_required",
];

function run() {
  console.log("Inbox mutation-feedback (inbox-ux) — rendered truth\n");

  // 1) Every known reason maps to a non-empty, human (non-machine) string.
  const allMapped = REASONS.every((r) => { const t = reasonText(r, "en"); return t.length > 0 && t !== r && !t.includes("_"); });
  check("1) every repository reason maps to human text (no raw machine codes)", allMapped);

  // 2) Unknown / adversarial reasons fall back generically — never echoed back verbatim.
  const leaky = [
    "SELECT * FROM inbox_notes", "PrismaClientKnownRequestError", "P2002",
    "Bearer sk_live_abcdef", "the secret note body text", "at Object.<anonymous> (repo.ts:1)",
  ];
  const noLeak = leaky.every((r) => { const t = reasonText(r, "en"); return t === "That action could not be completed." && !t.includes(r); });
  check("2) unknown/adversarial reasons never leak (SQL/Prisma/token/stack/body)", noLeak);

  // 3) ActionNotice renders the correct semantic tone + testable marker, and escapes content.
  const ok = renderToStaticMarkup(<ActionNotice msg={{ kind: "ok", text: "Saved" }} />);
  const err = renderToStaticMarkup(<ActionNotice msg={{ kind: "error", text: "Nope" }} />);
  const none = renderToStaticMarkup(<ActionNotice msg={null} />);
  check("3) ActionNotice: ok tone + role=status", /data-inbox-msg="ok"/.test(ok) && /role="status"/.test(ok) && ok.includes("Saved"));
  check("4) ActionNotice: error tone", /data-inbox-msg="error"/.test(err) && err.includes("Nope"));
  check("5) ActionNotice: renders nothing when there is no message", none === "");

  // 4) No raw HTML injection — React escapes the message text.
  const xss = renderToStaticMarkup(<ActionNotice msg={{ kind: "error", text: "<img src=x onerror=alert(1)>" }} />);
  check("6) ActionNotice escapes message text (no raw HTML)", !xss.includes("<img src=x") && xss.includes("&lt;img"));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — inbox-ux rendered truth (${REASONS.length} reasons)`);
  if (failures > 0) process.exit(1);
}

run();
