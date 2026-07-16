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

// V1.53A/B — the confirmed defect: on /case-studies the header's section links were dead. This is a
// REAL interaction test (not just href inspection): it clicks each link and asserts the URL changes,
// the target section becomes visible, and the clicked link is the TOPMOST element (nothing intercepts).
test("public header section nav actually navigates from Case Studies (real click)", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "the public header nav is desktop-only (hidden on mobile)");

  // Assert the clicked link receives the click (no invisible interceptor over the header).
  async function clickSection(sectionHref: string, sectionId: string) {
    await page.goto("/case-studies");
    const link = page.locator(`header a[href="${sectionHref}"]`);
    await expect(link).toBeVisible();
    const notIntercepted = await link.evaluate((a) => {
      const r = a.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === a || a.contains(top!) || top?.closest("a") === a;
    });
    expect(notIntercepted, `an element intercepts the click on ${sectionHref}`).toBe(true);
    await link.click();
    // URL changed to the homepage anchor + the target section scrolled into view (first click).
    await expect(page).toHaveURL(new RegExp(`${sectionHref.replace(/[/#]/g, "\\$&")}$`));
    await expect(page.locator(`#${sectionId}`)).toBeInViewport({ timeout: 6000 });
  }

  await clickSection("/#safety", "safety");
  await clickSection("/#features", "features");
  await clickSection("/#pricing", "pricing");

  // No bare same-page `#anchor` links remain in the header (the original defect shape).
  await page.goto("/case-studies");
  await expect(page.locator('header nav a[href^="#"]')).toHaveCount(0);
  await expect(page.locator('header a[href="/login"]')).toBeVisible();
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
