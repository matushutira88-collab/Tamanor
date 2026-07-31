/**
 * CSP POLICY V1 — tests. Verifies: production forbids unsafe-eval; object-src none; base-uri/form-action/
 * frame-ancestors locked; explicit hosts; NO wildcard drift beyond the known GA subdomains; the strict-report
 * candidate uses nonce + strict-dynamic and NO unsafe-inline; and PARITY between the builder's "enforce" output
 * and the CSP currently shipped by apps/web/next.config.mjs (a drift guard over the real config).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCsp, parseCsp, wildcardHosts, ALLOWED_WILDCARD_HOSTS } from "../src/csp-policy";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// ---- enforced production policy -----------------------------------------------------------------------------
const prod = buildCsp({ isProd: true, mode: "enforce" });
const prodD = parseCsp(prod);
check("prod: no 'unsafe-eval'", !/unsafe-eval/.test(prod));
check("prod: object-src 'none'", prodD["object-src"] === "'none'");
check("prod: base-uri 'self'", prodD["base-uri"] === "'self'");
check("prod: form-action 'self'", prodD["form-action"] === "'self'");
check("prod: frame-ancestors 'none'", prodD["frame-ancestors"] === "'none'");
check("prod: default-src 'self'", prodD["default-src"] === "'self'");
check("prod: upgrade-insecure-requests present", "upgrade-insecure-requests" in prodD);
check("prod: script-src has explicit analytics + turnstile hosts", /googletagmanager\.com/.test(prodD["script-src"]!) && /connect\.facebook\.net/.test(prodD["script-src"]!) && /challenges\.cloudflare\.com/.test(prodD["script-src"]!));
check("prod: honest — 'unsafe-inline' still present in script-src (NOT closed)", /'unsafe-inline'/.test(prodD["script-src"]!));

// dev allows unsafe-eval (HMR) but never in prod
check("dev: allows unsafe-eval", /unsafe-eval/.test(buildCsp({ isProd: false, mode: "enforce" })));

// ---- wildcard drift -----------------------------------------------------------------------------------------
const wilds = wildcardHosts(prod);
check("wildcard drift: only the known GA subdomains", JSON.stringify(wilds) === JSON.stringify([...ALLOWED_WILDCARD_HOSTS].sort()), wilds.join(", "));

// ---- strict-report candidate --------------------------------------------------------------------------------
const strict = buildCsp({ isProd: true, mode: "strict-report", nonce: "abc123XYZ_-==" });
const strictD = parseCsp(strict);
check("strict: nonce present", /'nonce-abc123XYZ_-=='/.test(strictD["script-src"]!));
check("strict: strict-dynamic present", /'strict-dynamic'/.test(strictD["script-src"]!));
check("strict: NO unsafe-inline in script-src", !/'unsafe-inline'/.test(strictD["script-src"]!));
check("strict: NO unsafe-eval", !/unsafe-eval/.test(strict));
check("strict: object-src none retained", strictD["object-src"] === "'none'");
let threw = false;
try { buildCsp({ isProd: true, mode: "strict-report", nonce: "bad nonce!" }); } catch { threw = true; }
check("strict: rejects a malformed nonce", threw);

// ---- PARITY with the real next.config.mjs enforced CSP -------------------------------------------------------
{
  const cfgPath = resolve(process.cwd(), "../../apps/web/next.config.mjs");
  const cfg = readFileSync(cfgPath, "utf8");
  // Assert the config's directive building matches the builder's key production directives.
  const mustContain = [
    "default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    "object-src 'none'", "img-src 'self' data: https:", "style-src 'self' 'unsafe-inline'",
  ];
  for (const d of mustContain) check(`parity: next.config declares "${d}"`, cfg.includes(d), "builder/config drift");
  check("parity: config script-src has no 'unsafe-eval' in the prod branch", /isProd[\s\S]*?script-src 'self' 'unsafe-inline' \$\{analyticsScript\}/.test(cfg));
  check("parity: config allowlists the same analytics + turnstile hosts", /googletagmanager\.com/.test(cfg) && /connect\.facebook\.net/.test(cfg) && /challenges\.cloudflare\.com/.test(cfg));
  // Wildcard parity: the config's connect-src must not introduce a wildcard beyond the known GA set.
  const cfgWilds = (cfg.match(/https:\/\/\*[a-z0-9.-]+/g) ?? []).sort();
  const uniq = [...new Set(cfgWilds)];
  check("parity: config wildcards ⊆ allowed GA subdomains", uniq.every((h) => (ALLOWED_WILDCARD_HOSTS as readonly string[]).includes(h)), uniq.join(", "));
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — CSP policy (V1)`);
process.exit(failures === 0 ? 0 : 1);
