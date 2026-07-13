import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V1.39C / V1.42B — browser gate against a PRODUCTION build (`next start`), so there is NO
 * on-demand dev compilation. A stable authenticated storageState is bootstrapped in global-setup.
 * Auth is enabled only via the fail-closed E2E_TEST_MODE seam. No real provider calls.
 *
 * V1.42B lifecycle fix: the webServer launches the `next` binary DIRECTLY (not via a
 * pnpm/dotenv wrapper). Previously the wrapper tree (pnpm → dotenv → next) meant Playwright's
 * teardown killed the wrapper but orphaned the `next-server` grandchild, leaving a zombie on
 * the port; a subsequent run then talked to that corrupted leftover and 500'd. Launching `next`
 * directly makes it the process Playwright spawns, so tree-kill reaps it cleanly. `.env` is
 * parsed here (no dep) and injected via webServer.env, with the E2E overrides winning.
 */
const PORT = Number(process.env.E2E_PORT ?? 3220);
const baseURL = `http://localhost:${PORT}`;
const STORAGE = "e2e/.auth/state.json";
const mobile = (w: number, h: number) => ({ browserName: "chromium" as const, viewport: { width: w, height: h }, isMobile: true, hasTouch: true });

/** Minimal, dependency-free .env loader (KEY=VALUE; ignores comments/blank; keeps first value). */
function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in out)) out[key] = val;
    }
  } catch { /* .env optional in some CI contexts */ }
  return out;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0, // V1.42B acceptance gate: a pass must be a pass without retry.
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL, headless: true, trace: "off" },
  projects: [
    // Public flows — no session.
    { name: "public-desktop", testMatch: /public\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "public-mobile", testMatch: /public\.spec\.ts/, use: mobile(390, 844) },
    { name: "public-mobile-small", testMatch: /public\.spec\.ts/, use: mobile(375, 812) },
    // Authenticated flows — reuse the bootstrapped storageState.
    { name: "auth-desktop", testMatch: /(authed|inbox)(\.scale)?\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STORAGE } },
    { name: "auth-mobile", testMatch: /(authed|inbox)(\.scale)?\.spec\.ts/, use: { ...mobile(390, 844), storageState: STORAGE } },
    { name: "auth-mobile-small", testMatch: /(authed|inbox)(\.scale)?\.spec\.ts/, use: { ...mobile(375, 812), storageState: STORAGE } },
    { name: "auth-tablet", testMatch: /(authed|inbox)(\.scale)?\.spec\.ts/, use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true, storageState: STORAGE } },
  ],
  // Production build served by the `next` binary directly (Playwright prepends node_modules/.bin
  // to PATH, so `next` resolves to apps/web's copy). NODE_ENV stays "production" and the
  // fail-closed E2E seam is enabled only for this run.
  webServer: {
    command: `next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...loadEnv("../../.env"), ...process.env, NODE_ENV: "production", E2E_TEST_MODE: "true", E2E_MUTATION_DELAY_MS: "3000", NEXT_DIST_DIR: ".next-e2e" },
  },
});
