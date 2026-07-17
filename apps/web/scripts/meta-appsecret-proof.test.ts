/**
 * V1.58.3 — proves every server Meta Graph call with a user token carries a correct `appsecret_proof`,
 * that the proof/secret never leak into errors, and that the appsecret_proof failure is NOT misread as
 * a missing Pages permission. Pure: mocks only the fetch boundary. No token/secret/proof is printed.
 */
import { createHmac } from "node:crypto";
import { appsecretProof, MetaGraphError, discoverMetaAccounts, fetchMetaPermissions } from "@guardora/connectors";
import { classifyMetaDiscoveryError, classifyMetaEmptyPages } from "../src/server/oauth/meta-callback-classify";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const TOKEN = "USER_TOKEN_abc123";
const SECRET = "APP_SECRET_xyz789";
const EXPECTED_PROOF = createHmac("sha256", SECRET).update(TOKEN).digest("hex");

type Canned = { ok: boolean; status: number; body: unknown };
let capturedUrls: string[] = [];
function installFetch(resp: () => Canned) {
  capturedUrls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown) => {
    capturedUrls.push(String(url));
    const r = resp();
    return { ok: r.ok, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as unknown;
  };
}
const params = (u: string) => new URL(u).searchParams;

async function run() {
  // 1 + 4) proof computation
  check("1) appsecretProof = HMAC-SHA256(key=appSecret, msg=accessToken) hex", appsecretProof(TOKEN, SECRET) === EXPECTED_PROOF);
  check("4) swapped inputs (key=token, msg=secret) yield a DIFFERENT proof", appsecretProof(SECRET, TOKEN) !== EXPECTED_PROOF);

  // 2) /me/permissions carries access_token + correct appsecret_proof
  installFetch(() => ({ ok: true, status: 200, body: { data: [{ permission: "pages_show_list", status: "granted" }] } }));
  await fetchMetaPermissions(TOKEN, SECRET);
  {
    const u = capturedUrls[0] ?? "";
    const p = params(u);
    check("2) /me/permissions request includes access_token + correct appsecret_proof",
      u.includes("me/permissions") && p.get("access_token") === TOKEN && p.get("appsecret_proof") === EXPECTED_PROOF);
  }

  // 3) /me/accounts carries access_token + correct appsecret_proof
  installFetch(() => ({ ok: true, status: 200, body: { data: [] } }));
  await discoverMetaAccounts(TOKEN, SECRET);
  {
    const u = capturedUrls[0] ?? "";
    const p = params(u);
    check("3) /me/accounts request includes access_token + correct appsecret_proof",
      u.includes("me/accounts") && p.get("access_token") === TOKEN && p.get("appsecret_proof") === EXPECTED_PROOF);
  }

  // 5 + 6a) the real production error: code 100 GraphMethodException. Proof/secret must not leak; kind=generic.
  installFetch(() => ({ ok: false, status: 400, body: { error: { code: 100, type: "GraphMethodException", message: "API calls from the server require an appsecret_proof argument", fbtrace_id: "Ah6D6FDXlpXhDq1EkDG9VsD" } } }));
  let thrown: MetaGraphError | null = null;
  try { await fetchMetaPermissions(TOKEN, SECRET); } catch (e) { thrown = e as MetaGraphError; }
  {
    const surfaced = `${thrown?.message ?? ""}${JSON.stringify(thrown?.detail ?? {})}`;
    check("5) proof + app secret NEVER appear in the thrown MetaGraphError (message/detail)",
      !!thrown && !surfaced.includes(EXPECTED_PROOF) && !surfaced.includes(SECRET));
    check("6a) code-100 GraphMethodException classifies as kind 'generic' (not 'permission')",
      thrown?.detail.kind === "generic" && thrown?.detail.code === 100);
  }

  // 6b/6c) classification: an appsecret_proof / generic error is meta_api_error, never missing_permission
  check("6b) appsecret_proof failure (generic, perms unread) → meta_api_error, NOT missing_permission",
    classifyMetaDiscoveryError("generic", false, false) === "meta_api_error");
  check("6c) generic /me/accounts error while pages_show_list IS granted → meta_api_error",
    classifyMetaDiscoveryError("generic", true, true) === "meta_api_error");

  // 7) missing_permission ONLY on a confirmed declined/absent pages_show_list
  check("7a) confirmed declined pages_show_list (permsOk && !granted) → missing_permission",
    classifyMetaDiscoveryError("generic", true, false) === "missing_permission");
  check("7b) empty /me/accounts + confirmed declined → missing_permission",
    classifyMetaEmptyPages(true, false) === "missing_permission");
  check("7c) empty /me/accounts but permissions UNKNOWN (perms failed) → no_pages, NOT a false missing_permission",
    classifyMetaEmptyPages(false, false) === "no_pages");
  check("7d) explicit Graph 'permission' error → missing_permission",
    classifyMetaDiscoveryError("permission", false, false) === "missing_permission");
  check("7e) token_expired → token_exchange_failed",
    classifyMetaDiscoveryError("token_expired", true, true) === "token_exchange_failed");

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — meta appsecret_proof + classification: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
