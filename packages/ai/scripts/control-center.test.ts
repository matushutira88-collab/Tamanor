/**
 * Control Center engine tests. Run via: pnpm control:test
 * The safety-critical heart: modes, allowed actions, the hard safety layer
 * (normal criticism / refund / legal / safety complaints never autonomous),
 * confidence downgrade, presets, and incident categories. No execution here.
 */
import {
  evaluateControl, matchControlCategory, presetPolicies, PRESETS, NEVER_AUTONOMOUS,
  INCIDENT_CATEGORIES, CONTROL_CATEGORIES, type ControlPolicyLite,
} from "../src/control-center";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const pol = (category: string, mode: string, over: Partial<ControlPolicyLite> = {}): ControlPolicyLite =>
  ({ category, mode, minConfidence: 0.7, isActive: true, ...over });
const evalIt = (over: Partial<Parameters<typeof evaluateControl>[0]>, policies: ControlPolicyLite[]) =>
  evaluateControl({ text: "", riskSignals: [], categories: [], sentiment: "negative", riskLevel: "critical", confidence: 0.9, ...over }, policies);

function run() {
  // 6) monitor never creates an executable action.
  {
    const d = evalIt({ riskSignals: ["scam"] }, [pol("scam", "monitor")]);
    check("6) monitor → no execution", d.queueState === "monitor" && !d.wouldExecute && d.proposedAction === "create_inbox_item", `${d.queueState}/${d.proposedAction}`);
  }
  // 7) assist suggests only.
  {
    const d = evalIt({ riskSignals: ["profanity"] }, [pol("profanity", "assist")]);
    check("7) assist → suggest_reply, not executable", d.proposedAction === "suggest_reply" && d.queueState === "suggested" && !d.wouldExecute, d.proposedAction);
  }
  // 8) approval creates an approval request.
  {
    const d = evalIt({ riskSignals: ["personal_attack"], categories: ["harassment"] }, [pol("personal_attack", "approval")]);
    check("8) approval → approval_required", d.queueState === "approval_required" && d.proposedAction === "request_approval", d.queueState);
  }
  // 9) autonomous only for an allowed category → candidate (dry-run), never live.
  {
    const d = evalIt({ riskSignals: ["scam"] }, [pol("scam", "autonomous")]);
    check("9) autonomous (scam) → dry_run candidate, wouldExecute, not live", d.queueState === "dry_run" && d.wouldExecute && d.proposedAction === "hide_comment", `${d.queueState}/${d.wouldExecute}`);
  }
  // 10) normal_criticism never autonomous.
  {
    const d = evaluateControl({ text: "the delivery was slow, disappointing", riskSignals: ["complaint"], categories: [], sentiment: "negative", riskLevel: "low", confidence: 0.9 }, [pol("normal_criticism", "autonomous")]);
    check("10) normal_criticism autonomous → blocked_by_safety", d.matchedCategory === "normal_criticism" && d.queueState === "blocked_by_safety" && d.safetyBlocked && !d.wouldExecute, `${d.matchedCategory}/${d.queueState}`);
  }
  // 11) refund/legal/safety complaints never autonomous.
  {
    const refund = evaluateControl({ text: "I want a refund immediately", riskSignals: [], categories: [], sentiment: "negative", riskLevel: "none", confidence: 0.9 }, [pol("refund_complaint", "autonomous")]);
    check("11) refund_complaint → never autonomous", refund.matchedCategory === "refund_complaint" && refund.safetyBlocked && !refund.wouldExecute, `${refund.matchedCategory}/${refund.queueState}`);
    const legal = evaluateControl({ text: "I am calling my lawyer about this", riskSignals: [], categories: [], sentiment: "negative", riskLevel: "none", confidence: 0.9 }, [pol("legal_complaint", "autonomous")]);
    check("11) legal_complaint → never autonomous", legal.matchedCategory === "legal_complaint" && legal.safetyBlocked, `${legal.matchedCategory}`);
    const safety = evaluateControl({ text: "your product gave me an injury, unsafe", riskSignals: [], categories: [], sentiment: "negative", riskLevel: "none", confidence: 0.9 }, [pol("safety_claim", "autonomous")]);
    check("11) safety_claim → never autonomous", safety.matchedCategory === "safety_claim" && safety.safetyBlocked, `${safety.matchedCategory}`);
  }
  // 12) low confidence → approval.
  {
    const d = evalIt({ riskSignals: ["scam"], confidence: 0.6 }, [pol("scam", "autonomous")]);
    check("12) low confidence autonomous → approval", d.queueState === "approval_required" && !d.wouldExecute, d.queueState);
  }
  // 13) disabled policy → monitor/no action.
  {
    const d = evalIt({ riskSignals: ["scam"] }, [pol("scam", "autonomous", { isActive: false })]);
    check("13) disabled policy → monitor, no execution", d.mode === "none" && d.queueState === "monitor" && !d.wouldExecute, `${d.mode}/${d.queueState}`);
  }
  // Presets: never-autonomous categories are never autonomous.
  {
    for (const preset of ["conservative", "balanced", "aggressive"] as const) {
      const policies = presetPolicies(preset);
      const bad = policies.filter((p) => NEVER_AUTONOMOUS.has(p.category) && p.mode === "autonomous");
      check(`preset ${preset}: no never-autonomous category is autonomous`, bad.length === 0, bad.map((b) => b.category).join(","));
      check(`preset ${preset}: covers all ${CONTROL_CATEGORIES.length} categories`, policies.length === CONTROL_CATEGORIES.length);
    }
    check("conservative: spam autonomous, personal_attack approval", PRESETS.conservative.spam === "autonomous" && PRESETS.conservative.personal_attack === "approval");
    check("aggressive: personal_attack autonomous", PRESETS.aggressive.personal_attack === "autonomous");
  }
  // Incidents: crisis/threat/coordinated/legal/safety raise incidents.
  {
    check("incident categories include crisis/threat/coordinated/legal/safety", INCIDENT_CATEGORIES.has("crisis_keyword") && INCIDENT_CATEGORIES.has("threat") && INCIDENT_CATEGORIES.has("coordinated_attack") && INCIDENT_CATEGORIES.has("legal_complaint") && INCIDENT_CATEGORIES.has("safety_claim"));
    const d = evalIt({ riskSignals: ["legal_threat"] }, [pol("threat", "approval")]);
    check("threat item raisesIncident", d.raisesIncident);
  }
  // Category detection: positive + question.
  {
    check("positive feedback detected", matchControlCategory({ text: "love this, thanks!", riskSignals: [], categories: [], sentiment: "positive", riskLevel: "none" }) === "positive_feedback");
    check("customer question detected", matchControlCategory({ text: "do you ship to Germany?", riskSignals: [], categories: [], sentiment: "neutral", riskLevel: "none" }) === "customer_question");
  }
  // No execution field on the decision (would_execute is a flag, not an action).
  {
    const d = evalIt({ riskSignals: ["scam"] }, [pol("scam", "autonomous")]);
    check("decision has no 'executed'/'hidden' field", !("executed" in (d as Record<string, unknown>)) && !("hidden" in (d as Record<string, unknown>)));
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Control Center engine`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
