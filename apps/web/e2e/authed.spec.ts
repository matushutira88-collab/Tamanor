import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * V1.39C — authenticated browser proofs (stable storageState session, production build).
 * Closes the two V1.39B gaps: (1) authenticated mobile no-overflow across dashboard routes
 * and (2) a dedicated double-submit proof on a real SubmitButton/useFormStatus flow.
 */

const isMobile = (name: string) => name.includes("mobile");
const TOLERANCE = 2; // px — subpixel rounding only

const AUTH_ROUTES = [
  "/dashboard",
  "/dashboard/accounts",
  "/dashboard/comments",
  "/dashboard/action-queue",
  "/dashboard/settings",
  "/dashboard/billing",
];

async function overflow(page: Page): Promise<{ docX: number; bodyX: number }> {
  return page.evaluate(() => ({
    docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyX: document.body.scrollWidth - document.body.clientWidth,
  }));
}

// ---------------- Authenticated route health + no-overflow (all viewports) ----------------

for (const route of AUTH_ROUTES) {
  test(`authenticated route is healthy + no horizontal overflow: ${route}`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res, `no response for ${route}`).toBeTruthy();
    expect(res!.status(), `5xx on ${route}`).toBeLessThan(500);
    await expect(page).not.toHaveURL(/\/login/); // session held, no bounce to login
    await expect(page.locator("main, body")).toBeVisible();
    const o = await overflow(page);
    expect(o.docX, `documentElement overflow on ${route}`).toBeLessThanOrEqual(TOLERANCE);
    expect(o.bodyX, `body overflow on ${route}`).toBeLessThanOrEqual(TOLERANCE);
  });
}

// ---------------- V1.45A — global platform leads P0: tenant Owner is denied ----------------
// The bootstrapped fixture session is a tenant OWNER with platformRole=none. The platform guard
// fails closed to a non-revealing not-found for both routes and leaks no prospect PII. (Next returns
// the not-found body with a 200 status here because the dashboard layout streams before the page's
// notFound() throws — the SECURITY property is that no lead data renders and a generic not-found is
// shown, which we assert directly.)
test("tenant Owner is DENIED the global platform leads page (non-revealing, no PII)", async ({ page }) => {
  await page.goto("/dashboard/leads");
  const list = (await page.locator("body").innerText()).toLowerCase();
  // Denied: no leads table / prospect PII / platform header rendered.
  expect(list).not.toContain("@example.com");
  expect(list).not.toContain("prospect administration");
  expect(list).not.toMatch(/name\s+company\s+source/);
  // Non-revealing: a generic not-found is shown (not a "restricted" message revealing the resource).
  expect(list, `denied page must be a generic not-found, got: ${list.slice(0, 120)}`).toMatch(/404|not found|couldn|does.?n.t exist/i);

  await page.goto("/dashboard/leads/any-lead-id");
  const detail = (await page.locator("body").innerText()).toLowerCase();
  expect(detail).not.toContain("@example.com");
  expect(detail).toMatch(/404|not found/i);
});

test("authenticated account detail (if any) has no horizontal overflow", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  const link = page.locator('a[href^="/dashboard/accounts/"]').first();
  if ((await link.count()) === 0) test.skip(true, "no connected account to open");
  const href = await link.getAttribute("href");
  const res = await page.goto(href!);
  expect(res!.status()).toBeLessThan(500);
  const o = await overflow(page);
  expect(o.docX).toBeLessThanOrEqual(TOLERANCE);
  expect(o.bodyX).toBeLessThanOrEqual(TOLERANCE);
});

// ---------------- Mobile navigation behavior (mobile projects) ----------------

test("mobile navigation: open (click + keyboard), Escape closes + returns focus, link closes menu", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), "mobile-only");
  await page.goto("/dashboard");
  const trigger = page.getByRole("button", { name: /open menu/i });
  await expect(trigger).toBeVisible();

  // Click opens.
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("dialog", { name: /navigation menu/i });
  await expect(menu.getByRole("link").first()).toBeVisible();

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Open menu");

  // Keyboard open (focus trigger, Enter).
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Clicking a nav link closes the menu and navigates.
  await menu.getByRole("link").filter({ hasText: /accounts/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/accounts/);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

// ---------------- Dedicated double-submit proof (desktop) ----------------

test("double-submit is blocked while a mutation is pending (exactly one request)", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), "desktop-only");
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/e2e/double-submit")) posts.push(r.url());
  });

  // Wait for the deterministic hydration marker so the form's CLIENT action is wired
  // (otherwise a native POST would submit and useFormStatus could never engage).
  await page.goto("/e2e/double-submit");
  await page.waitForSelector('html[data-e2e-hydrated="1"]', { timeout: 15_000 });
  const button = page.locator('form button[type="submit"]'); // stable across the label change
  await expect(button).toBeEnabled();

  // First submit — do NOT await navigation (the action is intentionally slow).
  await button.click();

  // While pending: the button is disabled and shows the pending label.
  await expect(button).toBeDisabled();
  await expect(button).toContainText(/working/i);

  // Attempt a second submit during the pending window — a disabled button submits nothing.
  await button.click({ force: true, timeout: 800 }).catch(() => {});

  // Let the mutation finish → redirect to the completed state.
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 10_000 });

  // Exactly one server request fired despite the repeated attempts.
  expect(posts.length, `POSTs: ${posts.length}`).toBe(1);

  // Button is usable again after completion.
  await expect(page.getByRole("button", { name: /run mutation/i })).toBeEnabled();
});

// ---------------- Authenticated axe smoke (desktop) ----------------

for (const route of ["/dashboard", "/dashboard/accounts", "/dashboard/comments", "/dashboard/settings", "/dashboard/billing"]) {
  test(`no critical axe violations (authenticated): ${route}`, async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), "run axe once on desktop");
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, `${route}: ${JSON.stringify(critical.map((v) => v.id))}`).toEqual([]);
  });
}
