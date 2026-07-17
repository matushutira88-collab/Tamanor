/**
 * V1.58.9 — cryptographic password generator. Pure (injected deterministic RNG — never Math.random).
 * Run: pnpm auth-generator:test
 */
import { generatePassword } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// Deterministic byte stream for reproducible assertions (production uses the CSPRNG).
const seq = (start: number) => (n: number) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (start + i * 7) & 0xff; return a; };

function run() {
  const pw = generatePassword(24, seq(3));
  check("length >= 20 (min enforced even if asked for less)", generatePassword(8, seq(1)).length >= 20);
  check("requested length honored", pw.length === 24);
  check("contains lowercase", /[a-z]/.test(pw));
  check("contains uppercase", /[A-Z]/.test(pw));
  check("contains digit", /[0-9]/.test(pw));
  check("contains symbol", /[^a-zA-Z0-9]/.test(pw));
  check("deterministic for a fixed RNG (no Math.random)", generatePassword(24, seq(3)) === pw);
  check("different RNG → different password", generatePassword(24, seq(99)) !== pw);
  // No ambiguous characters (0/O/1/l/I) by construction.
  check("no ambiguous chars (0 O 1 l I)", !/[0O1lI]/.test(pw));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — password generator (V1.58.9): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
