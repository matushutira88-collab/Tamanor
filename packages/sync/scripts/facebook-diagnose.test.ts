/**
 * V1.27C — diagnostics behaviour.
 * facebook-token:diagnose validates a PAGE token via GET /{pageId} (not
 * /me/accounts). facebook-hide:diagnose classifies can_hide=false as
 * blocked/facebook_can_hide_false — NOT a token/permission issue. Never logs a token.
 *
 * Run via: pnpm facebook-diagnose:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MockFacebookHideTransport } from "@guardora/connectors";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  // Transport contracts the diagnostics rely on.
  const okPage = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: true, pageId: "P1", pageName: "Konfigurátor" } });
  const badPage = new MockFacebookHideTransport({ ok: true }, { pageToken: { ok: false, errorCode: "token_invalid" } });
  const pgOk = await okPage.getPageTokenState("P1", "tok");
  const pgBad = await badPage.getPageTokenState("P1", "tok");
  check("page token check returns ok with page object", pgOk.ok && pgOk.pageId === "P1");
  check("page token check returns error code when invalid", !pgBad.ok && pgBad.errorCode === "token_invalid");

  const canHideFalse = new MockFacebookHideTransport({ ok: true }, { comment: { ok: true, canHide: false, isHidden: false } });
  const st = await canHideFalse.getCommentState("C1", "tok");
  check("comment state exposes can_hide/is_hidden", st.ok && st.canHide === false && st.isHidden === false);

  // Source contracts.
  const tokenDiag = readSrc("scripts/facebook-token-diagnose.ts");
  check("11) token diagnose validates the PAGE token via getPageTokenState / {pageId}", tokenDiag.includes("getPageTokenState") && tokenDiag.includes("page_token_ok") && !/me\/accounts.*primary|primary.*me\/accounts/i.test(tokenDiag));
  check("11b) /me/accounts used only as secondary user-token debug", tokenDiag.includes("user token check") && tokenDiag.includes("user_token_check_failed"));
  check("token diagnose never logs a token value", !tokenDiag.includes("${token}") && !/console\.log\(\s*token\b/.test(tokenDiag) && !/console\.log\([^)]*,\s*token\s*\)/.test(tokenDiag));

  const hideDiag = readSrc("scripts/facebook-hide-diagnose.ts");
  check("hide diagnose maps can_hide=false → blocked/facebook_can_hide_false", hideDiag.includes("facebook_can_hide_false") && hideDiag.includes("getCommentState"));
  check("hide diagnose maps is_hidden=true → already_hidden", hideDiag.includes("already_hidden"));
  check("hide diagnose never logs a token value", !hideDiag.includes("console.log(token"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Facebook diagnostics`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
