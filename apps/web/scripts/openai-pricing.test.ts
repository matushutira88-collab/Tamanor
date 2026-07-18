/**
 * V1.60 — OpenAI cost calculation. Pure, no network. Verifies the reservation (worst-case) + actual
 * (reported tokens) micros for the priced model, and that an UNPRICED openai model fails closed to the
 * conservative SAFE_FALLBACK (never an invented price). Run: pnpm openai-pricing:test
 */
import { estimateCostMicros, actualCostMicros, hasPricing, SAFE_FALLBACK_MICROS } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

// gpt-4o-mini: 0.15 micros/input-token, 0.60 micros/output-token (1 micro = $1e-6).
check("gpt-4o-mini is priced", hasPricing("openai", "gpt-4o-mini"));
check("unlisted openai model is NOT priced", !hasPricing("openai", "gpt-4o-not-real"));

// Worst-case reservation for the enterprise plan (16000 in / 4096 out): ceil(0.15*16000 + 0.60*4096).
const est = estimateCostMicros("openai", "gpt-4o-mini", 16_000, 4_096);
check("reservation estimate = 4858 micros (enterprise caps)", est === 4858n, String(est));

// Actual cost from real reported tokens (e.g. a ~300-in/150-out comment): ceil(0.15*300 + 0.60*150).
const act = actualCostMicros("openai", "gpt-4o-mini", 300, 150);
check("actual cost for 300in/150out = 135 micros", act === 135n, String(act));

// Unpriced model → SAFE_FALLBACK (fail closed) for BOTH estimate and actual — no invented price.
check("unpriced model estimate → SAFE_FALLBACK", estimateCostMicros("openai", "gpt-4o-not-real", 16_000, 4_096) === SAFE_FALLBACK_MICROS);
check("unpriced model actual → SAFE_FALLBACK", actualCostMicros("openai", "gpt-4o-not-real", 300, 150) === SAFE_FALLBACK_MICROS);
check("zero tokens → 0 micros", actualCostMicros("openai", "gpt-4o-mini", 0, 0) === 0n);

console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — OpenAI cost calculation (V1.60): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
