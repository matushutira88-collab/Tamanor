/**
 * META LEAD FETCH FAILURE CLASSIFICATION — targeted observability tests.
 *
 * Proves that a failed `GET /{leadgen_id}` now emits the EXISTING `business.meta_lead_fetch_failed` ops event
 * carrying only SAFE provider-supplied classification (kind, HTTP status, Graph code/subcode, transient flag,
 * fbtrace id), that an untyped error collapses to `reason: "unknown"`, and that NOTHING sensitive can reach the
 * sink: no error message, no Meta `message` text, no raw body, no access token, no app secret, no appsecret
 * proof, no `leadgen_id`, no tenant/account/Page id, no form data or PII.
 *
 * NO network and NO database: the ops sink is captured in-memory and the errors are constructed directly.
 */
import { readFileSync } from "node:fs";
import { setOpsSink, resetOpsSink } from "@guardora/core";
import { MetaGraphError } from "@guardora/connectors";
import { classifyMetaLeadFetchError, emitMetaLeadFetchFailed } from "../src/meta-leads";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// ---- forbidden values planted in EVERY unsafe slot of the error ------------------------------------------
const TOKEN = "SECRET_PAGE_TOKEN_do_not_leak";
const APP_SECRET = "SECRET_APP_SECRET_do_not_leak";
const PROOF = "PROOF_appsecret_do_not_leak";
const LEADGEN_ID = "LEADGENID_1234567890";
const PAGE_ID = "PAGEID_9876543210";
const TENANT_ID = "TENANTID_abcdef";
const ACCOUNT_ID = "ACCOUNTID_uvwxyz";
const PII = "Jane Doe jane@lead.test +421900111222 Acme";
const RAW_BODY = `{"error":{"message":"Unsupported get request. Object with ID '${LEADGEN_ID}' does not exist","code":100}}`;
const FORBIDDEN = [TOKEN, APP_SECRET, PROOF, LEADGEN_ID, PAGE_ID, TENANT_ID, ACCOUNT_ID, PII, RAW_BODY, "appsecret_proof", "access_token"];

/** A typed Graph error whose MESSAGE and `metaMessage` are stuffed with everything that must never be logged. */
function poisonedGraphError(over: Partial<MetaGraphError["detail"]> = {}): MetaGraphError {
  return new MetaGraphError(
    `Meta Graph GET /${LEADGEN_ID} failed for page ${PAGE_ID} tenant ${TENANT_ID} token ${TOKEN} proof ${PROOF}`,
    {
      status: 400, code: 100, subcode: 33, type: "GraphMethodException",
      kind: "generic", retryable: false,
      metaMessage: `Unsupported get request. Object with ID '${LEADGEN_ID}' does not exist. ${PII} ${RAW_BODY}`,
      fbtraceId: "Ah6D6FDXlpXhDq1EkDG9VsD",
      ...over,
    },
  );
}

// ---- ops sink capture --------------------------------------------------------------------------------------
const emitted: Array<{ event: string; meta: Record<string, unknown> }> = [];
setOpsSink({ emit: (event, meta) => { emitted.push({ event, meta }); } });

console.log("\n1) classification of the typed Meta Graph error");
{
  const c = classifyMetaLeadFetchError(poisonedGraphError());
  check("1a) reason = the typed error kind", c.reason === "generic");
  check("1b) HTTP status classified", c.status === 400);
  check("1c) Graph error code classified", c.code === 100);
  check("1d) Graph error subcode classified", c.subcode === 33);
  check("1e) transient flag classified", c.transient === false);
  check("1f) fbtrace id carried (existing OAuth-callback logging policy permits it)", c.fbtraceId === "Ah6D6FDXlpXhDq1EkDG9VsD");
  const keys = Object.keys(c).sort().join(",");
  check("1g) NO field beyond the safe allow-list", keys === "code,fbtraceId,reason,status,subcode,transient", keys);
  check("1h) message / metaMessage / type never classified",
    !("message" in c) && !("metaMessage" in c) && !("type" in c) && !("detail" in c));
}
{
  // Every kind the typed error can carry maps straight through as `reason`.
  const kinds: Array<MetaGraphError["detail"]["kind"]> = ["token_expired", "permission", "rate_limit", "generic", "timeout", "network", "server_error", "invalid_response"];
  const ok = kinds.every((k) => classifyMetaLeadFetchError(poisonedGraphError({ kind: k })).reason === k);
  check("1i) every Graph error kind is classified verbatim as `reason`", ok);
  check("1j) a retryable transport failure reports transient=true",
    classifyMetaLeadFetchError(poisonedGraphError({ kind: "rate_limit", retryable: true })).transient === true);
}
{
  // Codes Meta did not supply are OMITTED, never guessed or zero-filled.
  const c = classifyMetaLeadFetchError(new MetaGraphError("x", { status: 0, kind: "network", retryable: true }));
  check("1k) absent code/subcode/fbtrace omitted (never fabricated)",
    !("code" in c) && !("subcode" in c) && !("fbtraceId" in c) && c.reason === "network" && c.status === 0);
}

