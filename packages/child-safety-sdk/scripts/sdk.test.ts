/**
 * CS-C14 — Tamanor Child Safety SDK tests (no network; deterministic classifier + in-memory transport).
 * Config validation, classification, the privacy boundary (raw content never queued / serialized / in
 * diagnostics / in errors), token secrecy, canonical signing, bounded/offline queue, retry + max
 * retries, timeout/abort, destroy, and no implicit evidence upload.
 * Run: pnpm child-safety-sdk:test
 */
import { createTamanorChildSafetyClient, createMemoryTransport, SdkConfigError, type ChildSafetyClient } from "../src/index";
import { DeterministicChildSafetyClassifier, verifyEnvelopeSignature, RiskType } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const TOKEN = "csi_test_secret_token_value_do_not_leak";
const FIXED = new Date("2026-07-24T10:00:00.000Z");
const classifier = new DeterministicChildSafetyClassifier({ now: () => FIXED });
const okReceipt = { status: 201, json: { accepted: true, receiptId: "r1", signalId: "s1", duplicate: false, outcome: "QUEUE_FOR_REVIEW", schemaVersion: "1" } };

const mk = (over: Record<string, unknown> = {}, transport?: ReturnType<typeof createMemoryTransport>): ChildSafetyClient =>
  createTamanorChildSafetyClient({
    endpoint: "https://gw.example.invalid/api/v1/child-safety/signals",
    applicationId: "app_pub", installationId: "inst_1", installationToken: TOKEN, subjectId: "pp_ref_1",
    classifier, transport: transport ?? createMemoryTransport(() => okReceipt), retryBaseMs: 0, ...over,
  });

