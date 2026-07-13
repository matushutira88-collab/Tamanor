import { defineConfig, devices } from "@playwright/test";

/**
 * V1.39C — browser gate against a PRODUCTION build (`next start`), so there is NO on-demand
 * dev compilation (the previous flakiness source). A single server is started, readiness is
 * awaited, and a stable authenticated storageState is bootstrapped in global-setup. Auth is
 * enabled only via the fail-closed E2E_TEST_MODE seam. No real provider calls.
 */
const PORT = Number(process.env.E2E_PORT ?? 3220);
const baseURL = `http://localhost:${PORT}`;
const STORAGE = "e2e/.auth/state.json";
const mobile = (w: number, h: number) => ({ browserName: "chromium" as const, viewport: { width: w, height: h }, isMobile: true, hasTouch: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
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
    { name: "auth-desktop", testMatch: /authed\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: STORAGE } },
    { name: "auth-mobile", testMatch: /authed\.spec\.ts/, use: { ...mobile(390, 844), storageState: STORAGE } },
    { name: "auth-mobile-small", testMatch: /authed\.spec\.ts/, use: { ...mobile(375, 812), storageState: STORAGE } },
    { name: "auth-tablet", testMatch: /authed\.spec\.ts/, use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true, storageState: STORAGE } },
  ],
  // Production build served by `next start` (NO on-demand dev compilation). DB/auth vars are
  // loaded from the root .env via dotenv; the explicit overrides below are set FIRST, and
  // dotenv (default: no-override) preserves them — so NODE_ENV stays "production" and the
  // fail-closed E2E seam is enabled only for this run.
  webServer: {
    command: `pnpm exec dotenv -e ../../.env -- next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, NODE_ENV: "production", E2E_TEST_MODE: "true", E2E_MUTATION_DELAY_MS: "3000" },
  },
});
