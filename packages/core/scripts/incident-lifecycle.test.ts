/**
 * C3 — canonical Incident lifecycle: transitions, mandatory reason, terminal,
 * reopen. Pure, no DB. Run: pnpm incident-lifecycle:test
 */
import {
  IncidentLifecycleStatus as S,
  canTransitionIncident,
  incidentTransitionRequiresReason,
  TERMINAL_INCIDENT_STATUSES,
} from "../src/security";
import { applyIncidentTransition } from "../src/cyberbullying-incident";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// --- Allowed forward transitions ---
check("open → under_review", canTransitionIncident(S.Open, S.UnderReview));
check("open → dismissed", canTransitionIncident(S.Open, S.Dismissed));
check("under_review → acknowledged/confirmed/dismissed", canTransitionIncident(S.UnderReview, S.Acknowledged) && canTransitionIncident(S.UnderReview, S.Confirmed) && canTransitionIncident(S.UnderReview, S.Dismissed));
check("acknowledged → confirmed/action_required/resolved/dismissed", [S.Confirmed, S.ActionRequired, S.Resolved, S.Dismissed].every((t) => canTransitionIncident(S.Acknowledged, t)));
check("confirmed → action_required/resolved", canTransitionIncident(S.Confirmed, S.ActionRequired) && canTransitionIncident(S.Confirmed, S.Resolved));
check("action_required → resolved", canTransitionIncident(S.ActionRequired, S.Resolved));
check("resolved → archived", canTransitionIncident(S.Resolved, S.Archived));

// --- Forbidden transitions ---
check("open ✗→ confirmed (must go through review)", !canTransitionIncident(S.Open, S.Confirmed));
check("open ✗→ resolved", !canTransitionIncident(S.Open, S.Resolved));
check("confirmed ✗→ dismissed", !canTransitionIncident(S.Confirmed, S.Dismissed));
check("resolved ✗→ under_review (that is reopen only)", !canTransitionIncident(S.Resolved, S.UnderReview));
check("dismissed is terminal (no forward transition)", [S.UnderReview, S.Acknowledged, S.Confirmed, S.Resolved, S.Archived].every((t) => !canTransitionIncident(S.Dismissed, t)));
check("archived is terminal", [S.UnderReview, S.Resolved].every((t) => !canTransitionIncident(S.Archived, t)));
check("terminal set = dismissed + archived", [...TERMINAL_INCIDENT_STATUSES].sort().join(",") === "archived,dismissed");

// --- applyIncidentTransition: identity, mandatory reason, terminal ---
check("identity (open→open) → no_change", applyIncidentTransition(S.Open, S.Open).error === "no_change");
check("open→under_review ok (no reason needed)", applyIncidentTransition(S.Open, S.UnderReview).ok === true);
check("open→dismissed WITHOUT reason → reason_required", applyIncidentTransition(S.Open, S.Dismissed).error === "reason_required");
check("open→dismissed WITH reason → ok", applyIncidentTransition(S.Open, S.Dismissed, { reason: "false positive" }).ok === true);
check("acknowledged→confirmed WITHOUT reason → reason_required", applyIncidentTransition(S.Acknowledged, S.Confirmed).error === "reason_required");
check("acknowledged→confirmed WITH reason → ok", applyIncidentTransition(S.Acknowledged, S.Confirmed, { reason: "confirmed after review" }).ok === true);
check("resolved WITHOUT reason → reason_required", applyIncidentTransition(S.Acknowledged, S.Resolved).error === "reason_required");
check("open→confirmed (illegal) → illegal_transition", applyIncidentTransition(S.Open, S.Confirmed, { reason: "x" }).error === "illegal_transition");
check("from a terminal state (forward) → terminal", applyIncidentTransition(S.Dismissed, S.UnderReview).error === "terminal");

check("requires-reason set includes confirmed/action_required/resolved/dismissed/archived", [S.Confirmed, S.ActionRequired, S.Resolved, S.Dismissed, S.Archived].every((s) => incidentTransitionRequiresReason(s)));
check("under_review/acknowledged do NOT require a reason", !incidentTransitionRequiresReason(S.UnderReview) && !incidentTransitionRequiresReason(S.Acknowledged));

// --- Reopen (explicit, elevated) ---
check("reopen resolved→under_review WITH reason → ok", applyIncidentTransition(S.Resolved, S.UnderReview, { reopen: true, reason: "new evidence" }).ok === true);
check("reopen WITHOUT reason → reason_required", applyIncidentTransition(S.Resolved, S.UnderReview, { reopen: true }).error === "reason_required");
check("reopen dismissed→under_review ok", applyIncidentTransition(S.Dismissed, S.UnderReview, { reopen: true, reason: "re-examined" }).ok === true);
check("reopen archived→under_review ok", applyIncidentTransition(S.Archived, S.UnderReview, { reopen: true, reason: "audit" }).ok === true);
check("reopen open→under_review → illegal (open is not a reopen source)", applyIncidentTransition(S.Open, S.UnderReview, { reopen: true, reason: "x" }).ok === false);
check("reopen marks result.reopen=true", applyIncidentTransition(S.Resolved, S.UnderReview, { reopen: true, reason: "x" }).reopen === true);

// --- Determinism ---
check("deterministic", JSON.stringify(applyIncidentTransition(S.Acknowledged, S.Confirmed, { reason: "r" })) === JSON.stringify(applyIncidentTransition(S.Acknowledged, S.Confirmed, { reason: "r" })));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — incident lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