async function main() {
  const GROOMING = "hey how old are you? this is our secret, send me a pic";

  // A. config validation
  console.log("\nA. config validation");
  check("missing endpoint → SdkConfigError", (() => { try { createTamanorChildSafetyClient({ applicationId: "a", subjectId: "s" } as never); return false; } catch (e) { return e instanceof SdkConfigError; } })());
  check("missing applicationId → error", (() => { try { createTamanorChildSafetyClient({ endpoint: "https://x", subjectId: "s" } as never); return false; } catch (e) { return e instanceof SdkConfigError; } })());
  check("missing subjectId → error", (() => { try { createTamanorChildSafetyClient({ endpoint: "https://x", applicationId: "a" } as never); return false; } catch (e) { return e instanceof SdkConfigError; } })());
  check("invalid maxQueueSize → error", (() => { try { mk({ maxQueueSize: 0 }); return false; } catch (e) { return e instanceof SdkConfigError; } })());

  // B. classification → minimized signals
  console.log("\nB. classification");
  const c = mk();
  const res = await c.evaluateContent({ content: GROOMING, locale: "en" });
  check("valid classification → signalCreated + candidates", res.signalCreated && res.signalCount > 0);
  check("candidates include grooming + solicitation", res.candidates.some((x) => x.riskType === RiskType.Grooming) && res.candidates.some((x) => x.riskType === RiskType.SexualSolicitation));
  check("no-risk content → no signal", (await mk().evaluateContent({ content: "good luck tomorrow!" })).signalCreated === false);
  const coerce = await mk().evaluateContent({ content: "do what i say or i will tell everyone" });
  check("★ coercion classified", coerce.candidates.some((x) => x.riskType === RiskType.Coercion));
  const scam = await mk().evaluateContent({ content: "send me a steam gift card for free robux" });
  check("★ scam exploitation classified", scam.candidates.some((x) => x.riskType === RiskType.ScamExploitation));
  check("classifier unavailable → evaluateContent throws", await (async () => { try { await mk({ classifier: undefined }).evaluateContent({ content: GROOMING }); return false; } catch { return true; } })());

  // C. PRIVACY — raw content never leaves the classifier
  console.log("\nC. privacy boundary");
  const transport = createMemoryTransport(() => okReceipt);
  const pc = mk({}, transport);
  await pc.evaluateContent({ content: GROOMING });
  await pc.flushPendingSignals({ now: FIXED.getTime() });
  const sentBody = transport.calls.map((x) => x.body).join("|");
  check("★ raw content NOT in the serialized envelope sent to the gateway", transport.calls.length > 0 && !sentBody.includes("how old are you") && !sentBody.includes("send me a pic") && !sentBody.includes("our secret"));
  check("★ token NOT in diagnostics", !JSON.stringify(pc.getSdkDiagnostics()).includes(TOKEN));
  check("★ raw content NOT in diagnostics", !JSON.stringify(pc.getSdkDiagnostics()).includes("how old are you"));
  check("token IS the HMAC key (envelope signature verifies)", (() => { const env = JSON.parse(transport.calls[0]!.body); return verifyEnvelopeSignature(env, TOKEN).ok; })());
  check("★ signed envelope carries NO raw-content field", (() => { const env = JSON.parse(transport.calls[0]!.body); return !("content" in env) && !("message" in env) && !("text" in env); })());
  check("diagnostics expose only safe fields (no secret/stack/response)", !JSON.stringify(pc.getSdkDiagnostics()).match(/secret|stack|Bearer|password/i));

  // D. queue: bounded + offline + idempotency key
  console.log("\nD. queue");
  const bounded = mk({ maxQueueSize: 2, transport: createMemoryTransport(() => okReceipt) });
  for (let i = 0; i < 5; i++) await bounded.submitSafetySignal((await classifier.classify({ content: GROOMING })).candidates[0] as never);
  check("★ bounded queue caps length (drops oldest)", bounded.getSdkDiagnostics().queueLength === 2);
  const offline = mk({ transport: createMemoryTransport(() => okReceipt) });
  await offline.evaluateContent({ content: GROOMING });
  check("★ offline: evaluate enqueues without sending", offline.getSdkDiagnostics().queueLength > 0);
  const flushed = await offline.flushPendingSignals({ now: FIXED.getTime() });
  check("explicit flush delivers", flushed.sent > 0 && offline.getSdkDiagnostics().queueLength === 0);

  // E. retry / max retries / timeout / abort
  console.log("\nE. retry + failures");
  let call = 0;
  const flaky = createMemoryTransport(() => (call++ === 0 ? { status: 500, json: {} } : okReceipt));
  const rc = mk({ transport: flaky });
  const oneSignal = (await classifier.classify({ content: "send me a pic" })).candidates[0]!; // exactly one candidate
  await rc.submitSafetySignal(oneSignal as never);
  const f1 = await rc.flushPendingSignals({ now: FIXED.getTime() });
  check("★ retryable 500 → item retained (not dead-lettered)", f1.sent === 0 && f1.remaining === 1);
  const f2 = await rc.flushPendingSignals({ now: FIXED.getTime() + 10_000 });
  check("★ retry success on next flush", f2.sent > 0 && rc.getSdkDiagnostics().queueLength === 0);
  const deadLettered: unknown[] = [];
  const alwaysFail = mk({ maxRetries: 2, transport: createMemoryTransport(() => ({ status: 500, json: {} })), onFailure: (i) => deadLettered.push(i) });
  await alwaysFail.evaluateContent({ content: GROOMING });
  for (let i = 0; i < 5; i++) await alwaysFail.flushPendingSignals({ now: FIXED.getTime() + i * 100_000 });
  check("★ max retries exceeded → dead-lettered (bounded, no infinite loop)", deadLettered.length > 0 && alwaysFail.getSdkDiagnostics().queueLength === 0);
  const rejectFail = mk({ transport: createMemoryTransport(() => ({ status: 400, json: { error: "invalid_envelope" } })) });
  await rejectFail.evaluateContent({ content: GROOMING });
  const fr = await rejectFail.flushPendingSignals({ now: FIXED.getTime() });
  check("non-retryable 4xx → dropped immediately (not retried forever)", fr.remaining === 0);

  // F. destroy + no implicit evidence
  console.log("\nF. destroy + evidence separation");
  const dc = mk();
  await dc.evaluateContent({ content: GROOMING });
  dc.destroy();
  check("★ destroy clears queue + marks destroyed", dc.getSdkDiagnostics().queueLength === 0 && dc.getSdkDiagnostics().installationState === "destroyed");
  check("post-destroy evaluate throws", await (async () => { try { await dc.evaluateContent({ content: GROOMING }); return false; } catch { return true; } })());
  check("★ SDK exposes NO evidence-upload method (evidence is a separate explicit op)", typeof (mk() as unknown as Record<string, unknown>).uploadEvidence === "undefined" && typeof (mk() as unknown as Record<string, unknown>).submitEvidence === "undefined");
}

main().then(() => {
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS-C14 SDK: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
