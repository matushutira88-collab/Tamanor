import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** V1.39C — public (unauthenticated) customer flows. Desktop + mobile Chromium. */

const isMobile = (name: string) => name.includes("mobile");

test("landing loads with a primary CTA to log in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  // V1.50A — self-service: a "Log in" link points to /login and "Start free" to /register.
  const login = page.getByRole("link", { name: /log in/i }).first();
  await expect(login).toHaveAttribute("href", /\/login/);
  const start = page.getByRole("link", { name: /start for free/i }).first();
  await expect(start).toHaveAttribute("href", /\/register/);
});

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

// V1.53A — the confirmed defect: on /case-studies the header's section links (Features, Security,
// Pricing) were bare `#anchor`s that don't exist off the homepage, so clicking them did nothing.
// The fix points them at the homepage anchor `/#section`, so they work from any sub-page.
test("public header nav works from Case Studies (defect fix)", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "the public header nav is desktop-only (hidden on mobile)");
  await page.goto("/case-studies");
  const header = page.locator("header");
  // The fix: header section links target the HOMEPAGE anchor (`/#section`), functional off-homepage.
  await expect(header.locator('a[href="/#features"]')).toBeVisible();
  await expect(header.locator('a[href="/#safety"]')).toBeVisible();
  await expect(header.locator('a[href="/#pricing"]')).toBeVisible();
  await expect(header.locator('a[href="/#platforms"]')).toBeVisible();
  // Regression guard: NO bare same-page `#anchor` links remain in the header nav (the defect).
  await expect(header.locator('nav a[href^="#"]')).toHaveCount(0);
  // Adjacent links that always worked remain present + clickable.
  await expect(header.locator('a[href*="case-studies"]')).toBeVisible();
  await expect(header.locator('a[href="/login"]')).toBeVisible();
  // Clicking a section link from the sub-page now navigates to the homepage (was a no-op before).
  await header.locator('a[href="/#features"]').click();
  await expect(page).not.toHaveURL(/case-studies/);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("self-service funnel: homepage → Start free → register form, and → Log in", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "desktop-only funnel nav");
  await page.goto("/");
  await page.getByRole("link", { name: /start for free/i }).first().click();
  await expect(page).toHaveURL(/\/register/);
  // Registration offers email + real (enabled) social sign-up.
  await expect(page.getByLabel(/work email/i)).toBeVisible();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
  await expect(page.getByLabel(/workspace name/i)).toBeVisible();
  await expect(page.getByLabel(/country/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /continue with google/i })).toHaveAttribute("href", /\/api\/auth\/google\/start/);
  // V1.50B — login has a real credential form + ENABLED Google/Facebook (production OAuth
  // routes; no "available soon"). The buttons link to the real start endpoints.
  await page.goto("/login");
  await expect(page.getByLabel(/work email/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /continue with google/i })).toHaveAttribute("href", /\/api\/auth\/google\/start/);
  await expect(page.getByRole("link", { name: /continue with facebook/i })).toHaveAttribute("href", /\/api\/auth\/facebook\/start/);
});

test("password recovery: login → forgot-password → generic sent screen", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "desktop-only funnel nav");
  await page.goto("/login");
  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel(/work email/i).fill("someone@example.com");
  await page.getByRole("button", { name: /send reset link/i }).click();
  // Enumeration-safe: always the same generic confirmation.
  await expect(page.getByText(/if an account exists/i)).toBeVisible();
});

test("reset-password without a token shows an invalid-link state (no form)", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  await expect(page.getByLabel(/new password/i)).toHaveCount(0);
});

test("unknown route renders the safe 404 not-found", async ({ page }) => {
  const res = await page.goto("/this-route-does-not-exist-xyz");
  expect(res?.status()).toBe(404);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /go home/i })).toBeVisible();
});

test("login page renders a sign-in affordance", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /log in/i })).toBeVisible();
  await expect(page.getByLabel(/work email/i)).toBeVisible();
});

for (const route of ["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/security", "/compare"]) {
  test(`no horizontal overflow at mobile widths: ${route}`, async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), "mobile-only");
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}

test("mobile: primary CTA remains usable (visible + adequate touch target)", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), "mobile-only");
  await page.goto("/");
  // V1.50A/B — the header primary CTA is "Start for free" → /register (self-service).
  const cta = page.getByRole("link", { name: /start for free/i }).first();
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(36);
});

test("keyboard: Tab moves focus on the login page", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "desktop-only");
  await page.goto("/login");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(["A", "BUTTON", "INPUT"]).toContain(active);
});

for (const route of ["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/security"]) {
  test(`no critical axe violations: ${route}`, async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), "run axe once on desktop");
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
  });
}
