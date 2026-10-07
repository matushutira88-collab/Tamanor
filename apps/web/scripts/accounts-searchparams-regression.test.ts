/**
 * PRODUCTION INCIDENT REGRESSION — /dashboard/accounts search-params ordering (Aug 2026).
 *
 * WHAT BROKE. The page declared `const sp = await searchParams` BELOW a helper that already read `sp`.
 * The helper was invoked during the same synchronous run of statements, so `sp` was still in its
 * temporal dead zone and Node threw `ReferenceError: Cannot access 'sp' before initialization` —
 * a 500 on every dashboard visit. TypeScript compiled it happily: the read is inside an arrow function,
 * so TS cannot see that the call happens before the declaration.
 *
 * WHY THIS TEST IS NOT JUST A TEXT SCAN. It has three layers, in increasing strength:
 *   1. RUNTIME — reconstruct the exact broken shape and prove it really throws a TDZ ReferenceError,
 *      then prove the fixed shape does not. This pins down what the bug actually was, executably.
 *   2. LINT — run the REAL ESLint config against a file with the broken shape and assert
 *      `no-use-before-define` reports it. That rule is now enabled for App Router route files, so the
 *      bug class cannot be reintroduced without failing `pnpm lint`.
 *   3. SOURCE — assert the live page still awaits before it reads, as a fast direct check.
 *
 * Run via: pnpm accounts-searchparams:test
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../../..");
const PAGE = "apps/web/src/app/dashboard/accounts/page.tsx";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

/** Run a function and report whether it threw the TDZ ReferenceError. */
async function tdzThrown(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) {
    return e instanceof ReferenceError ? e.message : `NON-TDZ: ${String(e)}`;
  }
}

