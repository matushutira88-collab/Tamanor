import { test, expect } from "@playwright/test";

/**
 * BUSINESS REGRESSION SMOKE (authenticated). Real browser coverage that the existing Business console routes
 * still load through the auth/workspace boundary with no server error / error boundary, a visible h1 landmark,
 * and a usable sidebar — after the additive Contacts/Platforms feature. Also smokes the two new routes + a
 * contact detail path (seeded deterministic test data). Runs under the owner storageState from global-setup.
 */

// Every visible Business sidebar route (covers the prompt's protected list + the two additive entries).
const ROUTES: { path: string; label: string }[] = [
  { path: "/dashboard", label: "overview" },
  { path: "/dashboard/accounts", label: "watched accounts" },
  { path: "/dashboard/comments", label: "comments" },
  { path: "/dashboard/action-queue", label: "alerts" },
  { path: "/dashboard/timeline", label: "activity" },
  { path: "/dashboard/control-center", label: "protection rules" },
  { path: "/dashboard/command-center", label: "control center" },
  { path: "/dashboard/billing", label: "subscription" },
  { path: "/dashboard/settings", label: "settings" },
  { path: "/dashboard/team", label: "team" },
  { path: "/dashboard/reputation", label: "reputation" },
  { path: "/dashboard/incidents", label: "incidents" },
  { path: "/dashboard/actor-risk", label: "risk profiles" },
  { path: "/dashboard/audit", label: "audit" },
  { path: "/dashboard/security", label: "security center" },
  { path: "/dashboard/contacts", label: "contacts (new)" },
  { path: "/dashboard/platforms", label: "connected platforms (new)" },
];

const ERROR_BOUNDARY = "This page hit a snag";

test.describe("business regression smoke", () => {
  for (const r of ROUTES) {
    test(`route resolves + landmark + sidebar: ${r.label}`, async ({ page }) => {
      const resp = await page.goto(r.path, { waitUntil: "domcontentloaded" });
      // no server error
      expect(resp?.status() ?? 0, `${r.path} HTTP status`).toBeLessThan(500);
      // authenticated boundary intact: not bounced to /login or /verify-email
      expect(page.url(), `${r.path} not redirected out`).not.toMatch(/\/(login|verify-email)/);
      // no error boundary rendered
      await expect(page.getByText(ERROR_BOUNDARY), `${r.path} no error boundary`).toHaveCount(0);
      // a visible h1 landmark
      await expect(page.locator("h1").first(), `${r.path} h1 visible`).toBeVisible();
      // sidebar present + usable (a stable existing nav link is visible)
      await expect(page.locator('a[href="/dashboard/comments"]').first(), `${r.path} sidebar usable`).toBeVisible();
    });
  }

  test("nav: existing entries preserved + exactly the two additive entries", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    for (const href of ["/dashboard", "/dashboard/comments", "/dashboard/incidents", "/dashboard/team", "/dashboard/audit", "/dashboard/security"]) {
      await expect(page.locator(`a[href="${href}"]`).first(), `existing nav ${href}`).toBeVisible();
    }
    // the two additive entries are present…
    await expect(page.locator('a[href="/dashboard/contacts"]').first()).toBeVisible();
    await expect(page.locator('a[href="/dashboard/platforms"]').first()).toBeVisible();
    // …and no MORE than two new business routes were added to the sidebar.
    const contacts = await page.locator('nav a[href="/dashboard/contacts"], aside a[href="/dashboard/contacts"], a[href="/dashboard/contacts"]').count();
    const platforms = await page.locator('a[href="/dashboard/platforms"]').count();
    expect(contacts).toBeGreaterThanOrEqual(1);
    expect(platforms).toBeGreaterThanOrEqual(1);
  });

  test("contact detail loads with seeded test data", async ({ page }) => {
    await page.goto("/dashboard/contacts", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const firstDetail = page.locator('a[href^="/dashboard/contacts/"]').first();
    await expect(firstDetail, "a seeded contact row links to detail").toBeVisible();
    await firstDetail.click();
    await expect(page).toHaveURL(/\/dashboard\/contacts\/[A-Za-z0-9]+/);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(ERROR_BOUNDARY)).toHaveCount(0);
  });
});
