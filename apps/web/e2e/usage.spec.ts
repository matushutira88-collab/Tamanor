import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * V1.44 — usage metering UI + fail-closed behaviour. Deterministic fixture states are set through
 * the fail-closed /api/e2e/seed-usage seam (counter values only — never a real provider call). The
 * paid-AI kill switch is OFF in the E2E env, so "Advanced (paid) AI is disabled" is always true.
 */
const isDesktop = (n: string) => n === "auth-desktop" || n === "auth-tablet";
async function seed(page: Page, state: string) {
  const res = await page.request.post(`/api/e2e/seed-usage?state=${state}`);
  expect(res.ok(), `seed-usage HTTP ${res.status()}`).toBeTruthy();
}

test.describe("usage card", () => {
  test("renders plan, meters, reset and status across fixture states", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    for (const [state, status] of [["normal", "normal"], ["50", "warning"], ["80", "critical"], ["basic_exhausted", "exhausted"]] as const) {
      await seed(page, state);
      await page.goto("/dashboard/usage");
      await expect(page.getByTestId("usage-card")).toBeVisible();
      await expect(page.getByTestId("usage-card")).toHaveAttribute("data-status", status);
      await expect(page.getByTestId("usage-basic")).toBeVisible();
      await expect(page.getByTestId("usage-premium-calls")).toBeVisible();
      await expect(page.getByTestId("usage-period")).toContainText("resets");
    }
  });

  test("premium exhausted states read as exhausted; paid AI disabled; free copy present", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    for (const state of ["premium_calls_exhausted", "premium_cost_exhausted"]) {
      await seed(page, state);
      await page.goto("/dashboard/usage");
      await expect(page.getByTestId("usage-card")).toHaveAttribute("data-status", "exhausted");
    }
    await expect(page.getByTestId("usage-paid-enabled")).toHaveAttribute("data-enabled", "false");
    await expect(page.getByTestId("usage-copy")).toContainText("inbox remains available");
  });

  test("usage persists across reload (URL/DB state, not client)", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    await seed(page, "80");
    await page.goto("/dashboard/usage");
    await expect(page.getByTestId("usage-card")).toHaveAttribute("data-status", "critical");
    await page.reload();
    await expect(page.getByTestId("usage-card")).toHaveAttribute("data-status", "critical");
  });

  test("inbox + manual workflow keep working after limits are exhausted", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    // Seed inbox fixtures AND exhaust usage, then confirm the inbox still functions.
    const seedInbox = await page.request.post("/api/e2e/seed-inbox");
    expect(seedInbox.ok()).toBeTruthy();
    const { itemId } = (await seedInbox.json()) as { itemId: string };
    await seed(page, "basic_exhausted");
    await page.goto("/dashboard/comments");
    const card = page.locator(`[data-inbox-item="${itemId}"]`);
    await expect(card).toBeVisible();
    // Manual workflow control is still available (not gated by usage).
    await card.locator("summary").first().click();
    await expect(card.getByRole("button", { name: /^mark read$/i })).toBeVisible();
  });

  test("admin sees the diagnostic; secrets/DB URL never present", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    await seed(page, "normal");
    await page.goto("/dashboard/usage");
    await expect(page.getByTestId("usage-diagnostic")).toBeVisible();
    const text = await page.getByTestId("usage-diagnostic").textContent();
    expect(text ?? "").not.toMatch(/postgres:\/\/|sk_live|api[_-]?key|password|Bearer /i);
  });

  test("dashboard renders with NO hydration mismatch (locale number formatting)", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    // The sidebar trial counter ("Items processed <n> / 500") and the usage meters format numbers;
    // a locale-dependent formatter would log React's "Hydration failed …" to the console.
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page, "80");
    await page.goto("/dashboard/usage");
    await expect(page.getByTestId("usage-card")).toBeVisible();
    await page.waitForTimeout(300);
    const hydration = errors.filter((e) => /hydrat|did not match|server-rendered|text content does not match/i.test(e));
    expect(hydration, hydration.join("\n")).toEqual([]);
  });

  test("no horizontal overflow; no critical axe violations", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "run once on desktop");
    await seed(page, "80");
    await page.goto("/dashboard/usage");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});

test.describe("usage viewer (read-only)", () => {
  test.use({ storageState: "e2e/.auth/state.viewer.json" });
  test("viewer sees the usage card but NOT the admin diagnostic", async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "desktop-only");
    await seed(page, "normal");
    await page.goto("/dashboard/usage");
    await expect(page.getByTestId("usage-card")).toBeVisible();
    await expect(page.getByTestId("usage-diagnostic")).toHaveCount(0);
  });
});