async function main() {
  console.log("\n/dashboard/accounts — search-params ordering regression\n");

  // =========================================================================================
  console.log("1) RUNTIME — the exact broken shape really throws");
  {
    // The pre-hotfix structure, reduced to its essentials: a helper closure that reads `sp`, invoked
    // while building a value, with `const sp = await searchParams` declared afterwards.
    const broken = async (searchParams: Promise<Record<string, string | undefined>>) => {
      const count = (k: string) => Number((sp as Record<string, string | undefined>)[k] ?? "");
      const parts = [count("gbpImported"), count("gbpReconnected")];
      // eslint-disable-next-line no-use-before-define -- this file INTENTIONALLY reproduces the bug
      const sp = await searchParams;
      return parts;
    };
    const msg = await tdzThrown(() => broken(Promise.resolve({ gbpImported: "2" })));
    check("1a) the broken ordering throws a ReferenceError at runtime", msg !== null && !msg.startsWith("NON-TDZ"), String(msg));
    check("1b) it is specifically a temporal-dead-zone error on `sp`",
      (msg ?? "").includes("sp") && /before initialization|Cannot access/.test(msg ?? ""), String(msg));
  }
  {
    // The hotfix shape: await FIRST, then use.
    const fixed = async (searchParams: Promise<Record<string, string | undefined>>) => {
      const sp = await searchParams;
      const count = (k: string) => Number(sp[k] ?? "");
      return [count("gbpImported"), count("gbpReconnected")];
    };
    const msg = await tdzThrown(() => fixed(Promise.resolve({ gbpImported: "2", gbpReconnected: "1" })));
    check("1c) the fixed ordering runs cleanly", msg === null, String(msg));
    check("1d) …and reads the resolved values", JSON.stringify(await fixed(Promise.resolve({ gbpImported: "2", gbpReconnected: "1" }))) === "[2,1]");
  }
  {
    // Guard against the OTHER shape of the same mistake: property access on the unresolved Promise.
    const promiseAccess = async (searchParams: Promise<Record<string, string | undefined>>) => {
      // A Promise has no `gbpImported`, so this silently yields undefined instead of the real value —
      // no crash, but a silently wrong answer. The source check in section 3 forbids it.
      return (searchParams as unknown as Record<string, string | undefined>).gbpImported;
    };
    check("1e) reading a property off the UNRESOLVED promise silently yields undefined",
      (await promiseAccess(Promise.resolve({ gbpImported: "2" }))) === undefined);
  }

  // =========================================================================================
  console.log("\n2) LINT — the real ESLint config rejects the broken shape");
  {
    const dir = mkdtempSync(join(tmpdir(), "tamanor-tdz-"));
    // The rule is scoped to App Router route files, so the probe must live at such a path to be linted
    // exactly as a real page would be. It is written INSIDE the repo (then removed) so the flat config
    // and its `files:` globs resolve normally.
    const probeDir = resolve(ROOT, "apps/web/src/app/__tdz_probe__");
    const probe = join(probeDir, "page.tsx");
    let reported = "";
    let ran = false;
    try {
      execFileSync("mkdir", ["-p", probeDir]);
      writeFileSync(probe, [
        "export default async function Probe({ searchParams }: { searchParams: Promise<Record<string, string>> }) {",
        "  const read = (k: string) => sp[k];",
        "  const first = read(\"a\");",
        "  const sp = await searchParams;",
        "  return first;",
        "}",
        "",
      ].join("\n"));
      try {
        execFileSync("npx", ["eslint", "apps/web/src/app/__tdz_probe__/page.tsx", "--format", "json"], { cwd: ROOT, encoding: "utf8" });
        reported = "";
      } catch (e) {
        // eslint exits non-zero when it reports errors; its JSON report is on stdout.
        reported = String((e as { stdout?: string }).stdout ?? "");
      }
      ran = true;
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
    check("2a) ESLint ran against the probe", ran);
    check("2b) the REAL config reports no-use-before-define on the broken ordering",
      reported.includes("no-use-before-define"), reported.slice(0, 300));
    check("2c) it names the offending variable", /was used before it was defined/.test(reported));
  }
  {
    // The rule must actually be configured for App Router route files, not merely happen to fire.
    const cfg = readFileSync(resolve(ROOT, "eslint.config.mjs"), "utf8");
    check("2d) the rule is enabled in the shared config", /"no-use-before-define":\s*\[\s*"error"/.test(cfg));
    check("2e) it targets variables (the TDZ case), not just functions", /variables:\s*true/.test(cfg));
    check("2f) it is scoped to App Router page/layout/route files",
      /apps\/web\/src\/app\/\*\*\/page\.tsx/.test(cfg) && /apps\/web\/src\/app\/\*\*\/route\.ts/.test(cfg));
  }

  // =========================================================================================
  console.log("\n3) SOURCE — the live page still awaits before it reads");
  {
    const raw = readFileSync(resolve(ROOT, PAGE), "utf8");
    const awaitAt = raw.indexOf("await searchParams");
    const firstUse = raw.search(/\bsp\b\s*[[.]/);
    check("3a) the page awaits searchParams", awaitAt > 0);
    check("3b) every read of the resolved object comes AFTER the await", firstUse > awaitAt, `await@${awaitAt} use@${firstUse}`);
    check("3c) the unresolved promise is never property-accessed",
      !/searchParams\.[a-zA-Z_]/.test(raw.replace(/await searchParams/g, "")));
    check("3d) searchParams keeps the Next 15 Promise contract", /searchParams:\s*Promise</.test(raw));
  }
  {
    // The same ordering rule applies to every App Router page that takes searchParams or params.
    const pages = execFileSync("bash", ["-lc",
      `cd ${JSON.stringify(ROOT)} && grep -rl "searchParams: Promise<\\|params: Promise<" apps/web/src/app --include=page.tsx --include=layout.tsx || true`,
    ], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    check("3e) other App Router pages using the async contract were found", pages.length > 0, `found=${pages.length}`);
    const offenders = pages.filter((rel) => {
      const raw = readFileSync(resolve(ROOT, rel), "utf8");
      for (const name of ["searchParams", "params"]) {
        const m = raw.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*await\\s+${name}\\b`));
        if (!m) continue;
        const declAt = raw.indexOf(m[0]);
        const use = raw.search(new RegExp(`\\b${m[1]}\\b\\s*[[.]`));
        if (use >= 0 && use < declAt) return true;
      }
      return false;
    });
    check("3f) NO App Router page reads a resolved param object before awaiting it", offenders.length === 0, offenders.join(", "));
  }

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — accounts search-params regression  [${pass} passed, ${fail} failed]`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