console.log("\n2) unknown / untyped errors");
{
  const c = classifyMetaLeadFetchError(new Error(`boom ${TOKEN} ${LEADGEN_ID} ${PII}`));
  check("2a) plain Error → reason 'unknown' only", c.reason === "unknown" && Object.keys(c).length === 1);
  const c2 = classifyMetaLeadFetchError({ message: TOKEN, response: RAW_BODY });
  check("2b) arbitrary thrown object → reason 'unknown' only", c2.reason === "unknown" && Object.keys(c2).length === 1);
  check("2c) string / null / undefined → reason 'unknown'",
    classifyMetaLeadFetchError(TOKEN).reason === "unknown"
    && classifyMetaLeadFetchError(null).reason === "unknown"
    && classifyMetaLeadFetchError(undefined).reason === "unknown");
  const dump = JSON.stringify([c, c2, classifyMetaLeadFetchError(TOKEN)]);
  check("2d) unknown-path output contains NO forbidden value", FORBIDDEN.every((f) => !dump.includes(f)), dump);
}

console.log("\n3) the emitted ops event");
{
  emitted.length = 0;
  emitMetaLeadFetchFailed(poisonedGraphError());
  check("3a) exactly one event emitted", emitted.length === 1);
  const e = emitted[0]!;
  check("3b) the EXISTING event name is preserved", e.event === "business.meta_lead_fetch_failed");
  check("3c) the existing `operation` label is preserved", e.meta.operation === "meta_leadgen");
  check("3d) classification present on the event",
    e.meta.reason === "generic" && e.meta.status === 400 && e.meta.code === 100 && e.meta.subcode === 33 && e.meta.transient === false);
  check("3e) fbtrace id present on the event", e.meta.fbtraceId === "Ah6D6FDXlpXhDq1EkDG9VsD");
  const keys = Object.keys(e.meta).sort().join(",");
  check("3f) event carries NO key beyond operation + the safe classification",
    keys === "code,fbtraceId,operation,reason,status,subcode,transient", keys);
}
{
  emitted.length = 0;
  emitMetaLeadFetchFailed(new Error(`fatal ${TOKEN} ${APP_SECRET} ${PII}`));
  const e = emitted[0]!;
  check("3g) untyped error emits only operation + reason=unknown",
    e.meta.operation === "meta_leadgen" && e.meta.reason === "unknown" && Object.keys(e.meta).length === 2);
}

console.log("\n4) no secret / PII can reach the sink");
{
  emitted.length = 0;
  // Emit through every path a production failure could take.
  emitMetaLeadFetchFailed(poisonedGraphError());
  emitMetaLeadFetchFailed(poisonedGraphError({ kind: "permission", retryable: false }));
  emitMetaLeadFetchFailed(poisonedGraphError({ kind: "token_expired", code: 190, subcode: 463 }));
  emitMetaLeadFetchFailed(new Error(`boom ${TOKEN} ${APP_SECRET} ${PROOF} ${PII} ${RAW_BODY}`));
  emitMetaLeadFetchFailed(`${TOKEN} ${LEADGEN_ID}`);
  const dump = JSON.stringify(emitted);
  check("4a) emitted events were actually captured (assertions below are meaningful)", emitted.length === 5);
  for (const [name, value] of [
    ["access token", TOKEN], ["app secret", APP_SECRET], ["appsecret proof", PROOF],
    ["leadgen_id", LEADGEN_ID], ["Page id", PAGE_ID], ["tenant id", TENANT_ID], ["account id", ACCOUNT_ID],
    ["PII / form data", PII], ["raw response body", RAW_BODY],
  ] as const) {
    check(`4b) sink contains NO ${name}`, !dump.includes(value));
  }
  check("4c) sink contains NO error message text", !dump.includes("Meta Graph GET") && !dump.includes("Unsupported get request") && !dump.includes("boom") && !dump.includes("fatal"));
  check("4d) sink contains NO 'message'/'metaMessage'/'stack' key", !/"(message|metaMessage|stack)"/.test(dump));
}

console.log("\n5) source invariants (the catch must not re-introduce a leak)");
{
  const src = readFileSync(new URL("../src/meta-leads.ts", import.meta.url), "utf8");
  check("5a) the fetch catch delegates to the safe emitter", /catch \(fetchErr\) \{[\s\S]*?emitMetaLeadFetchFailed\(fetchErr\)/.test(src));
  check("5b) fail-closed behaviour preserved: errorCode stays 'fetch_failed'", /errorCode: "fetch_failed"/.test(src));
  check("5c) fail-closed behaviour preserved: counter + continue still run", /res\.fetchFailures\+\+;\s*\n\s*continue;/.test(src));
  check("5d) metaMessage is NEVER referenced in this module", !/metaMessage/.test(src));
  check("5e) no error `.message` is read anywhere in this module", !/\.message/.test(src));
}

resetOpsSink();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead fetch classification: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
