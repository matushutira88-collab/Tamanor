import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** V1.39C — public (unauthenticated) customer flows. Desktop + mobile Chromium. */

const isMobile = (name: string) => name.includes("mobile");

test("landing loads with a primary CTA to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  const cta = page.getByRole("link", { name: /start free trial/i }).first();
  await expect(cta).toHaveAttribute("href", /\/login/);
});

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("unknown route renders the safe 404 not-found", async ({ page }) => {
  const res = await page.goto("/this-route-does-not-exist-xyz");
  expect(res?.status()).toBe(404);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /go home/i })).toBeVisible();
});

test("login page renders a sign-in affordance", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in|not available/i })).toBeVisible();
});

for (const route of ["/", "/login", "/security", "/compare"]) {
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
  const cta = page.getByRole("link", { name: /start free trial/i }).first();
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

for (const route of ["/", "/login", "/security"]) {
  test(`no critical axe violations: ${route}`, async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), "run axe once on desktop");
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, JSON.stringify(critical.map((v) => v.id))).toEqual([]);
  });
}
