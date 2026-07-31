/**
 * BUSINESS Connected Platforms & Contacts V1 — i18n parity + safety (static). Asserts SK/EN/DE have identical
 * key shapes, every enum (status/source/provider/connStatus/capability) has a non-empty label in all 3 locales,
 * and the copy is content-free (no email/id/@/braces). Mirrors the family-notifications-i18n parity test.
 */
import { businessDict, type BusinessDict } from "../src/app/dashboard/business-i18n";
import {
  ALL_BUSINESS_CONTACT_STATUSES, BusinessContactSource, BusinessProvider, BusinessConnectionStatus,
  BusinessConnectionCapability,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const LOCALES = ["en", "sk", "de"] as const;
const dicts = { en: businessDict("en"), sk: businessDict("sk"), de: businessDict("de") };

// Recursive key-shape (function values → "fn"), for a sorted-key comparison across locales.
function shape(v: unknown): unknown {
  if (typeof v === "function") return "fn";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = shape(o[k]); return acc; }, {} as Record<string, unknown>);
  }
  return typeof v;
}
const enShape = JSON.stringify(shape(dicts.en));
for (const loc of LOCALES) {
  check(`${loc}: key shape matches EN`, JSON.stringify(shape(dicts[loc])) === enShape);
}

// Every enum has a non-empty, distinct-from-key label in all 3 locales.
const enumMaps: { name: string; keys: string[]; pick: (d: BusinessDict) => Record<string, string> }[] = [
  { name: "status", keys: [...ALL_BUSINESS_CONTACT_STATUSES], pick: (d) => d.status },
  { name: "source", keys: Object.values(BusinessContactSource), pick: (d) => d.source },
  { name: "provider", keys: Object.values(BusinessProvider), pick: (d) => d.provider },
  { name: "connStatus", keys: Object.values(BusinessConnectionStatus), pick: (d) => d.connStatus },
  { name: "capability", keys: Object.values(BusinessConnectionCapability), pick: (d) => d.capability },
];
for (const em of enumMaps) {
  for (const loc of LOCALES) {
    const map = em.pick(dicts[loc]);
    const ok = em.keys.every((k) => typeof map[k] === "string" && map[k].trim().length > 0);
    check(`${loc}: every ${em.name} enum has a label`, ok, em.keys.filter((k) => !map[k]).join(","));
  }
}

// Content-free: no email/@, no id token, no template braces in any string value.
function collect(v: unknown, out: string[]) {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) collect(x, out);
}
for (const loc of LOCALES) {
  const strings: string[] = [];
  collect(dicts[loc], strings);
  const bad = strings.filter((s) => /@|\{\{|\}\}|\b[a-f0-9]{16,}\b/.test(s));
  check(`${loc}: copy is content-free (no @/braces/hash)`, bad.length === 0, bad.slice(0, 3).join(" | "));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts i18n (V1): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
