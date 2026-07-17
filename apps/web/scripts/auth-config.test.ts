/**
 * V1.58.9 — session lifetime config validation (fail-closed). Pure: injects synthetic env; asserts the
 * invariants idle < absolute ≤ remember, positive integers, touch < idle, and that errors carry only
 * variable NAMES (never a value).
 *
 * Run: pnpm auth-config:test
 */
import { validateSessionConfig, getSessionConfig } from "@guardora/config";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

function run() {
  // Defaults (all unset) are valid: idle 30m < absolute 24h ≤ remember 30d, touch 5m < idle.
  check("defaults valid", validateSessionConfig(env({})).ok);
  const d = getSessionConfig(env({}));
  check("defaults resolve to ms (30m/24h/30d/5m)", d.idleMs === 1_800_000 && d.absoluteMs === 86_400_000 && d.rememberMs === 2_592_000_000 && d.touchMs === 300_000);

  // idle >= absolute → invalid.
  check("idle >= absolute → invalid", !validateSessionConfig(env({ SESSION_IDLE_TIMEOUT_MINUTES: "2000", SESSION_ABSOLUTE_TIMEOUT_HOURS: "1" })).ok);

  // absolute > remember → invalid (absolute must be at most the remember ceiling).
  check("absolute > remember → invalid", !validateSessionConfig(env({ SESSION_ABSOLUTE_TIMEOUT_HOURS: "48", SESSION_REMEMBER_ME_DAYS: "1" })).ok);

  // touch >= idle → invalid (activity marker must be finer than the idle window).
  check("touch >= idle → invalid", !validateSessionConfig(env({ SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: "3600", SESSION_IDLE_TIMEOUT_MINUTES: "30" })).ok);

  // Non-positive / garbage → invalid.
  check("zero idle → invalid", !validateSessionConfig(env({ SESSION_IDLE_TIMEOUT_MINUTES: "0" })).ok);
  check("negative absolute → invalid", !validateSessionConfig(env({ SESSION_ABSOLUTE_TIMEOUT_HOURS: "-5" })).ok);
  check("garbage remember → invalid", !validateSessionConfig(env({ SESSION_REMEMBER_ME_DAYS: "abc" })).ok);

  // A valid custom production policy passes.
  check("valid custom policy passes", validateSessionConfig(env({ SESSION_IDLE_TIMEOUT_MINUTES: "15", SESSION_ABSOLUTE_TIMEOUT_HOURS: "12", SESSION_REMEMBER_ME_DAYS: "14", SESSION_ACTIVITY_TOUCH_INTERVAL_SECONDS: "120" })).ok);

  // Errors name the variable + reason (useful) and never echo a value.
  const r = validateSessionConfig(env({ SESSION_IDLE_TIMEOUT_MINUTES: "9999", SESSION_ABSOLUTE_TIMEOUT_HOURS: "1" }));
  check("error names the offending variable", !r.ok && r.errors.some((e) => e.includes("SESSION_IDLE_TIMEOUT_MINUTES")));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — session lifetime config (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
