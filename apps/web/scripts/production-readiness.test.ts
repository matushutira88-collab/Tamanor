/**
 * V1.39 — production-readiness guardrails.
 *
 * Behavior checks against the real libs (safe errors, ops redaction, connector display
 * truthfulness) + source/route guardrails for boundaries, fail-closed readiness, demo/mock
 * production gating, and dead-UI/secret scans. No new product feature is asserted.
 *
 * Run: pnpm production-readiness:test
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { SAFE_ERRORS, toSafeError, newCorrelationId } from "../src/lib/errors";
import { redact } from "../src/lib/ops-events";
import { connectorDisplay } from "../src/lib/connector-display";
import { PROVIDERS, providerStatusFor } from "../src/lib/provider-status";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const WEB = resolve(process.cwd(), "../web");
const src = (p: string) => readFileSync(join(WEB, p), "utf8");
const has = (p: string) => existsSync(join(WEB, p));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|)$/.test(name) && (name.endsWith(".tsx") || name.endsWith(".ts"))) out.push(full);
  }
  return out;
}

function run() {
  // ---------------- safe error model ----------------
  const reasons = Object.keys(SAFE_ERRORS);
  check("1) every safe error has title + message + remediation", reasons.length >= 14 && reasons.every((r) => { const e = SAFE_ERRORS[r as keyof typeof SAFE_ERRORS]; return e.title && e.message && e.remediation; }));
  const allText = reasons.map((r) => JSON.stringify(SAFE_ERRORS[r as keyof typeof SAFE_ERRORS])).join(" ");
  check("2) safe errors leak no stack/DB/prisma/postgres", !/prisma|postgres|PrismaClient|at Object\.|\bstack\b|node_modules/i.test(allText));
  check("3) toSafeError round-trips reason", toSafeError("token_expired").reason === "token_expired" && toSafeError("permission_denied").title === SAFE_ERRORS.permission_denied.title);
  const id1 = newCorrelationId(), id2 = newCorrelationId();
  check("4) correlation id: prefixed, non-empty, no secret", id1.startsWith("t_") && id1.length >= 6 && id1 !== id2);

  // ---------------- ops redaction ----------------
  const red = redact({ token: "bearer abc.def", db: "postgresql://u:p@h/db", note: "ok", authorization: "Bearer x", count: 3 });
  check("5) ops redaction strips secret keys + secret-shaped values", red.token === "[redacted]" && red.authorization === "[redacted]" && red.db === "[redacted]" && red.note === "ok" && red.count === 3);

  // ---------------- connector display truthfulness ----------------
  const igConnected = connectorDisplay({ platformKey: "instagram", status: "active", health: "healthy", connectionStatus: "connected" });
  check("6) Instagram connected → verification_pending, NOT healthy/live", igConnected.state === "provider_verification_pending" && igConnected.tone === "warn" && /not live/i.test(igConnected.copy));
  const gbpConnected = connectorDisplay({ platformKey: "google_business", status: "active", health: "healthy", connectionStatus: "connected" });
  check("7) Google Business connected → verification_pending, NOT live", gbpConnected.state === "provider_verification_pending");
  const fbHealthy = connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy", connectionStatus: "connected" });
  check("8) Facebook connected + healthy → healthy (ok)", fbHealthy.state === "healthy" && fbHealthy.tone === "ok");
  check("9) Facebook disconnected → disconnected + reconnect CTA", connectorDisplay({ platformKey: "facebook", status: "disconnected", health: "error" }).state === "disconnected" && connectorDisplay({ platformKey: "facebook", status: "disconnected" }).cta?.kind === "reconnect");
  check("10) Facebook token expired → token_expired", connectorDisplay({ platformKey: "facebook", status: "active", tokenHealth: "expired" }).state === "token_expired");
  check("11) Facebook missing permission → permission_missing", connectorDisplay({ platformKey: "facebook", status: "active", connectionStatus: "missing_permission" }).state === "permission_missing");
  check("12) YouTube/TikTok → unsupported (never connected)", connectorDisplay({ platformKey: "youtube", status: "active", health: "healthy" }).state === "unsupported" && connectorDisplay({ platformKey: "tiktok", status: "active" }).state === "unsupported");
  check("13) Facebook placeholder / sync-off → sync_disabled, NOT healthy", connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy", mode: "placeholder" }).state === "sync_disabled" && connectorDisplay({ platformKey: "facebook", status: "active", health: "healthy" }, { liveSyncEnabled: false }).state === "sync_disabled");

  // ---------------- provider truth (one model) ----------------
  check("14) provider truth: Instagram/GBP not live; YT/LI/TT research", providerStatusFor("instagram")!.live === false && providerStatusFor("google_business")!.live === false && ["youtube", "linkedin", "tiktok"].every((k) => providerStatusFor(k)!.status === "research") && PROVIDERS.length === 6);

  // ---------------- error boundaries + loading ----------------
  check("15) boundaries present: not-found + global-error + dashboard error + dashboard loading", has("src/app/not-found.tsx") && has("src/app/global-error.tsx") && has("src/app/dashboard/error.tsx") && has("src/app/dashboard/loading.tsx"));
  check("16) error boundaries never render raw error.message", !/\{error\.message\}/.test(src("src/app/global-error.tsx")) && !/\{error\.message\}/.test(src("src/app/dashboard/error.tsx")) && /correlationId|digest/.test(src("src/app/global-error.tsx")));

  // ---------------- health / readiness ----------------
  check("17) health + readiness routes present", has("src/app/api/health/route.ts") && has("src/app/api/ready/route.ts"));
  const ready = src("src/app/api/ready/route.ts");
  check("18) readiness is fail-closed (503 when not ready) + uses safe checks", /503/.test(ready) && /validateRuntimeDbConfig/.test(ready) && /checkRlsRuntime/.test(ready) && /tokenStorageStatus/.test(ready));
  check("19) readiness never serializes DB URL / raw secret env", !/process\.env\.DATABASE_URL|process\.env\.APP_DATABASE_URL|process\.env\.TOKEN_ENCRYPTION_KEY/.test(ready));

  // ---------------- demo / mock production gating ----------------
  const login = src("src/app/login/page.tsx");
  check("20) login dev picker gated OFF in production (guard before the dev-user query)", /NODE_ENV !== "production"/.test(login) && /if \(!devLoginEnabled\)/.test(login) && login.indexOf("if (!devLoginEnabled)") < login.indexOf("await listDevLoginUsers"));
  check("21) dev sign-in action fail-closed in production", /devLoginEnabled = \(\) => process\.env\.NODE_ENV !== "production"/.test(src("src/server/session-actions.ts")));

  // ---------------- dead-UI + secret scans ----------------
  const files = walk(join(WEB, "src")).map((f) => ({ f, s: readFileSync(f, "utf8") }));
  const deadCta = files.filter(({ s }) => /href="#"/.test(s) || /\balert\(/.test(s));
  check("22) no dead CTAs (href=\"#\", alert())", deadCta.length === 0, deadCta.map((x) => x.f).join(", "));
  const logs = files.filter(({ f, s }) => !f.includes("/scripts/") && /console\.log\(/.test(s));
  check("23) no console.log in shipped components", logs.length === 0, logs.map((x) => x.f).join(", "));
  const stale = files.filter(({ s }) => /guardora\.ai/.test(s) && !/@guardora/.test(s.match(/.*guardora\.ai.*/)?.[0] ?? ""));
  check("24) no stale guardora.ai in web src", stale.length === 0, stale.map((x) => x.f).join(", "));

  // ---------------- native dependency packaging (V1.55B.2) ----------------
  // @node-rs/argon2 is required at runtime through the transpiled @guardora/db and is
  // externalized by next.config, so it is NOT bundled — Next output-file-tracing must
  // resolve it from node_modules. The DEPLOYED package (apps/web) must therefore own it
  // directly; otherwise Vercel's traced function omits the native module and every route
  // importing @guardora/db throws MODULE_NOT_FOUND at import time (500 on /api/ready, login,
  // registration). Declaring it on packages/db alone is insufficient for the app's trace.
  const webPkg = JSON.parse(src("package.json")) as { dependencies?: Record<string, string>; scripts?: Record<string, string> };
  check("25) apps/web declares @node-rs/argon2 as a direct runtime dependency (Vercel native packaging)", Boolean(webPkg.dependencies?.["@node-rs/argon2"]));

  // ---------------- Prisma native engine packaging (V1.55B.3) ----------------
  // The RHEL Query Engine must be generated for Vercel's serverless runtime, and the
  // deployed package (apps/web) must own @prisma/client so Next output-file-tracing
  // includes libquery_engine-rhel-openssl-3.0.x.so.node in every Prisma-using function.
  // Missing either -> PrismaClientInitializationError (engine not found) -> /api/ready,
  // login and registration fail at DB init in production.
  const prismaSchema = readFileSync(join(WEB, "../../packages/db/prisma/schema.prisma"), "utf8");
  check("26) prisma schema declares native + rhel-openssl-3.0.x binary targets (Vercel runtime engine)", /binaryTargets\s*=\s*\[[^\]]*["']rhel-openssl-3\.0\.x["'][^\]]*\]/.test(prismaSchema) && /["']native["']/.test(prismaSchema));
  check("27) apps/web owns @prisma/client + build runs prisma generate (engine generated & traced)", Boolean(webPkg.dependencies?.["@prisma/client"]) && /generate/.test(webPkg.scripts?.build ?? ""));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — production readiness (V1.39)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
