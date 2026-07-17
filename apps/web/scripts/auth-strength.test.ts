/**
 * V1.58.9 — password policy + strength (server source of truth). Pure. Run: pnpm auth-strength:test
 */
import { evaluatePassword, passwordScore } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const P = { minLength: 12, maxLength: 128 };

function run() {
  check("too short (<12) rejected", evaluatePassword("Short1!", P).ok === false && evaluatePassword("Short1!", P).reasons.includes("too_short"));
  check("exactly 12 accepted", evaluatePassword("aaaaaaaaaaaa", P).ok === true);
  check("too long (>128) rejected", evaluatePassword("a".repeat(129), P).ok === false && evaluatePassword("a".repeat(129), P).reasons.includes("too_long"));
  check("max 128 accepted", evaluatePassword("a".repeat(128), P).ok === true);
  // Passphrase: long, few classes → accepted AND scored strong (no dumb symbol requirement).
  const passphrase = "correct horse battery staple garden";
  check("long passphrase accepted (no symbol requirement)", evaluatePassword(passphrase, P).ok === true);
  check("long passphrase scores strong+", evaluatePassword(passphrase, P).score >= 3);
  // Strength labels.
  check("short mixed → fair/strong not very_strong", evaluatePassword("Ab1!efgh1234", P).strength !== "very_strong");
  check("20+ mixed → very_strong", evaluatePassword("Ab1!Ab1!Ab1!Ab1!Ab1!", P).strength === "very_strong");
  check("score is 0..4", [0,1,2,3,4].includes(passwordScore("x")) && passwordScore("A".repeat(30)) <= 4);
  // Unicode counted by code points, not truncated.
  check("unicode counted by code points", evaluatePassword("😀".repeat(12), P).ok === true);

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — password policy + strength (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
