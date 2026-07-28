import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * BUSINESS BILLING TRUTH — browser proof (desktop). Stages a fixture with a STALE Tenant.plan (free_trial) plus a
 * trusted ACTIVE Growth subscription, then proves /dashboard/billing and /dashboard/usage both show the EFFECTIVE
 * (Growth) plan — never the stale trial — with the correct current pricing card, status and interval. Restores the
 * Family baseline in teardown. Uses the fail-closed E2E seam only; never touches auth, price mapping, or the
 * webhook. workers=1 + fullyParallel:false make the seed/restore race-free.
 */
async function seed(baseURL: string, scenario: "stale-growth" | "restore") {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/e2e/seed-business-billing", { data: { scenario } });
  await ctx.dispose();
  return res;
}

test.describe("business billing truth (desktop)", () => {
  test.beforeAll(async ({ baseURL }) => {
    const res = await seed(baseURL!, "stale-growth");
    expect(res.status(), "seam enabled + fixture staged").toBe(200);
  });
  test.afterAll(async ({ baseURL }) => {
    await seed(baseURL!, "restore"); // return the shared fixture to its Family baseline
  });

  test("Billing + Usage show the effective Growth plan (not the stale trial), same source", async ({ page }) => {
    // ── /dashboard/billing ──
    await page.goto("/dashboard/billing");
    await expect(page).not.toHaveURL(/\/login/);
    // dismiss cookie consent so nothing overlays the content
    const reject = page.getByRole("button", { name: /reject non-essential|odmietnuť|ablehnen/i });
    if (await reject.count()) await reject.first().click().catch(() => {});

    // The summary shows the EFFECTIVE plan = Growth (never "Free Trial").
    const currentPlan = page.getByTestId("billing-current-plan");
    await expect(currentPlan).toBeVisible();
    await expect(currentPlan).toHaveText(/Growth/);
    await expect(currentPlan).toHaveAttribute("data-plan", "growth");
    await expect(page.getByTestId("billing-status")).toHaveAttribute("data-status", "active");
    await expect(page.getByTestId("billing-cycle")).toHaveAttribute("data-interval", "monthly");

    // The GROWTH pricing card is the (only) current one; Starter/Agency are NOT current.
    await expect(page.getByTestId("billing-plan-growth")).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("billing-plan-starter")).toHaveAttribute("data-current", "false");
    await expect(page.getByTestId("billing-plan-agency")).toHaveAttribute("data-current", "false");
    // The current (Growth) card must NOT offer a same-plan checkout CTA.
    await expect(page.getByTestId("billing-plan-growth").locator('form[action], button:has-text("payment")')).toHaveCount(0);

    // No trial section is shown for a paid customer.
    await expect(page.getByText(/Free trial/i)).toHaveCount(0);

    // ── /dashboard/usage — the SAME effective plan ──
    await page.goto("/dashboard/usage");
    await expect(page).not.toHaveURL(/\/login/);
    const usagePlan = page.getByTestId("usage-plan");
    await expect(usagePlan).toBeVisible();
    await expect(usagePlan).toHaveText(/growth/i);
    await expect(page.getByTestId("usage-lifecycle")).toHaveAttribute("data-lifecycle", "active_paid");
  });
});
