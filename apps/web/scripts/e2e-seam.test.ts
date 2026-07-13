/**
 * V1.39C — proves the E2E test seam is FAIL-CLOSED. The auth-bootstrap route and the slow
 * test mutation must be inert unless E2E_TEST_MODE === "true" (never set in real production).
 *
 * Run: pnpm e2e-seam:test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { e2eSeamEnabled, e2eMutationDelayMs } from "../src/lib/e2e-seam";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const web = (p: string) => readFileSync(resolve(process.cwd(), "../web", p), "utf8");

function run() {
  // Gate is strictly "true": default OFF, and non-exact values do NOT enable it.
  check("1) seam OFF by default (no env)", e2eSeamEnabled({}) === false);
  check("2) seam OFF for non-exact values (production safety)", e2eSeamEnabled({ E2E_TEST_MODE: "1" }) === false && e2eSeamEnabled({ E2E_TEST_MODE: "TRUE" }) === false && e2eSeamEnabled({ E2E_TEST_MODE: "" }) === false);
  check("3) seam ON only for exact \"true\"", e2eSeamEnabled({ E2E_TEST_MODE: "true" }) === true);
  check("4) gated delay is 0 when seam disabled; bounded when enabled", e2eMutationDelayMs({}) === 0 && e2eMutationDelayMs({ E2E_TEST_MODE: "true", E2E_MUTATION_DELAY_MS: "999999" }) <= 5000 && e2eMutationDelayMs({ E2E_TEST_MODE: "true" }) === 1500);

  // Both test-only surfaces gate on the seam (source guardrail — they must refuse when off).
  const loginRoute = web("src/app/api/e2e/login/route.ts");
  check("5) auth-bootstrap route refuses (404) when seam disabled", /e2eSeamEnabled\(\)/.test(loginRoute) && /404/.test(loginRoute));
  const dsPage = web("src/app/e2e/double-submit/page.tsx");
  const dsAction = web("src/app/e2e/double-submit/actions.ts");
  check("6) double-submit page + action are gated by the seam", /e2eSeamEnabled\(\)/.test(dsPage) && /notFound\(\)/.test(dsPage) && /e2eSeamEnabled\(\)/.test(dsAction));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — E2E seam fail-closed (V1.39C)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
