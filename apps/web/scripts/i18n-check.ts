/**
 * i18n dictionary coverage smoke check.
 *
 * Key coverage is already enforced at compile time (sk/de are typed as the full
 * Dictionary). This script is a fast runtime backstop: it verifies en/sk/de have
 * identical key paths and that no translated value is an empty string.
 *
 * Run: tsx apps/web/scripts/i18n-check.ts
 */
import { en } from "../src/i18n/dictionaries/en";
import { sk } from "../src/i18n/dictionaries/sk";
import { de } from "../src/i18n/dictionaries/de";

type Any = Record<string, unknown>;

function paths(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  }
  if (obj && typeof obj === "object") {
    return Object.entries(obj as Any).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

function emptyValues(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) return obj.flatMap((v, i) => emptyValues(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") {
    return Object.entries(obj as Any).flatMap(([k, v]) => emptyValues(v, prefix ? `${prefix}.${k}` : k));
  }
  return typeof obj === "string" && obj.trim() === "" ? [prefix] : [];
}

const base = new Set(paths(en));
let failures = 0;

for (const [name, dict] of [["sk", sk], ["de", de]] as const) {
  const set = new Set(paths(dict));
  const missing = [...base].filter((k) => !set.has(k));
  const extra = [...set].filter((k) => !base.has(k));
  const empties = emptyValues(dict);
  if (missing.length) { failures++; console.log(`  ✗ ${name}: missing ${missing.length} keys → ${missing.slice(0, 5).join(", ")}`); }
  if (extra.length) { failures++; console.log(`  ✗ ${name}: extra ${extra.length} keys → ${extra.slice(0, 5).join(", ")}`); }
  if (empties.length) { failures++; console.log(`  ✗ ${name}: ${empties.length} empty values → ${empties.slice(0, 5).join(", ")}`); }
  if (!missing.length && !extra.length && !empties.length) console.log(`  ✓ ${name}: ${set.size} keys, complete`);
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — i18n coverage (base ${base.size} keys)`);
process.exit(failures === 0 ? 0 : 1);
