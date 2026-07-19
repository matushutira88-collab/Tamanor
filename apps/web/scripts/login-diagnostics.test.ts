/**
 * V1.63 — login/first-render diagnostic instrumentation. PURE tests (no React/Next context, no DB, no
 * network). Covers the stable reference id, the fail-open phase logger, NEXT_REDIRECT handling, and the
 * client-error sink's validation / rate-limit / sanitize / cookie-clear behaviour.
 * Run: pnpm login-diagnostics:test
 */
import {
  newTraceId, readValidTraceId, isNextControlFlow, withPhase, logPhase, scrubMessage, type DiagSink,
} from "../src/server/diagnostics/login-trace";
import { handleClientErrorReport } from "../src/server/diagnostics/client-error-sink";
import { computeReferenceId, clientReportKey, newClientReference } from "../src/lib/client-diagnostics";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

const redirectError = () => Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
const captured = () => { const lines: Record<string, unknown>[] = []; const sink: DiagSink = (l) => lines.push(l); return { lines, sink }; };
const body = (o: Record<string, unknown>) => JSON.stringify(o);

async function run() {
  // --- traceId ------------------------------------------------------------------------------------
  check("11) two logins get DIFFERENT traceIds", newTraceId() !== newTraceId());
  check("traceId matches the t_<hex> contract", /^t_[a-f0-9]{12,64}$/.test(newTraceId()), newTraceId());
  check("readValidTraceId accepts a good id, rejects junk", !!readValidTraceId("t_0123456789ab") && readValidTraceId("../etc") === undefined && readValidTraceId("") === undefined);

  // --- stable reference id (1,2,3) ----------------------------------------------------------------
  check("1) reference id is the digest when present (stable input → stable id)", computeReferenceId("998877", undefined, "t_fallback000000") === "998877");
  check("2) no digest → the pinned fallback is returned unchanged (rerender-stable)", computeReferenceId(undefined, undefined, "t_fallback000000") === "t_fallback000000");
  check("3) same inputs always yield the same id (reset keeps id until a NEW error)", computeReferenceId(undefined, undefined, "t_keepme000000") === computeReferenceId(undefined, undefined, "t_keepme000000"));
  check("newClientReference matches the t_ contract", /^t_[a-f0-9]{12}$/.test(newClientReference()));

  // --- fail-open logging (8) ----------------------------------------------------------------------
  let threw = false;
  try { logPhase({ traceId: "t_x0x0x0x0x0x0", phase: "LOGIN_SUBMITTED" }, () => { throw new Error("sink boom"); }); } catch { threw = true; }
  check("8) a throwing sink NEVER propagates (login not blocked by logging)", threw === false);

  // --- NEXT_REDIRECT is control-flow, never an error (9) ------------------------------------------
  check("isNextControlFlow(true) for NEXT_REDIRECT", isNextControlFlow(redirectError()) === true && isNextControlFlow(new Error("real")) === false);
  {
    const { lines, sink } = captured();
    let rethrew: unknown;
    try { await withPhase("t_abc123abc123", "PASSWORD_VERIFIED", async () => { throw redirectError(); }, {}, sink); } catch (e) { rethrew = e; }
    check("9) withPhase rethrows NEXT_REDIRECT and does NOT log it as a failure", isNextControlFlow(rethrew) && lines.length === 0);
  }
  {
    const { lines, sink } = captured();
    let rethrew: unknown;
    try { await withPhase("t_abc123abc123", "SESSION_CREATED", async () => { throw new Error("db down"); }, { route: "/login" }, sink); } catch (e) { rethrew = e; }
    check("a REAL error IS logged (success:false) and rethrown", (rethrew as Error)?.message === "db down" && lines.length === 1 && lines[0]?.success === false && lines[0]?.diag === "SESSION_CREATED");
  }

  // --- message sanitization (6) -------------------------------------------------------------------
  check("6) scrubMessage strips newlines/control chars + caps length", !/\n|\r/.test(scrubMessage("line1\nline2\ttab")) && scrubMessage("x".repeat(500)).length === 200);
  check("scrubMessage redacts secret-shaped values", scrubMessage("postgresql://user:pw@host/db").includes("[redacted]"));

  // --- client-error sink: validation / rate-limit / size / cookie-clear ---------------------------
  const base = { sameOrigin: true, rateAllowed: true };
  check("happy path → 204", handleClientErrorReport({ ...base, rawBody: body({ event: "error", referenceId: "t_abc", boundary: "global", route: "/dashboard", errorName: "TypeError" }) }).status === 204);
  check("4) invalid JSON → 400", handleClientErrorReport({ ...base, rawBody: "{not json" }).status === 400);
  check("4) schema-invalid (bad enum) → 400", handleClientErrorReport({ ...base, rawBody: body({ boundary: "hacker" }) }).status === 400);
  check("7) EXTRA/unknown fields rejected (strict) → 400", handleClientErrorReport({ ...base, rawBody: body({ event: "error", cookie: "steal=1", token: "abc" }) }).status === 400);
  check("7) bad traceId format rejected → 400", handleClientErrorReport({ ...base, rawBody: body({ traceId: "not-a-trace" }) }).status === 400);
  check("5) rate limited → 429 (no log)", handleClientErrorReport({ sameOrigin: true, rateAllowed: false, rawBody: body({ event: "error" }) }).status === 429);
  check("cross-origin → 403", handleClientErrorReport({ sameOrigin: false, rateAllowed: true, rawBody: body({ event: "error" }) }).status === 403);
  check("oversize body → 413", handleClientErrorReport({ ...base, rawBody: "x".repeat(4000) }).status === 413);

  // --- 10) mount marker clears the trace cookie ---------------------------------------------------
  {
    const { lines, sink } = captured();
    const r = handleClientErrorReport({ ...base, rawBody: body({ event: "mounted", route: "/dashboard" }), cookieTraceId: "t_login00000000" }, sink);
    check("10) mounted marker → 204 + clearTraceCookie true", r.status === 204 && r.clearTraceCookie === true);
    check("10) mounted marker logs DASHBOARD_CLIENT_MOUNTED with the login traceId", lines.length === 1 && lines[0]?.diag === "DASHBOARD_CLIENT_MOUNTED" && lines[0]?.traceId === "t_login00000000");
    check("error report does NOT clear the cookie", handleClientErrorReport({ ...base, rawBody: body({ event: "error" }) }).clearTraceCookie === false);
  }

  // --- 6b) the sink never logs a secret-shaped field even if smuggled in safeMessage --------------
  {
    const { lines, sink } = captured();
    handleClientErrorReport({ ...base, rawBody: body({ event: "error", safeMessage: "token=eyJabc.def.ghi leaked" }), userAgentFamily: "Safari" }, sink);
    check("6b) smuggled token value in message is redacted before log", typeof lines[0]?.safeMessage === "string" && (lines[0].safeMessage as string).includes("[redacted]"));
    check("userAgentFamily is server-derived, logged safely", lines[0]?.userAgentFamily === "Safari");
  }

  // --- 12) mount marker dedupe key is stable (basis for once-only send) ---------------------------
  check("12) client report dedupe key is deterministic (mount fires once per route)", clientReportKey("mounted", "/dashboard", "shell_mount") === clientReportKey("mounted", "/dashboard", "shell_mount"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — login/first-render diagnostics (V1.63)`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
